import { expect, test } from 'bun:test';

import { findAlbumById, insertChildrenIntoTree } from '../../src/utils/folderTreeUtils.ts';

import type { FolderTree } from '../../src/components/panel/FolderTree.tsx';
import type { AlbumItem } from '../../src/components/ui/AppProperties.tsx';

const folderNode = (path: string, children: FolderTree[] = []): FolderTree => ({
  children,
  isExpanded: false,
  isLoading: false,
  name: path.split('/').pop() ?? path,
  path,
});

test('findAlbumById finds nested albums and returns null for misses', () => {
  const albumTree: AlbumItem[] = [
    {
      children: [
        {
          id: 'target',
          images: ['/image.raw'],
          name: 'Target',
          type: 'album',
        },
      ],
      id: 'group',
      name: 'Group',
      type: 'group',
    },
  ];

  expect(findAlbumById(albumTree, 'target')?.name).toBe('Target');
  expect(findAlbumById(albumTree, 'missing')).toBeNull();
});

test('insertChildrenIntoTree preserves already-expanded grandchildren for matching children', () => {
  const tree = folderNode('/root', [folderNode('/root/a', [folderNode('/root/a/expanded')]), folderNode('/root/b')]);

  const result = insertChildrenIntoTree(tree, '/root', [folderNode('/root/a'), folderNode('/root/c')]);

  expect(result.children.map((child) => child.path)).toEqual(['/root/a', '/root/c']);
  expect(result.children[0]?.children.map((child) => child.path)).toEqual(['/root/a/expanded']);
});

test('insertChildrenIntoTree updates nested target without mutating sibling branches', () => {
  const tree = folderNode('/root', [folderNode('/root/a'), folderNode('/root/b')]);

  const result = insertChildrenIntoTree(tree, '/root/b', [folderNode('/root/b/new')]);

  expect(result.children[0]).toBe(tree.children[0]);
  expect(result.children[1]?.children.map((child) => child.path)).toEqual(['/root/b/new']);
});
