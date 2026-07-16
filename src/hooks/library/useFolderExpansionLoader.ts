import { useCallback } from 'react';
import { toast } from 'react-toastify';
import { folderTreeListSchema } from '../../schemas/library/folderTreeSchemas';
import { libraryFolderAggregateListSchema } from '../../schemas/library/libraryCatalogSchemas';
import { useLibraryStore } from '../../store/useLibraryStore';
import { Invokes } from '../../tauri/commands';
import { insertChildrenIntoTree } from '../../utils/folderTreeUtils';
import { invokeWithSchema } from '../../utils/tauriSchemaInvoke';

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

        const aggregates = showImageCounts
          ? await invokeWithSchema(
              Invokes.GetLibraryFolderAggregates,
              { paths: children.map((child) => child.path) },
              libraryFolderAggregateListSchema,
            )
          : [];
        const counts = new Map(aggregates.map((aggregate) => [aggregate.path, aggregate.recursiveImageCount]));
        const countedChildren = children.map((child) => ({
          ...child,
          ...(counts.has(child.path) ? { imageCount: counts.get(child.path) } : {}),
        }));
        setLibrary((state) => ({
          folderTrees: state.folderTrees.map((tree) => insertChildrenIntoTree(tree, path, countedChildren)),
          pinnedFolderTrees: state.pinnedFolderTrees.map((tree) => insertChildrenIntoTree(tree, path, countedChildren)),
        }));
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        toast.error(`Failed to load folder: ${message}`);
      }
    },
    [setLibrary, showImageCounts],
  );
};
