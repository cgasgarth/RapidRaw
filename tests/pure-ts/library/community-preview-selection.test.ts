import { expect, test } from 'bun:test';
import {
  chooseCommunityPreviewPaths,
  createCommunityPreviewSession,
} from '../../../src/components/panel/communityPreviewSession';
import type { ImageFile } from '../../../src/components/ui/AppProperties';

const image = (path: string): ImageFile => ({
  exif: null,
  is_edited: false,
  is_virtual_copy: false,
  modified: 0,
  path,
  rating: 0,
  tags: null,
});

test('chooses the required deterministic source count without mutating input', () => {
  for (const [count, expected] of [
    [0, 0],
    [1, 1],
    [2, 2],
    [3, 2],
    [4, 4],
    [9, 4],
  ] as const) {
    const paths = Array.from({ length: count }, (_, index) => `/opaque Folder/IMG ${index}.RAW`);
    const original = [...paths];
    const selected = chooseCommunityPreviewPaths(paths, 'folder-session');
    expect(selected).toHaveLength(expected);
    expect(paths).toEqual(original);
    expect(chooseCommunityPreviewPaths([...paths].reverse(), 'folder-session')).toEqual(selected);
  }
});

test('uses ordered image identities so equivalent list allocations share a session', () => {
  const first = createCommunityPreviewSession('/Volumes/Photo Library', [image('/b.NEF'), image('/a.NEF')]);
  const equivalent = createCommunityPreviewSession('/Volumes/Photo Library', [image('/a.NEF'), image('/b.NEF')]);
  const otherFolder = createCommunityPreviewSession('/Volumes/Other', [image('/a.NEF'), image('/b.NEF')]);

  expect(equivalent).toEqual(first);
  expect(otherFolder.id).not.toBe(first.id);
  expect(createCommunityPreviewSession(null, [image('/a.NEF')]).localPaths).toEqual([]);
});
