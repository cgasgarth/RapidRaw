import { expect, test } from 'bun:test';
import type { ImageFile } from '../../../src/components/ui/AppProperties.tsx';
import { reconcileSelectedFolderRefresh } from '../../../src/hooks/library/selectedFolderRefreshReconciliation.ts';

const image = (path: string, overrides: Partial<ImageFile> = {}): ImageFile => ({
  exif: null,
  is_edited: false,
  is_virtual_copy: false,
  modified: 100,
  path,
  rating: 0,
  tags: null,
  ...overrides,
});

test('selected folder refresh preserves valid selection and reports added linked variants', () => {
  const previousImages = [image('/photos/one.raw'), image('/photos/two.raw')];
  const nextImages = [...previousImages, image('/photos/one-edit.tiff')];

  const result = reconcileSelectedFolderRefresh(previousImages, nextImages, {
    libraryActivePath: '/photos/one.raw',
    multiSelectedPaths: ['/photos/one.raw', '/photos/two.raw'],
    selectionAnchorPath: '/photos/two.raw',
  });

  expect(result.addedPaths).toEqual(['/photos/one-edit.tiff']);
  expect(result.changedPaths).toEqual([]);
  expect(result.removedPaths).toEqual([]);
  expect(result.nextLibraryActivePath).toBe('/photos/one.raw');
  expect(result.nextMultiSelectedPaths).toEqual(['/photos/one.raw', '/photos/two.raw']);
  expect(result.nextSelectionAnchorPath).toBe('/photos/two.raw');
});

test('selected folder refresh prunes deleted or renamed selections', () => {
  const previousImages = [image('/photos/one.raw'), image('/photos/two.raw'), image('/photos/three.raw')];
  const nextImages = [image('/photos/one.raw'), image('/photos/three-renamed.raw')];

  const result = reconcileSelectedFolderRefresh(previousImages, nextImages, {
    libraryActivePath: '/photos/two.raw',
    multiSelectedPaths: ['/photos/one.raw', '/photos/two.raw'],
    selectionAnchorPath: '/photos/two.raw',
  });

  expect(result.addedPaths).toEqual(['/photos/three-renamed.raw']);
  expect(result.removedPaths).toEqual(['/photos/two.raw', '/photos/three.raw']);
  expect(result.nextLibraryActivePath).toBeNull();
  expect(result.nextMultiSelectedPaths).toEqual(['/photos/one.raw']);
  expect(result.nextSelectionAnchorPath).toBeNull();
});

test('selected folder refresh reports thumbnail-invalidating file metadata changes', () => {
  const previousImages = [image('/photos/one.raw', { modified: 100, rating: 1 })];
  const nextImages = [image('/photos/one.raw', { modified: 200, rating: 1 })];

  const result = reconcileSelectedFolderRefresh(previousImages, nextImages, {
    libraryActivePath: '/photos/one.raw',
    multiSelectedPaths: ['/photos/one.raw'],
    selectionAnchorPath: '/photos/one.raw',
  });

  expect(result.addedPaths).toEqual([]);
  expect(result.changedPaths).toEqual(['/photos/one.raw']);
  expect(result.removedPaths).toEqual([]);
  expect(result.nextMultiSelectedPaths).toEqual(['/photos/one.raw']);
});
