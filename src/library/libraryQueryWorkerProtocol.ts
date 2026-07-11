import type { SerializedCompiledLibraryQuery } from './libraryQuery';
import type { LibrarySearchProjection } from './LibrarySearchProjection';

export type LibraryQueryWorkerCommand =
  | { type: 'hydrate'; indexRevision: number; projections: LibrarySearchProjection[] }
  | { type: 'upsert'; indexRevision: number; projections: LibrarySearchProjection[] }
  | { type: 'remove'; indexRevision: number; paths: string[] }
  | {
      type: 'query';
      requestId: number;
      indexRevision: number;
      queryRevision: number;
      criteria: SerializedCompiledLibraryQuery;
    }
  | { type: 'dispose' };

export type LibraryQueryWorkerResult =
  | { type: 'ready'; indexRevision: number; itemCount: number }
  | {
      type: 'result';
      requestId: number;
      indexRevision: number;
      queryRevision: number;
      orderedPaths: string[];
      matchedCount: number;
      durationMs: number;
    }
  | { type: 'error'; requestId?: number; code: 'INDEX_RESYNC_REQUIRED' | 'QUERY_FAILED'; message: string };
