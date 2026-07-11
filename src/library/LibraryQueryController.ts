import { queryLibraryProjections, type SerializedCompiledLibraryQuery } from './libraryQuery';
import type { LibraryQueryWorkerCommand, LibraryQueryWorkerResult } from './libraryQueryWorkerProtocol';
import type { LibrarySearchProjection } from './LibrarySearchProjection';

export interface LibraryQueryState {
  committedQueryRevision: number;
  matchedCount: number;
  orderedPaths: readonly string[];
  pendingQueryRevision: number | null;
  status: 'hydrating' | 'ready' | 'querying' | 'error';
}

export interface LibraryQueryWorkerLike {
  onerror: ((event: ErrorEvent) => void) | null;
  onmessage: ((event: MessageEvent<LibraryQueryWorkerResult>) => void) | null;
  postMessage(command: LibraryQueryWorkerCommand): void;
  terminate(): void;
}

const INITIAL_STATE: LibraryQueryState = {
  committedQueryRevision: 0,
  matchedCount: 0,
  orderedPaths: [],
  pendingQueryRevision: null,
  status: 'hydrating',
};

export class LibraryQueryController {
  private currentProjections = new Map<string, LibrarySearchProjection>();
  private indexRevision = 0;
  private listeners = new Set<() => void>();
  private pendingCriteria: SerializedCompiledLibraryQuery | null = null;
  private queryRevision = 0;
  private requestId = 0;
  private state = INITIAL_STATE;
  private worker: LibraryQueryWorkerLike | null;

  constructor(workerFactory: () => LibraryQueryWorkerLike | null) {
    this.worker = workerFactory();
    if (this.worker) {
      this.worker.onmessage = (event) => this.handleResult(event.data);
      this.worker.onerror = () => this.activateFallback();
    }
  }

  getSnapshot = (): LibraryQueryState => this.state;

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  syncIndex(projections: LibrarySearchProjection[]): void {
    const next = new Map(projections.map((projection) => [projection.path, projection]));
    if (this.indexRevision === 0 || next.size === 0 || this.currentProjections.size === 0) {
      this.currentProjections = next;
      this.indexRevision++;
      this.post({ type: 'hydrate', indexRevision: this.indexRevision, projections });
      return;
    }

    const removed = [...this.currentProjections.keys()].filter((path) => !next.has(path));
    const upserted = projections.filter((projection) => {
      const previous = this.currentProjections.get(projection.path);
      return !previous || !sameProjection(previous, projection);
    });
    this.currentProjections = next;
    if (removed.length === 0 && upserted.length === 0) return;
    if (removed.length > 0) {
      this.indexRevision++;
      this.post({ type: 'remove', indexRevision: this.indexRevision, paths: removed });
    }
    if (upserted.length > 0) {
      this.indexRevision++;
      this.post({ type: 'upsert', indexRevision: this.indexRevision, projections: upserted });
    }
  }

  query(criteria: SerializedCompiledLibraryQuery): void {
    const requestId = ++this.requestId;
    const queryRevision = ++this.queryRevision;
    this.pendingCriteria = criteria;
    this.setState({ ...this.state, pendingQueryRevision: queryRevision, status: 'querying' });
    if (!this.worker) {
      setTimeout(() => this.runFallback(requestId, queryRevision, criteria), 0);
      return;
    }
    this.post({ type: 'query', requestId, indexRevision: this.indexRevision, queryRevision, criteria });
  }

  dispose(): void {
    if (!this.worker) return;
    this.post({ type: 'dispose' });
    this.worker.terminate();
    this.worker = null;
    this.listeners.clear();
  }

  private post(command: LibraryQueryWorkerCommand): void {
    this.worker?.postMessage(command);
  }

  private handleResult(result: LibraryQueryWorkerResult): void {
    if (result.type === 'error') {
      this.activateFallback();
      return;
    }
    if (result.type !== 'result') return;
    if (
      result.requestId !== this.requestId ||
      result.queryRevision !== this.queryRevision ||
      result.indexRevision !== this.indexRevision
    )
      return;
    this.pendingCriteria = null;
    this.setState({
      committedQueryRevision: result.queryRevision,
      matchedCount: result.matchedCount,
      orderedPaths: result.orderedPaths,
      pendingQueryRevision: null,
      status: 'ready',
    });
  }

  private activateFallback(): void {
    this.worker?.terminate();
    this.worker = null;
    this.setState({ ...this.state, status: 'error' });
    const pendingCriteria = this.pendingCriteria;
    if (pendingCriteria && this.state.pendingQueryRevision !== null) {
      setTimeout(() => this.runFallback(this.requestId, this.queryRevision, pendingCriteria), 0);
    }
  }

  private runFallback(requestId: number, queryRevision: number, criteria: SerializedCompiledLibraryQuery): void {
    if (requestId !== this.requestId || queryRevision !== this.queryRevision) return;
    const orderedPaths = queryLibraryProjections([...this.currentProjections.values()], criteria);
    if (requestId !== this.requestId || queryRevision !== this.queryRevision) return;
    this.pendingCriteria = null;
    this.setState({
      committedQueryRevision: queryRevision,
      matchedCount: orderedPaths.length,
      orderedPaths,
      pendingQueryRevision: null,
      status: 'ready',
    });
  }

  private setState(state: LibraryQueryState): void {
    this.state = state;
    for (const listener of this.listeners) listener();
  }
}

function sameProjection(a: LibrarySearchProjection, b: LibrarySearchProjection): boolean {
  return a.entityRevision === b.entityRevision;
}
