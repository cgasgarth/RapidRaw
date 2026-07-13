import { resolve } from 'node:path';
import type { QaDaemonIdentity, QaDaemonMetrics } from './daemon-model';

export interface QaDaemonJob {
  scenarioIds: readonly string[];
  shard: { index: number; total: number };
}

export interface QaLifecycleAdapter<Session, Result> {
  start(identity: QaDaemonIdentity): Promise<Session>;
  stop(session: Session): Promise<void>;
  refresh?(session: Session, identity: QaDaemonIdentity, metrics: QaDaemonMetrics): Promise<void>;
  run(session: Session, job: QaDaemonJob, metrics: QaDaemonMetrics, signal: AbortSignal): Promise<Result>;
}

const emptyMetrics = (): QaDaemonMetrics => ({
  serverStarts: 0,
  browserStarts: 0,
  serverStartsAvoided: 0,
  browserStartsAvoided: 0,
  sourceReuses: 0,
  configurationRestarts: 0,
  jobs: 0,
  setupMs: 0,
  scenarioMs: 0,
  worktreeWaitMs: 0,
  artifactBytes: 0,
  contextsCreated: 0,
  contextsClosed: 0,
  leakedContexts: 0,
});

export class QaDaemonEngine<Session, Result> {
  readonly metrics = emptyMetrics();
  #active: { identity: QaDaemonIdentity; session: Session } | undefined;
  #activeJob: AbortController | undefined;
  #queue: Promise<void> = Promise.resolve();

  constructor(
    private readonly ownerWorktree: string,
    private readonly adapter: QaLifecycleAdapter<Session, Result>,
  ) {}

  async run(identity: QaDaemonIdentity, job: QaDaemonJob): Promise<Result> {
    if (resolve(identity.worktree) !== resolve(this.ownerWorktree)) {
      throw new Error(`QA daemon belongs to ${this.ownerWorktree}, not ${identity.worktree}.`);
    }
    let release!: () => void;
    const previous = this.#queue;
    this.#queue = new Promise<void>((done) => {
      release = done;
    });
    const queuedAt = performance.now();
    await previous;
    this.metrics.worktreeWaitMs += Math.round(performance.now() - queuedAt);
    try {
      const active = this.#active;
      const requiresRestart =
        active === undefined ||
        active.identity.configuration !== identity.configuration ||
        active.identity.headed !== identity.headed;
      if (requiresRestart) {
        if (active !== undefined) {
          await this.adapter.stop(active.session);
          this.#active = undefined;
          this.metrics.configurationRestarts += 1;
        }
        const setupStarted = performance.now();
        const session = await this.adapter.start(identity);
        this.metrics.setupMs += Math.round(performance.now() - setupStarted);
        this.metrics.serverStarts += 1;
        this.metrics.browserStarts += 1;
        this.#active = { identity, session };
      } else if (active.identity.source !== identity.source) {
        const setupStarted = performance.now();
        await this.adapter.refresh?.(active.session, identity, this.metrics);
        this.metrics.setupMs += Math.round(performance.now() - setupStarted);
        this.metrics.sourceReuses += 1;
        active.identity = identity;
      }
      if (!requiresRestart) {
        this.metrics.serverStartsAvoided += 1;
        this.metrics.browserStartsAvoided += 1;
      }
      this.metrics.jobs += 1;
      const current = this.#active;
      if (current === undefined) throw new Error('QA daemon failed to establish a session.');
      const controller = new AbortController();
      this.#activeJob = controller;
      try {
        const scenarioStarted = performance.now();
        try {
          return await this.adapter.run(current.session, job, this.metrics, controller.signal);
        } finally {
          this.metrics.scenarioMs += Math.round(performance.now() - scenarioStarted);
        }
      } finally {
        if (this.#activeJob === controller) this.#activeJob = undefined;
      }
    } finally {
      release();
    }
  }

  async close(): Promise<void> {
    this.cancel();
    await this.#queue;
    if (this.#active !== undefined) {
      await this.adapter.stop(this.#active.session);
      this.#active = undefined;
    }
  }

  cancel(): void {
    this.#activeJob?.abort(new Error('QA daemon job cancelled.'));
  }
}
