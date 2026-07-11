import { DEFAULT_THUMBNAIL_SCHEDULER_POLICY, type ThumbnailSchedulerPolicy } from './thumbnailSchedulerPolicy';

export type ThumbnailPriority = 'visible' | 'overscan' | 'lookahead' | 'background';

export interface ThumbnailViewportDemand {
  generation: number;
  visiblePaths: readonly string[];
  overscanPaths: readonly string[];
  lookaheadPaths: readonly string[];
  direction: 'forward' | 'backward' | 'idle';
  velocityPxPerMs: number;
}

export interface ThumbnailBackendRequest {
  generation: number;
  replacePending: boolean;
  requests: Array<{
    path: string;
    priority: number;
    demandClass: ThumbnailPriority;
    sourceRevision: null;
  }>;
}

export interface ThumbnailSchedulerMetrics {
  visibleDispatchMs: readonly number[];
  visibleResidentMs: readonly number[];
  firstVisibleResidentMs: readonly number[];
  queueSize: number;
  inFlightCount: number;
  queuePeak: number;
  inFlightPeak: number;
  staleQueuedRemoved: number;
  completedOutsideDemand: number;
  retryCount: number;
  ipcBatchCount: number;
  averageBatchSize: number;
}

type DemandClass = ThumbnailPriority;
type PathState =
  | { status: 'resident'; generation: number }
  | {
      status: 'queued';
      generation: number;
      priority: number;
      sequence: number;
      demandClass: DemandClass;
      attempts: number;
    }
  | {
      status: 'in-flight';
      generation: number;
      priority: number;
      attempts: number;
      requestedAt: number;
      demandClass: DemandClass;
    }
  | { status: 'failed'; generation: number; attempts: number; retryAt: number };

interface SchedulerDependencies {
  dispatch: (request: ThumbnailBackendRequest) => Promise<void> | void;
  isResident?: (path: string) => boolean;
  now?: () => number;
  requestFrame?: (callback: () => void) => number;
  cancelFrame?: (handle: number) => void;
  setTimer?: (callback: () => void, delayMs: number) => number;
  clearTimer?: (handle: number) => void;
  policy?: Partial<ThumbnailSchedulerPolicy>;
}

const TIER_BASE: Record<DemandClass, number> = {
  visible: 0,
  overscan: 10_000,
  lookahead: 20_000,
  background: 30_000,
};

let nextTimerHandle = 1;
const scheduledTimers = new Map<number, ReturnType<typeof setTimeout>>();

const scheduleTimer = (callback: () => void, delayMs: number): number => {
  const handle = nextTimerHandle++;
  const timer = globalThis.setTimeout(() => {
    scheduledTimers.delete(handle);
    callback();
  }, delayMs);
  scheduledTimers.set(handle, timer);
  return handle;
};

const cancelTimer = (handle: number): void => {
  const timer = scheduledTimers.get(handle);
  if (timer === undefined) return;
  globalThis.clearTimeout(timer);
  scheduledTimers.delete(handle);
};

export class ThumbnailDemandScheduler {
  private generation = 0;
  private sequence = 0;
  private states = new Map<string, PathState>();
  private demanded = new Set<string>();
  private visible = new Set<string>();
  private visibleSince = new Map<string, number>();
  private generationStartedAt = 0;
  private firstVisibleRecorded = false;
  private frameHandle: number | null = null;
  private timerHandle: number | null = null;
  private disposed = false;
  private dispatchedPaths = 0;
  private replacePendingNext = false;
  private metrics: ThumbnailSchedulerMetrics = {
    visibleDispatchMs: [],
    visibleResidentMs: [],
    firstVisibleResidentMs: [],
    queueSize: 0,
    inFlightCount: 0,
    queuePeak: 0,
    inFlightPeak: 0,
    staleQueuedRemoved: 0,
    completedOutsideDemand: 0,
    retryCount: 0,
    ipcBatchCount: 0,
    averageBatchSize: 0,
  };
  private readonly policy: ThumbnailSchedulerPolicy;
  private readonly now: () => number;
  private readonly requestFrame: (callback: () => void) => number;
  private readonly cancelFrame: (handle: number) => void;
  private readonly setTimer: SchedulerDependencies['setTimer'];
  private readonly clearTimer: SchedulerDependencies['clearTimer'];

  constructor(private readonly dependencies: SchedulerDependencies) {
    this.policy = { ...DEFAULT_THUMBNAIL_SCHEDULER_POLICY, ...dependencies.policy };
    this.now = dependencies.now ?? (() => performance.now());
    this.requestFrame = dependencies.requestFrame ?? ((callback) => requestAnimationFrame(callback));
    this.cancelFrame = dependencies.cancelFrame ?? ((handle) => cancelAnimationFrame(handle));
    this.setTimer = dependencies.setTimer ?? scheduleTimer;
    this.clearTimer = dependencies.clearTimer ?? cancelTimer;
  }

  get currentGeneration(): number {
    return this.generation;
  }

  beginGeneration(_reason: string): number {
    if (this.disposed) return this.generation;
    this.generation += 1;
    this.cancelScheduled();
    this.states.clear();
    this.demanded.clear();
    this.visible.clear();
    this.visibleSince.clear();
    this.generationStartedAt = this.now();
    this.firstVisibleRecorded = false;
    this.replacePendingNext = false;
    void this.dependencies.dispatch({ generation: this.generation, replacePending: true, requests: [] });
    this.refreshCounts();
    return this.generation;
  }

  updateViewport(demand: ThumbnailViewportDemand): void {
    if (this.disposed || demand.generation !== this.generation) return;
    const now = this.now();
    const nextDemanded = new Set([...demand.visiblePaths, ...demand.overscanPaths, ...demand.lookaheadPaths]);
    this.visible = new Set(demand.visiblePaths);

    for (const [path, state] of this.states) {
      if (state.generation !== this.generation) continue;
      if (state.status === 'queued' && !nextDemanded.has(path)) {
        this.states.delete(path);
        this.metrics.staleQueuedRemoved += 1;
      } else if (state.status === 'in-flight' && nextDemanded.has(path)) {
        // Same-generation replacement clears backend pending work but preserves
        // claimed jobs. Re-submit demanded paths; the backend deduplicates claims.
        this.states.set(path, {
          status: 'queued',
          generation: this.generation,
          priority: state.priority,
          sequence: this.sequence++,
          demandClass: state.demandClass,
          attempts: state.attempts,
        });
      }
    }
    this.demanded = nextDemanded;
    this.replacePendingNext = true;

    const addTier = (paths: readonly string[], demandClass: DemandClass) => {
      paths.forEach((path, distance) => {
        if (!path || this.dependencies.isResident?.(path)) {
          if (path) this.states.set(path, { status: 'resident', generation: this.generation });
          return;
        }
        if (demandClass === 'visible' && !this.visibleSince.has(path)) this.visibleSince.set(path, now);
        const existing = this.states.get(path);
        if (existing?.status === 'resident' || existing?.status === 'in-flight') return;
        const directionPenalty = demandClass === 'lookahead' && demand.direction === 'idle' ? 5_000 : 0;
        this.states.set(path, {
          status: 'queued',
          generation: this.generation,
          priority: TIER_BASE[demandClass] + distance * 10 + directionPenalty,
          sequence: existing?.status === 'queued' ? existing.sequence : this.sequence++,
          demandClass,
          attempts: existing?.status === 'queued' ? existing.attempts : 0,
        });
      });
    };
    addTier(demand.visiblePaths, 'visible');
    addTier(demand.overscanPaths, 'overscan');
    addTier(demand.lookaheadPaths, 'lookahead');
    this.refreshCounts();
    this.scheduleFrame();
  }

  requestBackground(paths: readonly string[]): void {
    if (this.disposed) return;
    const next = new Set(this.demanded);
    for (const path of paths) {
      if (!path || this.dependencies.isResident?.(path)) continue;
      next.add(path);
      const existing = this.states.get(path);
      if (existing?.status === 'resident' || existing?.status === 'queued' || existing?.status === 'in-flight')
        continue;
      this.states.set(path, {
        status: 'queued',
        generation: this.generation,
        priority: TIER_BASE.background,
        sequence: this.sequence++,
        demandClass: 'background',
        attempts: 0,
      });
    }
    this.demanded = next;
    this.refreshCounts();
    this.scheduleFrame();
  }

  markResident(path: string, generation = this.generation): boolean {
    if (this.disposed || generation !== this.generation) return false;
    const now = this.now();
    const started = this.visibleSince.get(path);
    if (started !== undefined) this.sample(this.metrics.visibleResidentMs as number[], now - started);
    if (this.visible.has(path) && !this.firstVisibleRecorded) {
      this.sample(this.metrics.firstVisibleResidentMs as number[], now - this.generationStartedAt);
      this.firstVisibleRecorded = true;
    }
    if (!this.demanded.has(path)) this.metrics.completedOutsideDemand += 1;
    this.states.set(path, { status: 'resident', generation });
    this.visibleSince.delete(path);
    this.refreshCounts();
    this.scheduleFrame();
    return true;
  }

  markFailed(path: string, errorCode?: string): void {
    const state = this.states.get(path);
    if (!state || state.generation !== this.generation || state.status !== 'in-flight') return;
    const permanent = errorCode === 'unsupported' || errorCode === 'corrupt';
    const attempts = state.attempts;
    if (permanent || attempts >= this.policy.maxAttempts || !this.visible.has(path)) {
      this.states.set(path, {
        status: 'failed',
        generation: this.generation,
        attempts,
        retryAt: Number.POSITIVE_INFINITY,
      });
      this.refreshCounts();
      return;
    }
    const retryAt = this.now() + this.policy.retryBaseMs * 2 ** (attempts - 1);
    this.states.set(path, { status: 'failed', generation: this.generation, attempts, retryAt });
    this.metrics.retryCount += 1;
    this.scheduleTimer(retryAt - this.now());
    this.refreshCounts();
  }

  invalidate(paths: readonly string[]): void {
    let shouldFlush = false;
    for (const path of paths) {
      this.states.delete(path);
      if (!this.demanded.has(path)) continue;
      this.states.set(path, {
        status: 'queued',
        generation: this.generation,
        priority: this.visible.has(path) ? TIER_BASE.visible : TIER_BASE.overscan,
        sequence: this.sequence++,
        demandClass: this.visible.has(path) ? 'visible' : 'overscan',
        attempts: 0,
      });
      shouldFlush = true;
    }
    this.refreshCounts();
    if (shouldFlush) this.scheduleFrame();
  }

  clear(): void {
    this.beginGeneration('clear');
  }

  dispose(): void {
    if (this.disposed) return;
    this.cancelScheduled();
    this.generation += 1;
    void this.dependencies.dispatch({ generation: this.generation, replacePending: true, requests: [] });
    this.states.clear();
    this.demanded.clear();
    this.visible.clear();
    this.disposed = true;
    this.refreshCounts();
  }

  getMetrics(): ThumbnailSchedulerMetrics {
    return {
      ...this.metrics,
      visibleDispatchMs: [...this.metrics.visibleDispatchMs],
      visibleResidentMs: [...this.metrics.visibleResidentMs],
      firstVisibleResidentMs: [...this.metrics.firstVisibleResidentMs],
    };
  }

  private scheduleFrame(): void {
    if (this.frameHandle !== null || this.timerHandle !== null || this.disposed) return;
    this.frameHandle = this.requestFrame(() => {
      this.frameHandle = null;
      this.flush();
    });
  }

  private scheduleTimer(delayMs: number): void {
    if (this.timerHandle !== null || this.disposed) return;
    this.timerHandle =
      this.setTimer?.(
        () => {
          this.timerHandle = null;
          this.promoteRetries();
          this.flush();
        },
        Math.max(0, delayMs),
      ) ?? null;
  }

  private promoteRetries(): void {
    const now = this.now();
    for (const [path, state] of this.states) {
      if (state.status !== 'failed' || state.retryAt > now || !this.visible.has(path)) continue;
      this.states.set(path, {
        status: 'queued',
        generation: this.generation,
        priority: 0,
        sequence: this.sequence++,
        demandClass: 'visible',
        attempts: state.attempts,
      });
    }
  }

  private flush(): void {
    if (this.disposed) return;
    this.promoteRetries();
    const inFlight = [...this.states.values()].filter((state) => state.status === 'in-flight').length;
    const capacity = Math.max(0, this.policy.maxInFlight - inFlight);
    const queued = [...this.states.entries()]
      .filter((entry): entry is [string, Extract<PathState, { status: 'queued' }>] => entry[1].status === 'queued')
      .sort((a, b) => a[1].priority - b[1].priority || a[1].sequence - b[1].sequence || a[0].localeCompare(b[0]));
    const batch = queued.slice(0, Math.min(capacity, this.policy.maxBatchSize));
    if (batch.length === 0) {
      this.refreshCounts();
      return;
    }
    const now = this.now();
    for (const [path, state] of batch) {
      if (state.demandClass === 'visible') {
        const started = this.visibleSince.get(path);
        if (started !== undefined) this.sample(this.metrics.visibleDispatchMs as number[], now - started);
      }
      this.states.set(path, {
        status: 'in-flight',
        generation: this.generation,
        priority: state.priority,
        attempts: state.attempts + 1,
        requestedAt: now,
        demandClass: state.demandClass,
      });
    }
    const request: ThumbnailBackendRequest = {
      generation: this.generation,
      replacePending: this.replacePendingNext,
      requests: batch.map(([path, state]) => ({
        path,
        priority: state.priority,
        demandClass: state.demandClass,
        sourceRevision: null,
      })),
    };
    this.replacePendingNext = false;
    this.metrics.ipcBatchCount += 1;
    this.dispatchedPaths += batch.length;
    this.metrics.averageBatchSize = this.dispatchedPaths / this.metrics.ipcBatchCount;
    this.refreshCounts();
    Promise.resolve(this.dependencies.dispatch(request)).catch(() => {
      for (const [path] of batch) this.markFailed(path);
    });
    if (queued.length > batch.length && capacity > batch.length) this.scheduleTimer(this.policy.continuationDelayMs);
  }

  private sample(samples: number[], value: number): void {
    if (samples.length < this.policy.metricsSampleLimit) samples.push(value);
  }

  private refreshCounts(): void {
    let queued = 0;
    let inFlight = 0;
    for (const state of this.states.values()) {
      if (state.status === 'queued') queued += 1;
      else if (state.status === 'in-flight') inFlight += 1;
    }
    this.metrics.queueSize = queued;
    this.metrics.inFlightCount = inFlight;
    this.metrics.queuePeak = Math.max(this.metrics.queuePeak, queued);
    this.metrics.inFlightPeak = Math.max(this.metrics.inFlightPeak, inFlight);
  }

  private cancelScheduled(): void {
    if (this.frameHandle !== null) this.cancelFrame(this.frameHandle);
    if (this.timerHandle !== null) this.clearTimer?.(this.timerHandle);
    this.frameHandle = null;
    this.timerHandle = null;
  }
}
