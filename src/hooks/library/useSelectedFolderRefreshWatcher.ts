import { listen } from '@tauri-apps/api/event';
import { useEffect, useRef } from 'react';
import { z } from 'zod';
import { useShallow } from 'zustand/react/shallow';
import type { FolderTree } from '../../components/panel/FolderTree';
import type { ImageFile, LibraryViewMode } from '../../components/ui/AppProperties';
import { emptyTauriResponseSchema } from '../../schemas/tauriResponseSchemas';
import { useLibraryStore } from '../../store/useLibraryStore';
import { Invokes } from '../../tauri/commands';
import { invokeWithSchema } from '../../utils/tauriSchemaInvoke';
import { parseVirtualImagePath } from '../../utils/virtualImagePath';

const LIBRARY_CHANGE_BATCH_EVENT = 'library-filesystem-change-batch';

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

const imageFileSchema = z
  .object({
    is_edited: z.boolean(),
    modified: z.number().finite(),
    path: z.string().min(1),
    rating: z.number().finite(),
    tags: z.array(z.string()).nullable(),
    exif: z.record(z.string(), z.string()).nullable(),
    is_virtual_copy: z.boolean(),
  })
  .strict();

const catalogChangeAppliedSchema = z
  .object({
    catalogRevision: z.number().int().nonnegative(),
    upserted: z.array(imageFileSchema),
    removedImageIds: z.array(z.string().min(1)),
  })
  .strict();

const libraryFolderAggregateListSchema = z.array(
  z.object({ path: z.string().min(1), recursiveImageCount: z.number().int().nonnegative() }).strict(),
);

const libraryChangefeedGenerationSchema = z.number().int().nonnegative();

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

const applyCatalogFolderCounts = (trees: readonly FolderTree[], counts: ReadonlyMap<string, number>): FolderTree[] =>
  trees.map((tree) => ({
    ...tree,
    ...(counts.has(tree.path) ? { imageCount: counts.get(tree.path) } : {}),
    children: applyCatalogFolderCounts(tree.children, counts),
  }));

const affectedFolderPaths = (paths: readonly string[], root: string): string[] => {
  const folders = new Set<string>([root]);
  for (const value of paths) {
    let folder = value.slice(0, value.lastIndexOf('/'));
    while (folder.startsWith(root)) {
      folders.add(folder);
      if (folder === root) break;
      folder = folder.slice(0, folder.lastIndexOf('/'));
    }
  }
  return [...folders];
};

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
    void invokeWithSchema(
      Invokes.ConfigureLibraryChangefeed,
      { roots: roots.filter((path) => !path.startsWith('Album: ')) },
      libraryChangefeedGenerationSchema,
    )
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

      const state = useLibraryStore.getState();
      const folder = state.currentFolderPath;
      if (!folder || folder.startsWith('Album: ')) return;
      const root = rootPaths.find((candidate) => folder === candidate || folder.startsWith(`${candidate}/`)) ?? folder;
      if (batch.requiresReconcile || batch.overflowed) {
        await invokeWithSchema(Invokes.ReconcileLibraryCatalog, { path: root }, emptyTauriResponseSchema);
        if (!active || batch.watchGeneration !== generationRef.current) return;
        await reconcileRef.current();
      } else {
        const applied = await invokeWithSchema(
          Invokes.ApplyLibraryCatalogChanges,
          { root, changes: batch.changes },
          catalogChangeAppliedSchema,
        );
        if (!active || batch.watchGeneration !== generationRef.current) return;
        useLibraryStore
          .getState()
          .applyCatalogDelta(applied.catalogRevision, applied.upserted, applied.removedImageIds);
        const changedPaths = batch.changes.flatMap((change) =>
          change.kind === 'renamed' ? [change.oldPath, change.newPath] : [change.path],
        );
        const aggregates = await invokeWithSchema(
          Invokes.GetLibraryFolderAggregates,
          { paths: affectedFolderPaths(changedPaths, root) },
          libraryFolderAggregateListSchema,
        );
        const counts = new Map(aggregates.map((aggregate) => [aggregate.path, aggregate.recursiveImageCount]));
        useLibraryStore.getState().setLibrary((current) => ({
          folderTrees: applyCatalogFolderCounts(current.folderTrees, counts),
          pinnedFolderTrees: applyCatalogFolderCounts(current.pinnedFolderTrees, counts),
        }));
      }
    });
    return () => {
      active = false;
      void unlistenPromise.then((unlisten) => unlisten());
    };
  }, [libraryViewMode, rootPaths]);
}
