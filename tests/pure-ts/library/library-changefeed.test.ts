import { describe, expect, test } from 'bun:test';
import type { ImageFile } from '../../../src/components/ui/AppProperties';
import {
  applyFolderCountDeltas,
  applyLibraryChangeRows,
  libraryChangeBatchSchema,
} from '../../../src/hooks/library/useSelectedFolderRefreshWatcher';

const row = (path: string, rating = 0): ImageFile => ({
  exif: null,
  is_edited: false,
  is_virtual_copy: path.includes('?vc='),
  modified: 1,
  path,
  rating,
  tags: null,
});

describe('library filesystem changefeed', () => {
  test('patches only changed physical identities while preserving unrelated rows and selection identities', () => {
    const current = [row('/library/a.raw'), row('/library/a.raw?vc=one'), row('/library/b.raw')];
    const result = applyLibraryChangeRows(current, new Set(), [
      row('/library/a.raw', 4),
      row('/library/a.raw?vc=one', 4),
    ]);
    expect(result).toEqual([row('/library/b.raw'), row('/library/a.raw', 4), row('/library/a.raw?vc=one', 4)]);
  });

  test('removes every virtual row when its physical source is deleted', () => {
    const result = applyLibraryChangeRows(
      [row('/library/a.raw'), row('/library/a.raw?vc=one'), row('/library/b.raw')],
      new Set(['/library/a.raw']),
      [],
    );
    expect(result).toEqual([row('/library/b.raw')]);
  });

  test('adjusts only affected folder ancestors', () => {
    const trees = [
      {
        children: [{ children: [], isDir: true, name: 'day', path: '/library/day', imageCount: 2 }],
        isDir: true,
        name: 'library',
        path: '/library',
        imageCount: 2,
      },
    ];
    const result = applyFolderCountDeltas(trees, new Map([['/library/day/new.raw', 1]]));
    expect(result[0]?.imageCount).toBe(3);
    expect(result[0]?.children[0]?.imageCount).toBe(3);
  });

  test('rejects malformed revision batches before they reach the store', () => {
    expect(
      libraryChangeBatchSchema.safeParse({
        watchGeneration: 1,
        catalogRevisionBefore: 0,
        catalogRevisionAfter: 1,
        rootId: '/library',
        changes: [{ kind: 'modified', path: '/library/a.raw', class: 'source' }],
        overflowed: false,
        requiresReconcile: false,
      }).success,
    ).toBe(true);
    expect(libraryChangeBatchSchema.safeParse({ watchGeneration: 1, changes: [] }).success).toBe(false);
  });
});
