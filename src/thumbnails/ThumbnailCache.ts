export interface ThumbnailSmartPreviewState {
  colorProfile: string;
  height: number;
  source: string;
  sourceAvailable: boolean;
  sourceRevision: string;
  stale: boolean;
  width: number;
}

export interface ThumbnailCacheEntry {
  readonly generation: number;
  readonly path: string;
  readonly revision: number;
  readonly smartPreview: ThumbnailSmartPreviewState | null;
  readonly updatedAt: number;
  readonly url: string | null;
}

export interface ThumbnailCacheMutation {
  readonly generation: number;
  readonly path: string;
  readonly smartPreview?: ThumbnailSmartPreviewState | null;
  readonly url?: string | null;
}

export interface ThumbnailCacheStats {
  readonly estimatedBytes: number;
  readonly generation: number;
  readonly residentCount: number;
  readonly revision: number;
}

type Listener = () => void;

const sameSmartPreview = (a: ThumbnailSmartPreviewState | null, b: ThumbnailSmartPreviewState | null): boolean =>
  a === b ||
  (a !== null &&
    b !== null &&
    a.colorProfile === b.colorProfile &&
    a.height === b.height &&
    a.source === b.source &&
    a.sourceAvailable === b.sourceAvailable &&
    a.sourceRevision === b.sourceRevision &&
    a.stale === b.stale &&
    a.width === b.width);

export class ThumbnailCache {
  private readonly entries = new Map<string, ThumbnailCacheEntry>();
  private readonly listeners = new Map<string, Set<Listener>>();
  private readonly statsListeners = new Set<Listener>();
  private estimatedBytes = 0;
  private generation = 0;
  private revision = 0;
  private statsSnapshot: ThumbnailCacheStats = { estimatedBytes: 0, generation: 0, residentCount: 0, revision: 0 };

  constructor(private readonly release?: (path: string) => void) {}

  get(path: string): ThumbnailCacheEntry | undefined {
    return this.entries.get(path);
  }

  getSnapshot(path: string): ThumbnailCacheEntry | undefined {
    return this.entries.get(path);
  }

  has(path: string): boolean {
    return this.entries.has(path);
  }

  subscribe(path: string, listener: Listener): () => void {
    let pathListeners = this.listeners.get(path);
    if (!pathListeners) {
      pathListeners = new Set();
      this.listeners.set(path, pathListeners);
    }
    pathListeners.add(listener);
    return () => {
      pathListeners?.delete(listener);
      if (pathListeners?.size === 0) this.listeners.delete(path);
    };
  }

  subscribeStats(listener: Listener): () => void {
    this.statsListeners.add(listener);
    return () => this.statsListeners.delete(listener);
  }

  getStatsSnapshot(): ThumbnailCacheStats {
    return this.statsSnapshot;
  }

  setMany(mutations: readonly ThumbnailCacheMutation[]): void {
    const deduplicated = new Map<string, ThumbnailCacheMutation>();
    for (const mutation of mutations) {
      const pending = deduplicated.get(mutation.path);
      deduplicated.set(mutation.path, pending ? { ...pending, ...mutation } : mutation);
    }

    const changed: string[] = [];
    for (const mutation of deduplicated.values()) {
      const current = this.entries.get(mutation.path);
      if (current && mutation.generation < current.generation) continue;
      const url = mutation.url === undefined ? (current?.url ?? null) : mutation.url;
      const smartPreview =
        mutation.smartPreview === undefined ? (current?.smartPreview ?? null) : mutation.smartPreview;
      if (current && current.url === url && sameSmartPreview(current.smartPreview, smartPreview)) continue;

      this.estimatedBytes += (url?.length ?? 0) * 2 - (current?.url?.length ?? 0) * 2;
      this.revision += 1;
      this.generation = Math.max(this.generation, mutation.generation);
      this.entries.set(mutation.path, {
        generation: mutation.generation,
        path: mutation.path,
        revision: this.revision,
        smartPreview,
        updatedAt: Date.now(),
        url,
      });
      changed.push(mutation.path);
    }
    this.notify(changed);
  }

  deleteMany(paths: readonly string[]): void {
    const changed: string[] = [];
    for (const path of new Set(paths)) {
      const current = this.entries.get(path);
      if (!current) continue;
      this.entries.delete(path);
      this.estimatedBytes -= (current.url?.length ?? 0) * 2;
      this.revision += 1;
      this.release?.(path);
      changed.push(path);
    }
    this.notify(changed);
  }

  clearGeneration(generation?: number): void {
    const paths =
      generation === undefined
        ? Array.from(this.entries.keys())
        : Array.from(this.entries.values(), (entry) => (entry.generation === generation ? entry.path : null)).filter(
            (path): path is string => path !== null,
          );
    this.deleteMany(paths);
    if (generation !== undefined) this.generation = Math.max(this.generation, generation);
  }

  /** Test/diagnostic signal for subscription leak checks. */
  getSubscribedPathCount(): number {
    return this.listeners.size;
  }

  private notify(paths: readonly string[]): void {
    if (paths.length === 0) return;
    this.statsSnapshot = {
      estimatedBytes: this.estimatedBytes,
      generation: this.generation,
      residentCount: this.entries.size,
      revision: this.revision,
    };
    for (const path of paths) {
      for (const listener of this.listeners.get(path) ?? []) listener();
    }
    for (const listener of this.statsListeners) listener();
  }
}
