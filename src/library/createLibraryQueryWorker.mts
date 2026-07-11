import type { LibraryQueryWorkerLike } from './LibraryQueryController.js';

export function createLibraryQueryWorker(): LibraryQueryWorkerLike | null {
  if (typeof Worker === 'undefined') return null;
  return new Worker(new URL('../workers/libraryQuery.worker.ts', import.meta.url), { type: 'module' });
}
