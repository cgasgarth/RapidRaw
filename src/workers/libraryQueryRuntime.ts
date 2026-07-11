import type { LibrarySearchProjection } from '../library/LibrarySearchProjection';
import { queryLibraryProjections } from '../library/libraryQuery';
import type { LibraryQueryWorkerCommand, LibraryQueryWorkerResult } from '../library/libraryQueryWorkerProtocol';

export interface LibraryQueryRuntime {
  handle(command: LibraryQueryWorkerCommand): void;
}

export function createLibraryQueryRuntime(emit: (result: LibraryQueryWorkerResult) => void): LibraryQueryRuntime {
  const index = new Map<string, LibrarySearchProjection>();
  let indexRevision = 0;
  let disposed = false;
  let pendingQuery: Extract<LibraryQueryWorkerCommand, { type: 'query' }> | null = null;
  let queryScheduled = false;

  const requireNextRevision = (revision: number) => {
    if (revision === indexRevision + 1) return true;
    emit({
      type: 'error',
      code: 'INDEX_RESYNC_REQUIRED',
      message: `Expected index revision ${indexRevision + 1}, received ${revision}`,
    });
    return false;
  };

  const scheduleQuery = () => {
    if (queryScheduled) return;
    queryScheduled = true;
    setTimeout(() => {
      queryScheduled = false;
      const query = pendingQuery;
      pendingQuery = null;
      if (!query || disposed) return;
      if (query.indexRevision !== indexRevision) {
        emit({
          type: 'error',
          requestId: query.requestId,
          code: 'INDEX_RESYNC_REQUIRED',
          message: `Query index revision ${query.indexRevision} does not match ${indexRevision}`,
        });
        return;
      }
      const started = performance.now();
      try {
        const orderedPaths = queryLibraryProjections([...index.values()], query.criteria);
        emit({
          type: 'result',
          requestId: query.requestId,
          indexRevision,
          queryRevision: query.queryRevision,
          orderedPaths,
          matchedCount: orderedPaths.length,
          durationMs: performance.now() - started,
        });
      } catch (error) {
        emit({
          type: 'error',
          requestId: query.requestId,
          code: 'QUERY_FAILED',
          message: error instanceof Error ? error.message : String(error),
        });
      }
      if (pendingQuery) scheduleQuery();
    }, 0);
  };

  return {
    handle(command) {
      if (disposed) return;
      if (command.type === 'dispose') {
        disposed = true;
        index.clear();
      } else if (command.type === 'hydrate') {
        index.clear();
        for (const projection of command.projections) index.set(projection.path, projection);
        indexRevision = command.indexRevision;
        emit({ type: 'ready', indexRevision, itemCount: index.size });
      } else if (command.type === 'upsert') {
        if (!requireNextRevision(command.indexRevision)) return;
        for (const projection of command.projections) index.set(projection.path, projection);
        indexRevision = command.indexRevision;
        emit({ type: 'ready', indexRevision, itemCount: index.size });
      } else if (command.type === 'remove') {
        if (!requireNextRevision(command.indexRevision)) return;
        for (const path of command.paths) index.delete(path);
        indexRevision = command.indexRevision;
        emit({ type: 'ready', indexRevision, itemCount: index.size });
      } else {
        pendingQuery = command;
        scheduleQuery();
      }
    },
  };
}
