import type { FolderTree } from '../components/panel/FolderTree';
import type { Album, AlbumItem } from '../components/ui/AppProperties';

export const findAlbumById = (nodes: AlbumItem[], albumId: string): Album | null => {
  for (const node of nodes) {
    if (node.type === 'album' && node.id === albumId) {
      return node;
    }

    if (node.type === 'group') {
      const found = findAlbumById(node.children, albumId);
      if (found) return found;
    }
  }

  return null;
};

export const insertChildrenIntoTree = (node: FolderTree, targetPath: string, newChildren: FolderTree[]): FolderTree => {
  if (node.path === targetPath) {
    const mergedChildren = newChildren.map((newChild) => {
      const existingChild = node.children.find((child) => child.path === newChild.path);
      if (existingChild && existingChild.children.length > 0) {
        return { ...newChild, children: existingChild.children };
      }
      return newChild;
    });
    return { ...node, children: mergedChildren };
  }

  if (node.children.length > 0) {
    return {
      ...node,
      children: node.children.map((child) => insertChildrenIntoTree(child, targetPath, newChildren)),
    };
  }

  return node;
};
