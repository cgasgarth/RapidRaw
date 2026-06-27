import { useCallback } from 'react';
import { toast } from 'react-toastify';

import { folderTreeListSchema } from '../schemas/folderTreeSchemas';
import { useLibraryStore } from '../store/useLibraryStore';
import { Invokes } from '../tauri/commands';
import { insertChildrenIntoTree } from '../utils/folderTreeUtils';
import { invokeWithSchema } from '../utils/tauriSchemaInvoke';

export const useFolderExpansionLoader = (showImageCounts: boolean) => {
  const setLibrary = useLibraryStore((state) => state.setLibrary);

  return useCallback(
    async (path: string) => {
      const wasExpanded = useLibraryStore.getState().expandedFolders.has(path);

      setLibrary((state) => {
        const expandedFolders = new Set(state.expandedFolders);
        if (wasExpanded) {
          expandedFolders.delete(path);
        } else {
          expandedFolders.add(path);
        }
        return { expandedFolders };
      });

      if (wasExpanded) return;

      try {
        const children = await invokeWithSchema(
          Invokes.GetFolderChildren,
          {
            path,
            showImageCounts,
          },
          folderTreeListSchema,
        );

        setLibrary((state) => ({
          folderTrees: state.folderTrees.map((tree) => insertChildrenIntoTree(tree, path, children)),
          pinnedFolderTrees: state.pinnedFolderTrees.map((tree) => insertChildrenIntoTree(tree, path, children)),
        }));
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        toast.error(`Failed to load folder: ${message}`);
      }
    },
    [setLibrary, showImageCounts],
  );
};
