import { invoke } from '@tauri-apps/api/core';
import { type MouseEvent, useCallback } from 'react';
import { toast } from 'react-toastify';
import type { FolderTree } from '../../components/panel/FolderTree';
import type { AlbumItem, ImageFile } from '../../components/ui/AppProperties';
import { libraryEntityRepository } from '../../library/LibraryEntityRepository';
import { albumTreeSchema } from '../../schemas/library/albumSchemas';
import { useEditorStore } from '../../store/useEditorStore';
import { useLibraryStore } from '../../store/useLibraryStore';
import { useSettingsStore } from '../../store/useSettingsStore';
import { useUIStore } from '../../store/useUIStore';
import { Invokes } from '../../tauri/commands';
import { formatUnknownError } from '../../utils/errorFormatting';
import { globalImageCache } from '../../utils/ImageLRUCache';
import { invokeWithSchema } from '../../utils/tauriSchemaInvoke';
import { computeSortedLibrary } from './useSortedLibrary';

type LibraryClickEvent = Pick<MouseEvent, 'ctrlKey' | 'metaKey' | 'shiftKey'>;

interface MultiSelectOptions {
  onSimpleClick: (path: string) => void;
  shiftAnchor: string | null;
  updateLibraryActivePath: boolean;
}

export function useLibraryActions(handleImageSelect?: (path: string) => void) {
  const handleRate = useCallback((newRating: number, paths?: string[]) => {
    const { multiSelectedPaths, patchLibraryImages } = useLibraryStore.getState();
    const { selectedImage } = useEditorStore.getState();

    const pathsToRate =
      paths || (multiSelectedPaths.length > 0 ? multiSelectedPaths : selectedImage ? [selectedImage.path] : []);
    if (pathsToRate.length === 0) return;

    const firstPath = pathsToRate[0];
    if (!firstPath) return;
    const currentRating = libraryEntityRepository.get(firstPath)?.rating || 0;
    const finalRating = newRating === currentRating ? 0 : newRating;

    patchLibraryImages(pathsToRate.map((path) => ({ path, changes: { rating: finalRating } })));

    invoke(Invokes.SetRatingForPaths, { paths: pathsToRate, rating: finalRating }).catch((err: unknown) => {
      console.error(err);
      toast.error(`Failed to apply rating: ${formatUnknownError(err)}`);
    });
  }, []);

  const handleSetColorLabel = useCallback(async (color: string | null, paths?: string[]) => {
    const { multiSelectedPaths, libraryActivePath, imageList, setLibrary } = useLibraryStore.getState();
    const { selectedImage } = useEditorStore.getState();

    const pathsToUpdate =
      paths || (multiSelectedPaths.length > 0 ? multiSelectedPaths : selectedImage ? [selectedImage.path] : []);
    if (pathsToUpdate.length === 0) return;

    const primaryPath = selectedImage?.path || libraryActivePath;
    const primaryImage = imageList.find((img: ImageFile) => img.path === primaryPath);
    let currentColor = null;
    if (primaryImage && primaryImage.tags) {
      const colorTag = primaryImage.tags.find((tag: string) => tag.startsWith('color:'));
      if (colorTag) currentColor = colorTag.substring(6);
    }
    const finalColor = color !== null && color === currentColor ? null : color;

    try {
      await invoke(Invokes.SetColorLabelForPaths, { paths: pathsToUpdate, color: finalColor });
      libraryEntityRepository.patchMany(
        pathsToUpdate.map((path) => {
          const image = libraryEntityRepository.get(path);
          const otherTags = (image?.tags || []).filter((tag) => !tag.startsWith('color:'));
          return { path, changes: { tags: finalColor ? [...otherTags, `color:${finalColor}`] : [...otherTags] } };
        }),
      );
    } catch (err) {
      toast.error(`Failed to set color label: ${formatUnknownError(err)}`);
    }
  }, []);

  const handleTagsChanged = useCallback((changedPaths: string[], newTags: { tag: string; isUser: boolean }[]) => {
    libraryEntityRepository.patchMany(
      changedPaths.map((path) => {
        const image = libraryEntityRepository.get(path);
        const colorTags = (image?.tags || []).filter((tag) => tag.startsWith('color:'));
        const finalTags = [...colorTags, ...newTags.map((tag) => (tag.isUser ? `user:${tag.tag}` : tag.tag))].sort();
        return { path, changes: { tags: finalTags.length > 0 ? finalTags : null } };
      }),
    );
  }, []);

  const handleUpdateExif = useCallback(async (paths: Array<string> | undefined, updates: Record<string, string>) => {
    const { multiSelectedPaths, setLibrary } = useLibraryStore.getState();
    const { selectedImage, setEditor } = useEditorStore.getState();

    const pathsToUpdate =
      paths && paths.length > 0
        ? paths
        : multiSelectedPaths.length > 0
          ? multiSelectedPaths
          : selectedImage
            ? [selectedImage.path]
            : [];
    if (pathsToUpdate.length === 0) return;

    const physicalPathsSet = new Set(pathsToUpdate.map((p) => p.split('?vc=')[0]));
    const physicalPathsArray = Array.from(physicalPathsSet);

    try {
      await invoke(Invokes.UpdateExifFields, { paths: physicalPathsArray, updates });

      setEditor((state) => {
        if (!state.selectedImage || !physicalPathsSet.has(state.selectedImage.path.split('?vc=')[0])) return state;
        return { selectedImage: { ...state.selectedImage, exif: { ...(state.selectedImage.exif || {}), ...updates } } };
      });

      libraryEntityRepository.patchMany(
        useLibraryStore
          .getState()
          .imageList.filter((image) => physicalPathsSet.has(image.path.split('?vc=')[0]))
          .map((image) => ({
            path: image.path,
            changes: { exif: { ...(libraryEntityRepository.get(image.path)?.exif || {}), ...updates } },
          })),
      );

      pathsToUpdate.forEach((p) => {
        const cached = globalImageCache.get(p);
        if (cached) {
          globalImageCache.set(p, {
            ...cached,
            selectedImage: { ...cached.selectedImage, exif: { ...(cached.selectedImage.exif || {}), ...updates } },
          });
        }
      });
    } catch (err) {
      toast.error(`Failed to update metadata: ${formatUnknownError(err)}`);
    }
  }, []);

  const handleClearSelection = useCallback(() => {
    const { selectedImage } = useEditorStore.getState();
    if (selectedImage) {
      useLibraryStore.getState().setLibrary({ multiSelectedPaths: [selectedImage.path] });
    } else {
      useLibraryStore.getState().setLibrary({ multiSelectedPaths: [], libraryActivePath: null });
    }
  }, []);

  const handleMultiSelectClick = useCallback((path: string, event: LibraryClickEvent, options: MultiSelectOptions) => {
    const libraryState = useLibraryStore.getState();
    const { multiSelectedPaths, setLibrary } = libraryState;
    const { ctrlKey, metaKey, shiftKey } = event;
    const isCtrlPressed = ctrlKey || metaKey;
    const { shiftAnchor, onSimpleClick, updateLibraryActivePath } = options;

    if (shiftKey && shiftAnchor) {
      const sortedImageList = computeSortedLibrary(libraryState, useSettingsStore.getState());
      const anchorIndex = sortedImageList.findIndex((f) => f.path === shiftAnchor);
      const currentIndex = sortedImageList.findIndex((f) => f.path === path);

      if (anchorIndex !== -1 && currentIndex !== -1) {
        const start = Math.min(anchorIndex, currentIndex);
        const end = Math.max(anchorIndex, currentIndex);
        const range = sortedImageList.slice(start, end + 1).map((f) => f.path);
        const baseSelection = isCtrlPressed ? multiSelectedPaths : [];
        const newSelection = Array.from(new Set([...baseSelection, ...range]));

        setLibrary({ multiSelectedPaths: newSelection, selectionAnchorPath: path });
        if (updateLibraryActivePath) setLibrary({ libraryActivePath: path });
      }
    } else if (isCtrlPressed) {
      const newSelection = new Set(multiSelectedPaths);
      if (newSelection.has(path)) newSelection.delete(path);
      else newSelection.add(path);

      const newSelectionArray = Array.from(newSelection);
      setLibrary({ multiSelectedPaths: newSelectionArray, selectionAnchorPath: path });

      if (updateLibraryActivePath) {
        if (newSelectionArray.includes(path)) setLibrary({ libraryActivePath: path });
        else if (newSelectionArray.length > 0)
          setLibrary({ libraryActivePath: newSelectionArray[newSelectionArray.length - 1] ?? null });
        else setLibrary({ libraryActivePath: null });
      }
    } else {
      onSimpleClick(path);
      setLibrary({ selectionAnchorPath: path });
    }
  }, []);

  const handleLibraryImageSingleClick = useCallback(
    (path: string, event: LibraryClickEvent) => {
      const { selectionAnchorPath, libraryActivePath, setLibrary } = useLibraryStore.getState();
      handleMultiSelectClick(path, event, {
        shiftAnchor: selectionAnchorPath ?? libraryActivePath,
        updateLibraryActivePath: true,
        onSimpleClick: (p) => {
          setLibrary({ multiSelectedPaths: [p], libraryActivePath: p, selectionAnchorPath: p });
        },
      });
    },
    [handleMultiSelectClick],
  );

  const handleImageClick = useCallback(
    (path: string, event: LibraryClickEvent) => {
      const { selectionAnchorPath, libraryActivePath, setLibrary } = useLibraryStore.getState();
      const { selectedImage } = useEditorStore.getState();
      const inEditor = !!selectedImage;

      handleMultiSelectClick(path, event, {
        shiftAnchor: selectionAnchorPath ?? (inEditor ? selectedImage.path : libraryActivePath),
        updateLibraryActivePath: !inEditor,
        onSimpleClick: (p: string) => {
          if (handleImageSelect) handleImageSelect(p);
          setLibrary({ selectionAnchorPath: p });
        },
      });
    },
    [handleMultiSelectClick, handleImageSelect],
  );

  const refreshAllFolderTrees = useCallback(async () => {
    const { rootPaths, expandedFolders, setLibrary } = useLibraryStore.getState();
    const { appSettings } = useSettingsStore.getState();

    const showImageCounts = appSettings?.enableFolderImageCounts ?? false;
    const pinnedFolders = appSettings?.pinnedFolders || [];
    const expandedArray = Array.from(expandedFolders);

    try {
      const updates: { folderTrees?: FolderTree[]; pinnedFolderTrees?: FolderTree[] } = {};

      if (rootPaths.length > 0) {
        const treesData = await invoke<FolderTree[]>(Invokes.GetPinnedFolderTrees, {
          paths: rootPaths,
          expandedFolders: expandedArray,
          showImageCounts,
        });
        updates.folderTrees = treesData;
      } else {
        updates.folderTrees = [];
      }

      if (pinnedFolders.length > 0) {
        const pinnedTreesData = await invoke<FolderTree[]>(Invokes.GetPinnedFolderTrees, {
          paths: pinnedFolders,
          expandedFolders: expandedArray,
          showImageCounts,
        });
        updates.pinnedFolderTrees = pinnedTreesData;
      } else {
        updates.pinnedFolderTrees = [];
      }

      if (Object.keys(updates).length > 0) {
        setLibrary(updates);
      }
    } catch (err) {
      console.error('Failed to refresh folder trees:', err);
    }
  }, []);

  const handleTogglePinFolder = useCallback(async (path: string) => {
    const { appSettings, handleSettingsChange } = useSettingsStore.getState();
    const { expandedFolders, setLibrary } = useLibraryStore.getState();
    if (!appSettings) return;

    const currentPins = appSettings.pinnedFolders || [];
    const isPinned = currentPins.includes(path);
    const newPins = isPinned
      ? currentPins.filter((p: string) => p !== path)
      : [...currentPins, path].sort((a, b) => a.localeCompare(b));

    await handleSettingsChange({ ...appSettings, pinnedFolders: newPins });

    try {
      const trees = await invoke<FolderTree[]>(Invokes.GetPinnedFolderTrees, {
        paths: newPins,
        expandedFolders: Array.from(expandedFolders),
        showImageCounts: appSettings.enableFolderImageCounts ?? false,
      });
      setLibrary({ pinnedFolderTrees: trees });
    } catch (err) {
      toast.error(`Failed to refresh pinned folders: ${formatUnknownError(err)}`);
    }
  }, []);

  const handleCreateAlbumItem = useCallback(async (name: string, type: 'album' | 'group') => {
    const { albumTree, setLibrary } = useLibraryStore.getState();
    const { albumActionTarget } = useUIStore.getState();

    const newTree = structuredClone(albumTree);
    const newItem: AlbumItem =
      type === 'album'
        ? { type: 'album', id: crypto.randomUUID(), name, images: [] }
        : { type: 'group', id: crypto.randomUUID(), name, children: [] };

    let actualTarget = albumActionTarget;

    const findNode = (nodes: AlbumItem[], id: string): AlbumItem | undefined => {
      for (const n of nodes) {
        if (n.id === id) return n;
        if (n.type === 'group') {
          const found = findNode(n.children, id);
          if (found) return found;
        }
      }
      return undefined;
    };

    const findParentId = (nodes: AlbumItem[], childId: string, parentId: string | null): string | null | undefined => {
      for (const n of nodes) {
        if (n.id === childId) return parentId;
        if (n.type === 'group') {
          const found = findParentId(n.children, childId, n.id);
          if (found !== undefined) return found;
        }
      }
      return undefined;
    };

    if (actualTarget) {
      const targetNode = findNode(newTree, actualTarget);
      if (targetNode && targetNode.type === 'album') {
        const pId = findParentId(newTree, actualTarget, null);
        actualTarget = pId === undefined ? null : pId;
      }
    }

    const insert = (nodes: AlbumItem[], target: string | null): boolean => {
      if (!target) {
        nodes.push(newItem);
        return true;
      }
      for (const n of nodes) {
        if (n.id === target && n.type === 'group') {
          n.children.push(newItem);
          return true;
        } else if (n.type === 'group') {
          if (insert(n.children, target)) return true;
        }
      }
      return false;
    };

    if (insert(newTree, actualTarget)) {
      try {
        await invoke(Invokes.SaveAlbums, { tree: newTree });
        const sortedTree = await invokeWithSchema(Invokes.GetAlbums, {}, albumTreeSchema);
        setLibrary({ albumTree: sortedTree });
      } catch (err) {
        toast.error(`Failed to create: ${formatUnknownError(err)}`);
      }
    }
  }, []);

  const handleRenameAlbumItem = useCallback(async (newName: string) => {
    const { albumTree, setLibrary } = useLibraryStore.getState();
    const { albumActionTarget } = useUIStore.getState();
    if (!albumActionTarget) return;

    const newTree = structuredClone(albumTree);

    const rename = (nodes: AlbumItem[]) => {
      for (const n of nodes) {
        if (n.id === albumActionTarget) {
          n.name = newName;
          return true;
        }
        if (n.type === 'group' && rename(n.children)) return true;
      }
      return false;
    };

    if (rename(newTree)) {
      try {
        await invoke(Invokes.SaveAlbums, { tree: newTree });
        const sortedTree = await invokeWithSchema(Invokes.GetAlbums, {}, albumTreeSchema);
        setLibrary({ albumTree: sortedTree });
      } catch (err) {
        toast.error(`Failed to rename: ${formatUnknownError(err)}`);
      }
    }
  }, []);

  return {
    handleRate,
    handleSetColorLabel,
    handleTagsChanged,
    handleUpdateExif,
    handleClearSelection,
    handleLibraryImageSingleClick,
    handleImageClick,
    refreshAllFolderTrees,
    handleTogglePinFolder,
    handleCreateAlbumItem,
    handleRenameAlbumItem,
  };
}
