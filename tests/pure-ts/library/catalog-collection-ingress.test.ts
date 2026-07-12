import { describe, expect, test } from 'bun:test';

import type { ImageFile } from '../../../src/components/ui/AppProperties';
import { libraryEntityRepository } from '../../../src/library/LibraryEntityRepository';
import { useLibraryStore } from '../../../src/store/useLibraryStore';

const image = (path: string, rating = 0): ImageFile => ({
  path,
  modified: 1,
  is_edited: false,
  rating,
  tags: null,
  exif: null,
  is_virtual_copy: false,
});

describe('catalog collection ingress', () => {
  test('rejects stale pages and applies rename/delete deltas to order and entities', () => {
    const store = useLibraryStore.getState();
    store.replaceCatalogCollection(41, 7, [image('/root/alpha.ARW'), image('/root/old.ARW', 4)]);

    expect(store.appendCatalogPage(40, 7, [image('/root/stale.ARW')])).toBe(false);
    expect(useLibraryStore.getState().imageList.map((row) => row.path)).toEqual(['/root/alpha.ARW', '/root/old.ARW']);

    useLibraryStore.getState().applyCatalogDelta(8, [image('/root/renamed.ARW', 4)], ['/root/old.ARW']);
    const current = useLibraryStore.getState();
    expect(current.catalogRevision).toBe(8);
    expect(current.catalogOrderedImageIds).toEqual(['/root/alpha.ARW', '/root/renamed.ARW']);
    expect(current.imageList.map((row) => [row.path, row.rating])).toEqual([
      ['/root/alpha.ARW', 0],
      ['/root/renamed.ARW', 4],
    ]);
    expect(libraryEntityRepository.get('/root/old.ARW')).toBeUndefined();
    expect(libraryEntityRepository.get('/root/renamed.ARW')?.rating).toBe(4);
  });
});
