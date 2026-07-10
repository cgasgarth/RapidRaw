import { invoke } from '@tauri-apps/api/core';
import { homeDir } from '@tauri-apps/api/path';
import { open } from '@tauri-apps/plugin-dialog';
import { type RefObject, useCallback } from 'react';
import { toast } from 'react-toastify';
import type { FolderTree } from '../../components/panel/FolderTree';
import { type AlbumItem, type AppSettings, type ImageFile, LibraryViewMode } from '../../components/ui/AppProperties';
import type { LoadImageResult } from '../../schemas/imageLoaderSchemas';
import { useEditorStore } from '../../store/useEditorStore';
import { useLibraryStore } from '../../store/useLibraryStore';
import { useProcessStore } from '../../store/useProcessStore';
import { useSettingsStore } from '../../store/useSettingsStore';
import { useUIStore } from '../../store/useUIStore';
import { Invokes } from '../../tauri/commands';
import { type Adjustments, INITIAL_ADJUSTMENTS, normalizeLoadedAdjustments } from '../../utils/adjustments';
import { formatUnknownError } from '../../utils/errorFormatting';
import { findAlbumById } from '../../utils/folderTreeUtils';
import { upsertReopenedDerivedOutputReceipt } from '../../utils/hdrDerivedSourceReopen';
import { globalImageCache, type ImageCacheEntry } from '../../utils/ImageLRUCache';
import {
  consumePendingNegativeConversionDustHealLayers,
  consumePendingNegativeConversionSavedPositiveHandoff,
} from '../../utils/negative-lab/negativeLabEditorHandoff';
import { metadataWithNegativeLabReopenedSavedPositiveHandoff } from '../../utils/negative-lab/negativeLabSavedPositiveReopen';
import { debouncedSave, debouncedSetHistory } from '../editor/useEditorActions';
import { reconcileSelectedFolderRefresh } from '../library/selectedFolderRefreshReconciliation';

interface TransformController {
  resetTransform(time?: number): void;
}

interface PreloadedNavigationData {
  currentPath?: string;
  images?: Promise<ImageFile[]> | undefined;
  rootPaths?: string[];
  trees?: Promise<FolderTree[]> | undefined;
}

interface PreviousAdjustments {
  adjustments: Adjustments;
  path: string;
}

interface LoadedMetadata {
  adjustments?: Adjustments | null;
}

type ExifDataMap = Record<string, Record<string, string>>;

interface PersistedFolderState {
  activeAlbumId?: string | null;
  currentFolderPath?: string | null;
  expandedAlbumGroups?: string[];
  expandedFolders?: string[];
}

interface NavigationSettings extends AppSettings {
  enableFolderImageCounts?: boolean;
  lastFolderState?: PersistedFolderState | null;
  libraryViewMode?: LibraryViewMode;
  pinnedFolders?: string[];
  rootFolders?: string[];
}

export interface AppNavigationProps {
  clearThumbnailQueue: () => void;
  requestThumbnails: (paths: string[]) => void;
  refs: {
    transformWrapperRef: RefObject<TransformController | null>;
    preloadedDataRef: RefObject<PreloadedNavigationData>;
    cachedEditStateRef: RefObject<ImageCacheEntry | null>;
    selectedImagePathRef: RefObject<string | null>;
    isBackendReadyRef: RefObject<boolean>;
    latestRenderedJobIdRef: RefObject<number>;
    previewJobIdRef: RefObject<number>;
    currentResRef: RefObject<number>;
    prevAdjustmentsRef: RefObject<PreviousAdjustments | null>;
  };
}

const getNavigationSettings = (): NavigationSettings | null => useSettingsStore.getState().appSettings;

const folderTreeContainsPath = (nodes: FolderTree[], path: string): boolean =>
  nodes.some((node) => node.path === path || folderTreeContainsPath(node.children, path));

const resolveRestoredFolderPath = (trees: FolderTree[], preferredPath: string | null, fallbackPath: string): string => {
  if (preferredPath?.startsWith('Album: ')) return preferredPath;
  if (preferredPath && folderTreeContainsPath(trees, preferredPath)) return preferredPath;
  return folderTreeContainsPath(trees, fallbackPath) ? fallbackPath : (trees[0]?.path ?? fallbackPath);
};

export function useAppNavigation({ clearThumbnailQueue, requestThumbnails, refs }: AppNavigationProps) {
  const {
    transformWrapperRef,
    preloadedDataRef,
    cachedEditStateRef,
    selectedImagePathRef,
    isBackendReadyRef,
    latestRenderedJobIdRef,
    previewJobIdRef,
    currentResRef,
    prevAdjustmentsRef,
  } = refs;

  const handleGoHome = useCallback(() => {
    useLibraryStore.getState().setLibrary({
      rootPaths: [],
      currentFolderPath: null,
      activeAlbumId: null,
      imageList: [],
      imageRatings: {},
      folderTrees: [],
      multiSelectedPaths: [],
      libraryActivePath: null,
      expandedFolders: new Set(),
    });
    useUIStore.getState().setUI({ isLibraryExportPanelVisible: false });
  }, []);

  const handleBackToLibrary = useCallback(() => {
    const { selectedImage, resetHistory, setEditor } = useEditorStore.getState();
    const { setLibrary } = useLibraryStore.getState();
    const { setUI } = useUIStore.getState();

    if (selectedImage?.path && cachedEditStateRef.current) {
      globalImageCache.set(selectedImage.path, cachedEditStateRef.current);
    }
    if (transformWrapperRef.current) {
      transformWrapperRef.current.resetTransform(0);
    }
    debouncedSave.flush();
    debouncedSetHistory.cancel();

    const lastActivePath = selectedImage?.path ?? null;

    setEditor({
      hasRenderedFirstFrame: false,
      selectedImage: null,
      finalPreviewUrl: null,
      uncroppedAdjustedPreviewUrl: null,
      histogram: null,
      waveform: null,
      previewScopeStatus: null,
      gamutWarningOverlay: null,
      activeMaskId: null,
      activeMaskContainerId: null,
      activeAiPatchContainerId: null,
      isWbPickerActive: false,
      activeAiSubMaskId: null,
      transformedOriginalUrl: null,
    });

    selectedImagePathRef.current = null;

    setLibrary({ libraryActivePath: lastActivePath });
    setUI({ slideDirection: 1 });

    setEditor({ adjustments: INITIAL_ADJUSTMENTS });
    resetHistory(INITIAL_ADJUSTMENTS);

    isBackendReadyRef.current = true;
    setEditor({ interactivePatch: null });
  }, [cachedEditStateRef, isBackendReadyRef, selectedImagePathRef, transformWrapperRef]);

  const handleImageSelect = useCallback(
    async (path: string) => {
      const { selectedImage, isSliderDragging, resetHistory, setEditor } = useEditorStore.getState();
      const { setLibrary } = useLibraryStore.getState();
      const { setUI } = useUIStore.getState();

      if (selectedImage?.path === path) return;

      debouncedSave.flush();
      debouncedSetHistory.cancel();

      if (selectedImage?.path && cachedEditStateRef.current) {
        globalImageCache.set(selectedImage.path, cachedEditStateRef.current);
      }

      const cached = globalImageCache.get(path);
      const cachedReadyEntry = cached?.selectedImage.isReady ? cached : undefined;
      const isFrontendCached = cachedReadyEntry !== undefined;
      const isCachedInBackend = isFrontendCached
        ? await invoke<boolean>(Invokes.IsImageCached, { path }).catch(() => false)
        : false;

      const hasDifferentResolution =
        cached &&
        (useEditorStore.getState().originalSize.width !== cached.originalSize.width ||
          useEditorStore.getState().originalSize.height !== cached.originalSize.height);

      if (!isCachedInBackend || hasDifferentResolution) {
        setEditor({ hasRenderedFirstFrame: false });
      }

      selectedImagePathRef.current = path;
      requestThumbnails([path]);
      setLibrary({ multiSelectedPaths: [path], libraryActivePath: null, selectionAnchorPath: path });

      setEditor({
        compareMode: 'off',
        showOriginal: false,
        activeMaskId: null,
        activeMaskContainerId: null,
        activeAiPatchContainerId: null,
        activeAiSubMaskId: null,
        isWbPickerActive: false,
        transformedOriginalUrl: null,
      });

      setUI({
        isLibraryExportPanelVisible: false,
      });

      if (cachedReadyEntry) {
        setEditor({
          selectedImage: {
            ...cachedReadyEntry.selectedImage,
            thumbnailUrl: useProcessStore.getState().thumbnails[path] || cachedReadyEntry.selectedImage.thumbnailUrl,
          },
          originalSize: cachedReadyEntry.originalSize,
          previewSize: cachedReadyEntry.previewSize,
          histogram: cachedReadyEntry.histogram,
          waveform: cachedReadyEntry.waveform,
          finalPreviewUrl: cachedReadyEntry.finalPreviewUrl,
          uncroppedAdjustedPreviewUrl: cachedReadyEntry.uncroppedPreviewUrl,
        });
        const savedPositiveHandoff = consumePendingNegativeConversionSavedPositiveHandoff(path);
        if (savedPositiveHandoff !== null) {
          setEditor((state) => ({
            selectedImage:
              state.selectedImage?.path === path
                ? {
                    ...state.selectedImage,
                    metadata: {
                      ...(typeof state.selectedImage.metadata === 'object' &&
                      state.selectedImage.metadata !== null &&
                      !Array.isArray(state.selectedImage.metadata)
                        ? state.selectedImage.metadata
                        : {}),
                      rawEngineNegativeLabHandoff: savedPositiveHandoff,
                    },
                  }
                : state.selectedImage,
          }));
        }

        setEditor({ adjustments: cachedReadyEntry.adjustments });
        resetHistory(cachedReadyEntry.adjustments);
        prevAdjustmentsRef.current = { path, adjustments: cachedReadyEntry.adjustments };

        setLibrary({ isViewLoading: false });

        latestRenderedJobIdRef.current = previewJobIdRef.current;
        isBackendReadyRef.current = false;
        currentResRef.current = Infinity;

        invoke<LoadImageResult>(Invokes.LoadImage, { path })
          .then((result) => {
            if (selectedImagePathRef.current !== path) return;
            const loadedMetadata = metadataWithNegativeLabReopenedSavedPositiveHandoff({
              imagePath: path,
              metadata: result.metadata,
            });
            upsertReopenedDerivedOutputReceipt({
              imagePath: path,
              metadata: loadedMetadata,
              upsert: useUIStore.getState().upsertDerivedOutputReceipt,
            });
            isBackendReadyRef.current = true;
            currentResRef.current = 0;
            setEditor((state) => ({
              originalSize: { width: result.width, height: result.height },
              selectedImage:
                state.selectedImage?.path === path
                  ? {
                      ...state.selectedImage,
                      exif: result.exif ?? state.selectedImage.exif,
                      height: result.height,
                      isOfflineSmartPreview: result.is_offline_smart_preview === true,
                      isRaw: result.is_raw,
                      metadata: loadedMetadata ?? state.selectedImage.metadata,
                      rawDevelopmentReport: result.raw_development_report ?? null,
                      width: result.width,
                    }
                  : state.selectedImage,
            }));
          })
          .catch((err: unknown) => {
            if (String(err).includes('cancelled')) return;
            console.error('Background load_image failed on cache hit:', err);
            isBackendReadyRef.current = true;
            currentResRef.current = 0;
          });

        invoke<LoadedMetadata>(Invokes.LoadMetadata, { path })
          .then((metadata) => {
            if (selectedImagePathRef.current !== path) return;
            let freshAdjustments: Adjustments;
            if (metadata.adjustments && !metadata.adjustments['is_null']) {
              freshAdjustments = normalizeLoadedAdjustments(metadata.adjustments);
            } else {
              freshAdjustments = { ...INITIAL_ADJUSTMENTS };
            }
            if (
              !isSliderDragging &&
              JSON.stringify(cachedReadyEntry.adjustments) !== JSON.stringify(freshAdjustments)
            ) {
              setEditor({ adjustments: freshAdjustments });
              resetHistory(freshAdjustments);
              prevAdjustmentsRef.current = { path, adjustments: freshAdjustments };
              globalImageCache.set(path, { ...cachedReadyEntry, adjustments: freshAdjustments });
            }
            consumePendingNegativeConversionDustHealLayers(path);
            consumePendingNegativeConversionSavedPositiveHandoff(path);
          })
          .catch((err: unknown) => {
            console.error('Failed background metadata sync on cache hit:', err);
            consumePendingNegativeConversionDustHealLayers(path);
            consumePendingNegativeConversionSavedPositiveHandoff(path);
          });

        return;
      }

      isBackendReadyRef.current = true;

      setEditor({
        selectedImage: {
          exif: null,
          height: 0,
          isRaw: false,
          isReady: false,
          metadata: null,
          originalUrl: null,
          path,
          rawDevelopmentReport: null,
          thumbnailUrl: useProcessStore.getState().thumbnails[path] ?? '',
          width: 0,
        },
        originalSize: { width: 0, height: 0 },
        previewSize: { width: 0, height: 0 },
        requestedPreviewResolution: 0,
        renderedPreviewResolution: 0,
        histogram: null,
        waveform: null,
        previewScopeStatus: null,
        gamutWarningOverlay: null,
        exportSoftProofTransform: null,
        finalPreviewUrl: null,
        transformedOriginalUrl: null,
        uncroppedAdjustedPreviewUrl: null,
        interactivePatch: null,
      });

      setLibrary({ isViewLoading: true });
    },
    [
      cachedEditStateRef,
      currentResRef,
      isBackendReadyRef,
      latestRenderedJobIdRef,
      prevAdjustmentsRef,
      previewJobIdRef,
      requestThumbnails,
      selectedImagePathRef,
    ],
  );

  const handleSelectSubfolder = useCallback(
    async (
      path: string | null,
      isNewRoot = false,
      preloadedImages?: ImageFile[],
      expandParents = true,
      preserveEditor = false,
    ) => {
      const { handleSettingsChange } = useSettingsStore.getState();
      const appSettings = getNavigationSettings();
      const pinnedFolders = appSettings?.pinnedFolders ?? [];
      const {
        expandedFolders,
        imageList: previousImageList,
        libraryActivePath,
        multiSelectedPaths,
        rootPaths,
        selectionAnchorPath,
        setLibrary,
        sortCriteria,
      } = useLibraryStore.getState();
      const { setUI } = useUIStore.getState();
      const { setProcess } = useProcessStore.getState();
      const { selectedImage, resetHistory, setEditor } = useEditorStore.getState();
      const libraryViewMode = appSettings?.libraryViewMode;

      if (!preserveEditor) {
        await invoke(Invokes.CancelThumbnailGeneration);
        clearThumbnailQueue();
        setLibrary({ isViewLoading: true, activeAlbumId: null, libraryScrollTop: 0 });
        useLibraryStore.getState().setSearchCriteria({ tags: [], text: '', mode: 'OR' });
        setProcess({ thumbnails: {} });
        globalImageCache.clear();
        setUI({ activeView: 'library' });
      } else {
        setLibrary({ isViewLoading: true });
      }

      try {
        let newExpandedFolders = new Set(expandedFolders);

        if (isNewRoot && path) {
          newExpandedFolders = new Set([path]);
          if (appSettings) {
            void handleSettingsChange({ ...appSettings, lastRootPath: path });
          }
        } else if (path && expandParents) {
          const allRoots = [...rootPaths, ...pinnedFolders];
          const relevantRoot = allRoots.find((r) => path.startsWith(r));

          if (relevantRoot) {
            const separator = path.includes('/') ? '/' : '\\';
            const parentSeparatorIndex = path.lastIndexOf(separator);

            if (parentSeparatorIndex > -1 && path.length > relevantRoot.length) {
              let current = path.substring(0, parentSeparatorIndex);
              while (current && current.length >= relevantRoot.length) {
                newExpandedFolders.add(current);
                const nextParentIndex = current.lastIndexOf(separator);
                if (nextParentIndex === -1 || current === relevantRoot) break;
                current = current.substring(0, nextParentIndex);
              }
            }
            newExpandedFolders.add(relevantRoot);
          }
        }

        setLibrary({
          currentFolderPath: path,
          expandedFolders: newExpandedFolders,
          ...(preserveEditor ? {} : { imageList: [], multiSelectedPaths: [], libraryActivePath: null }),
        });

        if (!preserveEditor && selectedImage) {
          debouncedSave.flush();
          debouncedSetHistory.cancel();
          setEditor({
            finalPreviewUrl: null,
            gamutWarningOverlay: null,
            histogram: null,
            selectedImage: null,
            uncroppedAdjustedPreviewUrl: null,
          });
          setEditor({ adjustments: INITIAL_ADJUSTMENTS });
          resetHistory(INITIAL_ADJUSTMENTS);
        }

        const command =
          libraryViewMode === LibraryViewMode.Recursive ? Invokes.ListImagesRecursive : Invokes.ListImagesInDir;

        let files: ImageFile[];
        if (preloadedImages) {
          files = preloadedImages;
        } else {
          files = await invoke<ImageFile[]>(command, { path });
        }

        const refreshReconciliation = preserveEditor
          ? reconcileSelectedFolderRefresh(previousImageList, files, {
              libraryActivePath,
              multiSelectedPaths,
              selectionAnchorPath,
            })
          : null;

        if (refreshReconciliation) {
          const invalidatedPaths = Array.from(
            new Set([
              ...refreshReconciliation.addedPaths,
              ...refreshReconciliation.changedPaths,
              ...refreshReconciliation.removedPaths,
            ]),
          );
          useProcessStore.getState().invalidateThumbnails(invalidatedPaths);
          invalidatedPaths.forEach((pathToInvalidate) => {
            globalImageCache.delete(pathToInvalidate);
          });
          requestThumbnails([...refreshReconciliation.addedPaths, ...refreshReconciliation.changedPaths]);
          setLibrary({
            libraryActivePath: refreshReconciliation.nextLibraryActivePath,
            multiSelectedPaths: refreshReconciliation.nextMultiSelectedPaths,
            selectionAnchorPath: refreshReconciliation.nextSelectionAnchorPath,
          });
        }

        const initialRatings: Record<string, number> = {};
        files.forEach((f) => {
          initialRatings[f.path] = f.rating;
        });
        setLibrary({ imageRatings: initialRatings });

        const exifSortKeys = ['date_taken', 'iso', 'shutter_speed', 'aperture', 'focal_length'];
        const isExifSortActive = exifSortKeys.includes(sortCriteria.key);

        if (files.length > 0) {
          const paths = files.map((f: ImageFile) => f.path);

          if (isExifSortActive) {
            const exifDataMap = await invoke<ExifDataMap>(Invokes.ReadExifForPaths, { paths });
            const finalImageList = files.map((image) => ({
              ...image,
              exif: exifDataMap[image.path] || image.exif || null,
            }));
            setLibrary({ imageList: finalImageList });
          } else {
            setLibrary({ imageList: files });
            invoke<ExifDataMap>(Invokes.ReadExifForPaths, { paths })
              .then((exifDataMap) => {
                setLibrary((state) => ({
                  imageList: state.imageList.map((image) => ({
                    ...image,
                    exif: exifDataMap[image.path] || image.exif || null,
                  })),
                }));
              })
              .catch((err: unknown) => {
                console.error('Failed to read EXIF data in background:', err);
              });
          }
        } else {
          setLibrary({ imageList: files });
        }

        if (!preserveEditor) {
          invoke(Invokes.StartBackgroundIndexing, { folderPath: path }).catch((err: unknown) => {
            console.error('Failed to start background indexing:', err);
          });
        }
      } catch (err) {
        console.error('Failed to load folder contents:', err);
        toast.error('Failed to load images from the selected folder.');
      } finally {
        useLibraryStore.getState().setLibrary({ isViewLoading: false });
      }
    },
    [clearThumbnailQueue, requestThumbnails],
  );

  const handleSelectAlbum = useCallback(
    async (albumId: string, albumName: string, imagePaths: string[], preserveEditor = false) => {
      const { setLibrary } = useLibraryStore.getState();
      const { setUI } = useUIStore.getState();

      if (!preserveEditor) {
        await invoke(Invokes.CancelThumbnailGeneration);
        clearThumbnailQueue();
        useLibraryStore.getState().setSearchCriteria({ tags: [], text: '', mode: 'OR' });
        setLibrary({ libraryScrollTop: 0 });
        globalImageCache.clear();
        setUI({ activeView: 'library' });
      }

      setLibrary({
        isViewLoading: true,
        currentFolderPath: `Album: ${albumName}`,
        activeAlbumId: albumId,
      });

      try {
        const files: ImageFile[] = await invoke(Invokes.GetAlbumImages, { paths: imagePaths });

        const initialRatings: Record<string, number> = {};
        files.forEach((f) => {
          initialRatings[f.path] = f.rating;
        });

        setLibrary({
          imageList: files,
          imageRatings: initialRatings,
          ...(preserveEditor ? {} : { multiSelectedPaths: [], libraryActivePath: null }),
        });
      } catch (err) {
        console.error('Failed to load album images:', err);
        toast.error(`Failed to load album: ${formatUnknownError(err)}`);
      } finally {
        setLibrary({ isViewLoading: false });
      }
    },
    [clearThumbnailQueue],
  );

  const handleOpenFolder = async () => {
    const { osPlatform, appSettings, handleSettingsChange } = useSettingsStore.getState();
    const { rootPaths, folderTrees, setLibrary } = useLibraryStore.getState();
    const isAndroid = osPlatform === 'android';

    try {
      let selectedPath = '';
      if (isAndroid) {
        selectedPath = await invoke<string>(Invokes.GetOrCreateInternalLibraryRoot);
      } else {
        const selected = await open({ directory: true, multiple: false, defaultPath: await homeDir() });
        if (typeof selected === 'string') {
          selectedPath = selected;
        }
      }

      if (selectedPath) {
        if (!rootPaths.includes(selectedPath)) {
          const newRootPaths = [...rootPaths, selectedPath];
          setLibrary({ rootPaths: newRootPaths });

          if (appSettings) {
            void handleSettingsChange({ ...appSettings, rootFolders: newRootPaths });
          }

          setLibrary({ isTreeLoading: true });
          try {
            const newTree = await invoke<FolderTree>(Invokes.GetFolderTree, {
              path: selectedPath,
              expandedFolders: [selectedPath],
              showImageCounts: appSettings?.enableFolderImageCounts ?? false,
            });
            setLibrary({ folderTrees: [...folderTrees, newTree] });
          } catch (e) {
            toast.error(`Failed to load folder tree: ${formatUnknownError(e)}`);
          } finally {
            setLibrary({ isTreeLoading: false });
          }
        }
        await handleSelectSubfolder(selectedPath, true);
      }
    } catch (err) {
      console.error(isAndroid ? 'Failed to open Android library root:' : 'Failed to open directory dialog:', err);
      toast.error(isAndroid ? 'Failed to open library.' : 'Failed to open folder selection dialog.');
    }
  };

  const handleContinueSession = () => {
    const restore = async () => {
      const appSettings = getNavigationSettings();
      const { setLibrary } = useLibraryStore.getState();

      const rootFolders = appSettings?.rootFolders?.length
        ? appSettings.rootFolders
        : appSettings?.lastRootPath
          ? [appSettings.lastRootPath]
          : [];

      if (rootFolders.length === 0) return;
      const fallbackRootFolder = rootFolders[0];
      if (!fallbackRootFolder) return;

      const folderState = appSettings?.lastFolderState;
      let pathToSelect = folderState?.currentFolderPath ?? fallbackRootFolder;

      setLibrary({ rootPaths: rootFolders });

      if (folderState?.expandedFolders) {
        const newExpandedFolders = new Set<string>(folderState.expandedFolders);
        setLibrary({ expandedFolders: newExpandedFolders });
      } else {
        setLibrary({ expandedFolders: new Set(rootFolders) });
      }

      setLibrary({ isTreeLoading: true });
      try {
        let treesData: FolderTree[];
        if (preloadedDataRef.current.rootPaths?.join() === rootFolders.join() && preloadedDataRef.current.trees) {
          treesData = await preloadedDataRef.current.trees;
          preloadedDataRef.current.trees = undefined;
        } else {
          const expandedArr = folderState?.expandedFolders
            ? Array.from(new Set(folderState.expandedFolders))
            : rootFolders;
          treesData = await invoke<FolderTree[]>(Invokes.GetPinnedFolderTrees, {
            paths: rootFolders,
            expandedFolders: expandedArr,
            showImageCounts: appSettings?.enableFolderImageCounts ?? false,
          });
        }
        setLibrary({ folderTrees: treesData });

        const resolvedPathToSelect = resolveRestoredFolderPath(treesData, pathToSelect, fallbackRootFolder);
        if (pathToSelect !== resolvedPathToSelect) {
          toast.warn('The previous folder could not be found. Restored the root folder instead.');
          pathToSelect = resolvedPathToSelect;
        }
      } catch (err) {
        console.error('Failed to restore folder trees:', err);
      } finally {
        setLibrary({ isTreeLoading: false });
      }

      let preloadedImages: ImageFile[] | undefined;
      if (preloadedDataRef.current.currentPath === pathToSelect && preloadedDataRef.current.images) {
        try {
          preloadedImages = await preloadedDataRef.current.images;
          preloadedDataRef.current.images = undefined;
        } catch (e) {
          console.error('Failed to retrieve preloaded images', e);
        }
      }

      if (pathToSelect && pathToSelect.startsWith('Album: ')) {
        const activeAlbumId = folderState?.activeAlbumId;
        if (activeAlbumId) {
          try {
            const albumTree = await invoke<AlbumItem[]>(Invokes.GetAlbums);
            setLibrary({ albumTree });

            const album = findAlbumById(albumTree, activeAlbumId);
            if (album) {
              await handleSelectAlbum(album.id, album.name, album.images);
            } else {
              const fallbackRoot = rootFolders[0];
              if (fallbackRoot) await handleSelectSubfolder(fallbackRoot, false, undefined, false);
            }
          } catch (e) {
            console.error('Failed to restore album session:', e);
            const fallbackRoot = rootFolders[0];
            if (fallbackRoot) await handleSelectSubfolder(fallbackRoot, false, undefined, false);
          }
        } else {
          const fallbackRoot = rootFolders[0];
          if (fallbackRoot) await handleSelectSubfolder(fallbackRoot, false, undefined, false);
        }
      } else {
        await handleSelectSubfolder(pathToSelect, false, preloadedImages, false);
      }
    };

    restore().catch((err: unknown) => {
      console.error('Failed to restore session:', err);
      toast.error('Failed to restore session. A folder may have been moved or deleted.');
      handleGoHome();
      useLibraryStore.getState().setLibrary({ isTreeLoading: false });
    });
  };

  return {
    handleGoHome,
    handleBackToLibrary,
    handleImageSelect,
    handleSelectSubfolder,
    handleSelectAlbum,
    handleOpenFolder,
    handleContinueSession,
  };
}
