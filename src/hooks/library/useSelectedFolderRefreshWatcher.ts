import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { useEffect, useRef } from 'react';
import { z } from 'zod';
import { useShallow } from 'zustand/react/shallow';
import type { FolderTree } from '../../components/panel/FolderTree';
import { type ImageFile, LibraryViewMode } from '../../components/ui/AppProperties';
import { useLibraryStore } from '../../store/useLibraryStore';
import { Invokes } from '../../tauri/commands';
import { parseVirtualImagePath } from '../../utils/virtualImagePath';

export const LIBRARY_CHANGE_BATCH_EVENT = 'library-filesystem-change-batch';

const libraryPathChangeSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('added'), path: z.string() }).strict(),
  z
    .object({ kind: z.literal('modified'), path: z.string(), class: z.enum(['source', 'sidecar', 'xmp', 'directory']) })
    .strict(),
  z.object({ kind: z.literal('removed'), path: z.string() }).strict(),
  z.object({ kind: z.literal('renamed'), oldPath: z.string(), newPath: z.string() }).strict(),
]);

export const libraryChangeBatchSchema = z
  .object({
    watchGeneration: z.number().int().nonnegative(),
    catalogRevisionBefore: z.number().int().nonnegative(),
    catalogRevisionAfter: z.number().int().nonnegative(),
    rootId: z.string(),
    changes: z.array(libraryPathChangeSchema),
    overflowed: z.boolean(),
    requiresReconcile: z.boolean(),
  })
  .strict();

const pathIsInCollection = (path: string, folder: string, recursive: boolean): boolean => {
  const prefix = folder.endsWith('/') ? folder : `${folder}/`;
  if (!path.startsWith(prefix)) return false;
  return recursive || !path.slice(prefix.length).includes('/');
};

export const applyLibraryChangeRows = (
  current: readonly ImageFile[],
  removedPhysicalPaths: ReadonlySet<string>,
  rows: readonly ImageFile[],
): ImageFile[] => {
  const refreshedPhysicalPaths = new Set(rows.map((row) => parseVirtualImagePath(row.path).path));
  const retained = current.filter((image) => {
    const physical = parseVirtualImagePath(image.path).path;
    return !removedPhysicalPaths.has(physical) && !refreshedPhysicalPaths.has(physical);
  });
  return [...retained, ...rows];
};

export const applyFolderCountDeltas = (
  trees: readonly FolderTree[],
  deltas: ReadonlyMap<string, number>,
): FolderTree[] =>
  trees.map((tree) => {
    let delta = 0;
    const prefix = tree.path.endsWith('/') ? tree.path : `${tree.path}/`;
    for (const [path, pathDelta] of deltas) {
      if (path.startsWith(prefix)) delta += pathDelta;
    }
    const children = applyFolderCountDeltas(tree.children, deltas);
    if (delta === 0 && children.every((child, index) => child === tree.children[index])) return tree;
    return {
      ...tree,
      children,
      ...(tree.imageCount === undefined ? {} : { imageCount: Math.max(0, tree.imageCount + delta) }),
    };
  });

export function useSelectedFolderRefreshWatcher({
  libraryViewMode,
  reconcile,
}: {
  libraryViewMode: LibraryViewMode;
  reconcile: () => Promise<void> | void;
}) {
  const { currentFolderPath, rootPaths } = useLibraryStore(
    useShallow((state) => ({ currentFolderPath: state.currentFolderPath, rootPaths: state.rootPaths })),
  );
  const generationRef = useRef(0);
  const revisionRef = useRef(0);
  const reconcileRef = useRef(reconcile);

  useEffect(() => {
    reconcileRef.current = reconcile;
  }, [reconcile]);

  useEffect(() => {
    const roots = rootPaths.length > 0 ? rootPaths : currentFolderPath ? [currentFolderPath] : [];
    if (roots.length === 0 || roots.every((path) => path.startsWith('Album: '))) return;
    void invoke<number>(Invokes.ConfigureLibraryChangefeed, {
      roots: roots.filter((path) => !path.startsWith('Album: ')),
    })
      .then((generation) => {
        generationRef.current = generation;
        revisionRef.current = 0;
      })
      .catch((error: unknown) => console.error('Failed to configure library changefeed:', error));
  }, [currentFolderPath, rootPaths]);

  useEffect(() => {
    let active = true;
    const unlistenPromise = listen<unknown>(LIBRARY_CHANGE_BATCH_EVENT, async (event) => {
      if (!active) return;
      const parsed = libraryChangeBatchSchema.safeParse(event.payload);
      if (!parsed.success) {
        console.error('Rejected invalid library change batch:', parsed.error);
        return;
      }
      const batch = parsed.data;
      if (batch.watchGeneration !== generationRef.current || batch.catalogRevisionAfter <= revisionRef.current) return;
      if (revisionRef.current !== 0 && batch.catalogRevisionBefore !== revisionRef.current) return;
      revisionRef.current = batch.catalogRevisionAfter;
      if (batch.requiresReconcile) {
        await reconcileRef.current();
        return;
      }

      const state = useLibraryStore.getState();
      const folder = state.currentFolderPath;
      if (!folder || folder.startsWith('Album: ')) return;
      const recursive = libraryViewMode === LibraryViewMode.Recursive;
      const removed = new Set<string>();
      const refresh = new Set<string>();
      const countDeltas = new Map<string, number>();
      const addCountDelta = (path: string, delta: number) =>
        countDeltas.set(path, (countDeltas.get(path) ?? 0) + delta);
      for (const change of batch.changes) {
        if (change.kind === 'removed') {
          removed.add(change.path);
          addCountDelta(change.path, -1);
        } else if (change.kind === 'renamed') {
          removed.add(change.oldPath);
          refresh.add(change.newPath);
          addCountDelta(change.oldPath, -1);
          addCountDelta(change.newPath, 1);
        } else if (change.kind === 'added') {
          refresh.add(change.path);
          addCountDelta(change.path, 1);
        } else if (change.class !== 'directory') refresh.add(change.path);
      }
      const relevantRefresh = [...refresh].filter((path) => pathIsInCollection(path, folder, recursive));
      const rows =
        relevantRefresh.length === 0
          ? []
          : await invoke<ImageFile[]>(Invokes.GetLibraryChangeRows, { paths: relevantRefresh });
      if (!active || batch.watchGeneration !== generationRef.current) return;
      useLibraryStore.getState().setLibrary((current) => {
        return {
          imageList: applyLibraryChangeRows(current.imageList, removed, rows),
          folderTrees: applyFolderCountDeltas(current.folderTrees, countDeltas),
          pinnedFolderTrees: applyFolderCountDeltas(current.pinnedFolderTrees, countDeltas),
        };
      });
    });
    return () => {
      active = false;
      void unlistenPromise.then((unlisten) => unlisten());
    };
  }, [libraryViewMode]);
}
