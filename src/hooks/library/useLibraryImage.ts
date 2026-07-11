import { useSyncExternalStore } from 'react';
import type { LibraryImageEntity } from '../../library/LibraryEntityRepository';
import { libraryEntityRepository } from '../../library/LibraryEntityRepository';

export function useLibraryImage(path: string): LibraryImageEntity | undefined {
  return useSyncExternalStore(
    (listener) => libraryEntityRepository.subscribe(path, listener),
    () => libraryEntityRepository.getSnapshot(path),
    () => libraryEntityRepository.getSnapshot(path),
  );
}
