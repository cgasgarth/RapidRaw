import { ClerkProvider } from '@clerk/react';
import cx from 'clsx';
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Slide, ToastContainer } from 'react-toastify';
import { useShallow } from 'zustand/react/shallow';

import ImageLoaderManager from './components/managers/ImageLoaderManager';
import ImageProcessingManager from './components/managers/ImageProcessingManager';
import AppModals from './components/modals/AppModals';
import FolderTreePanel from './components/panel/FolderTree';
import ExportPanel from './components/panel/right/ExportPanel';
import {
  type ImageFile,
  LibraryViewMode,
  Orientation,
  Panel,
  Theme,
  ThumbnailAspectRatio,
  ThumbnailSize,
} from './components/ui/AppProperties';
import GlobalTooltip from './components/ui/GlobalTooltip';
import Resizer from './components/ui/Resizer';
import EditorView from './components/views/EditorView';
import LibraryView from './components/views/LibraryView';
import { ContextMenuProvider } from './context/ContextMenuContext';
import { useAiConnectorStatus } from './hooks/useAiConnectorStatus';
import { useAppContextMenus } from './hooks/useAppContextMenus';
import { useAppInitialization } from './hooks/useAppInitialization';
import { useAppNavigation } from './hooks/useAppNavigation';
import { useEditorActions } from './hooks/useEditorActions';
import { useFileOperations } from './hooks/useFileOperations';
import { useFolderExpansionLoader } from './hooks/useFolderExpansionLoader';
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts';
import { useLibraryActions } from './hooks/useLibraryActions';
import { usePanelResize } from './hooks/usePanelResize';
import { useProductivityActions } from './hooks/useProductivityActions';
import { useSortedLibrary } from './hooks/useSortedLibrary';
import { useTauriListeners } from './hooks/useTauriListeners';
import { useThumbnails } from './hooks/useThumbnails';
import { useTooltipAccessibility } from './hooks/useTooltipAccessibility';
import './i18n';
import type { UnlistenFn } from '@tauri-apps/api/event';
import type { FolderTree as FolderTreeNode } from './components/panel/FolderTree';
import type { ImageDimensions } from './hooks/useImageRenderSize';
import { useEditorStore } from './store/useEditorStore';
import { useLibraryStore } from './store/useLibraryStore';
import { useProcessStore } from './store/useProcessStore';
import { useSettingsStore } from './store/useSettingsStore';
import { useUIStore } from './store/useUIStore';
import type { Adjustments } from './utils/adjustments';
import { findAlbumById } from './utils/folderTreeUtils';
import { getViteEnv } from './utils/frontendEnv.mjs';
import type { ImageCacheEntry } from './utils/ImageLRUCache';
import { getOptionalCurrentWindow } from './window/currentWindow';
import TitleBar from './window/TitleBar';

const LOCAL_DEV_CLERK_PUBLISHABLE_KEY = 'pk_test_YnJpZWYtc2Vhc25haWwtMTIuY2xlcmsuYWNjb3VudHMuZGV2JA';
const CLERK_PUBLISHABLE_KEY = getViteEnv().VITE_CLERK_PUBLISHABLE_KEY ?? LOCAL_DEV_CLERK_PUBLISHABLE_KEY;

interface PreviousAdjustments {
  adjustments: Adjustments;
  path: string;
}

interface TransformController {
  resetTransform(time?: number): void;
  setTransform(x: number, y: number, scale: number, time?: number): void;
  zoomIn(factor: number, time?: number): void;
  zoomOut(factor: number, time?: number): void;
}

interface PreloadedAppData {
  currentPath?: string;
  images?: Promise<ImageFile[]> | undefined;
  rootPaths?: string[];
  trees?: Promise<FolderTreeNode[]> | undefined;
}

export function LibraryExportPanelSlot({
  children,
  hasSelectedImage,
  isLibraryExportPanelVisible,
}: {
  children: ReactNode;
  hasSelectedImage: boolean;
  isLibraryExportPanelVisible: boolean;
}) {
  return !hasSelectedImage && isLibraryExportPanelVisible ? <>{children}</> : null;
}

function App() {
  const COMPACT_EDITOR_MAX_WIDTH = 900;
  useTooltipAccessibility();

  const { appSettings, theme, osPlatform, handleSettingsChange } = useSettingsStore(
    useShallow((state) => ({
      appSettings: state.appSettings,
      theme: state.theme,
      osPlatform: state.osPlatform,
      handleSettingsChange: state.handleSettingsChange,
    })),
  );
  const handleSettingsChangeVoid = useCallback(
    (settings: Parameters<typeof handleSettingsChange>[0]) => {
      void handleSettingsChange(settings);
    },
    [handleSettingsChange],
  );

  const {
    isFullScreen,
    isWindowFullScreen,
    isInstantTransition,
    isLayoutReady,
    uiVisibility,
    isLibraryExportPanelVisible,
    leftPanelWidth,
    rightPanelWidth,
    compactEditorPanelHeightOverride,
    activeRightPanel,
    setUI,
    setRightPanel,
  } = useUIStore(
    useShallow((state) => ({
      isFullScreen: state.isFullScreen,
      isWindowFullScreen: state.isWindowFullScreen,
      isInstantTransition: state.isInstantTransition,
      isLayoutReady: state.isLayoutReady,
      uiVisibility: state.uiVisibility,
      isLibraryExportPanelVisible: state.isLibraryExportPanelVisible,
      leftPanelWidth: state.leftPanelWidth,
      rightPanelWidth: state.rightPanelWidth,
      compactEditorPanelHeightOverride: state.compactEditorPanelHeightOverride,
      activeRightPanel: state.activeRightPanel,
      setUI: state.setUI,
      setRightPanel: state.setRightPanel,
    })),
  );

  const { rootPaths, currentFolderPath, multiSelectedPaths } = useLibraryStore(
    useShallow((state) => ({
      rootPaths: state.rootPaths,
      currentFolderPath: state.currentFolderPath,
      multiSelectedPaths: state.multiSelectedPaths,
    })),
  );

  const { selectedImage, activeMaskContainerId, activeAiPatchContainerId, hasRenderedFirstFrame, setEditor } =
    useEditorStore(
      useShallow((state) => ({
        selectedImage: state.selectedImage,
        activeMaskContainerId: state.activeMaskContainerId,
        activeAiPatchContainerId: state.activeAiPatchContainerId,
        hasRenderedFirstFrame: state.hasRenderedFirstFrame,
        setEditor: state.setEditor,
      })),
    );

  const { exportState, setExportState } = useProcessStore(
    useShallow((state) => ({
      exportState: state.exportState,
      setExportState: state.setExportState,
    })),
  );

  const defaultThumbnailSize = osPlatform === 'android' ? ThumbnailSize.Small : ThumbnailSize.Medium;
  const defaultLibraryViewMode = osPlatform === 'android' ? LibraryViewMode.Recursive : LibraryViewMode.Flat;

  const selectedImagePathRef = useRef<string | null>(null);
  useEffect(() => {
    selectedImagePathRef.current = selectedImage?.path ?? null;
  }, [selectedImage?.path]);

  const prevAdjustmentsRef = useRef<PreviousAdjustments | null>(null);

  const [viewportSize, setViewportSize] = useState<ImageDimensions>(() => {
    if (typeof window === 'undefined') {
      return { width: 0, height: 0 };
    }

    return {
      width: Math.round(window.visualViewport?.width ?? window.innerWidth),
      height: Math.round(window.visualViewport?.height ?? window.innerHeight),
    };
  });

  const isBackendReadyRef = useRef(true);
  const previewJobIdRef = useRef<number>(0);
  const latestRenderedJobIdRef = useRef<number>(0);
  const currentResRef = useRef<number>(1280);
  const cachedEditStateRef = useRef<ImageCacheEntry | null>(null);

  const [libraryViewMode, setLibraryViewMode] = useState<LibraryViewMode>(defaultLibraryViewMode);
  const [isResizing, setIsResizing] = useState(false);
  const [thumbnailSize, setThumbnailSize] = useState(defaultThumbnailSize);
  const [thumbnailAspectRatio, setThumbnailAspectRatio] = useState(ThumbnailAspectRatio.Cover);

  const { requestThumbnails, clearThumbnailQueue, markGenerated } = useThumbnails();

  const transformWrapperRef = useRef<TransformController | null>(null);
  const preloadedDataRef = useRef<PreloadedAppData>({});

  useAppInitialization({
    thumbnailSize,
    setThumbnailSize,
    thumbnailAspectRatio,
    setThumbnailAspectRatio,
    libraryViewMode,
    setLibraryViewMode,
  });
  useAiConnectorStatus();

  const isAndroid = osPlatform === 'android';
  const isPortraitViewport = viewportSize.width > 0 && viewportSize.height > viewportSize.width;
  const isCompactPortrait =
    viewportSize.width > 0 && viewportSize.width <= COMPACT_EDITOR_MAX_WIDTH && isPortraitViewport;

  const compactEditorPanelMinHeight = 220;
  const compactEditorPanelMaxHeight =
    viewportSize.height > 0
      ? Math.max(compactEditorPanelMinHeight, Math.min(Math.round(viewportSize.height * 0.85), 850))
      : 520;

  const getDynamicCompactPanelHeight = () => {
    const { originalSize, adjustments } = useEditorStore.getState();
    const halfScreenHeight = viewportSize.height > 0 ? Math.round(viewportSize.height * 0.5) : 340;

    if (!selectedImage || originalSize.width === 0 || originalSize.height === 0 || viewportSize.width === 0) {
      return halfScreenHeight;
    }
    let effectiveRatio = originalSize.width / originalSize.height;
    const orientationSteps = adjustments.orientationSteps;
    if (orientationSteps % 2 !== 0) {
      effectiveRatio = originalSize.height / originalSize.width;
    }
    if (adjustments.aspectRatio && adjustments.aspectRatio > 0) {
      effectiveRatio = adjustments.aspectRatio;
    }
    const desiredImageHeight = viewportSize.width / effectiveRatio;
    const topUiEstimation = !appSettings?.decorations && !isWindowFullScreen ? 110 : 60;
    const totalDesiredTopHeight = desiredImageHeight + topUiEstimation;
    const calculatedBottomHeight = Math.round(viewportSize.height - totalDesiredTopHeight);
    return Math.max(halfScreenHeight, calculatedBottomHeight);
  };

  const compactEditorPanelDefaultHeight = getDynamicCompactPanelHeight();
  const compactEditorPanelHeight = Math.max(
    compactEditorPanelMinHeight,
    Math.min(compactEditorPanelHeightOverride ?? compactEditorPanelDefaultHeight, compactEditorPanelMaxHeight),
  );
  const compactEditorPanelCollapsedHeight = 96;
  const handleLeftPanelWidthChange = useCallback(
    (width: number) => {
      setUI({ leftPanelWidth: width });
    },
    [setUI],
  );
  const handleRightPanelWidthChange = useCallback(
    (width: number) => {
      setUI({ rightPanelWidth: width });
    },
    [setUI],
  );
  const handleBottomPanelHeightChange = useCallback(
    (height: number) => {
      setUI({ bottomPanelHeight: height });
    },
    [setUI],
  );
  const handleCompactEditorPanelHeightOverrideChange = useCallback(
    (height: number) => {
      setUI({ compactEditorPanelHeightOverride: height });
    },
    [setUI],
  );
  const createResizeHandler = usePanelResize({
    compactEditorPanelMaxHeight,
    compactEditorPanelMinHeight,
    onBottomPanelHeightChange: handleBottomPanelHeightChange,
    onCompactEditorPanelHeightOverrideChange: handleCompactEditorPanelHeightOverrideChange,
    onLeftPanelWidthChange: handleLeftPanelWidthChange,
    onResizingChange: setIsResizing,
    onRightPanelWidthChange: handleRightPanelWidthChange,
  });

  const { handleCopyAdjustments, handlePasteAdjustments, handleResetAdjustments, handleZoomChange } =
    useEditorActions();
  const handleCopyAdjustmentsVoid = useCallback(() => {
    void handleCopyAdjustments();
  }, [handleCopyAdjustments]);
  const handlePasteAdjustmentsVoid = useCallback(() => {
    handlePasteAdjustments();
  }, [handlePasteAdjustments]);

  const navigationRefs = {
    transformWrapperRef,
    preloadedDataRef,
    cachedEditStateRef,
    selectedImagePathRef,
    isBackendReadyRef,
    latestRenderedJobIdRef,
    previewJobIdRef,
    currentResRef,
    prevAdjustmentsRef,
  };

  const {
    handleGoHome,
    handleBackToLibrary,
    handleImageSelect,
    handleSelectSubfolder,
    handleSelectAlbum,
    handleOpenFolder,
    handleContinueSession,
  } = useAppNavigation({
    clearThumbnailQueue,
    refs: navigationRefs,
  });
  const handleImageSelectVoid = useCallback(
    (path: string) => {
      void handleImageSelect(path);
    },
    [handleImageSelect],
  );
  const handleSelectSubfolderVoid = useCallback(
    (path: string, isNewRoot?: boolean, preloadedImages?: Array<ImageFile>, expandParents?: boolean) => {
      void handleSelectSubfolder(path, isNewRoot, preloadedImages, expandParents);
    },
    [handleSelectSubfolder],
  );
  const handleSelectAlbumVoid = useCallback(
    (albumId: string, albumName: string, images: string[]) => {
      void handleSelectAlbum(albumId, albumName, images);
    },
    [handleSelectAlbum],
  );
  const handleOpenFolderVoid = useCallback(() => {
    void handleOpenFolder();
  }, [handleOpenFolder]);

  const {
    handleRate,
    handleClearSelection,
    handleLibraryImageSingleClick,
    handleImageClick,
    handleSetColorLabel,
    refreshAllFolderTrees,
    handleTogglePinFolder,
    handleCreateAlbumItem,
    handleRenameAlbumItem,
  } = useLibraryActions(handleImageSelectVoid);
  const refreshAllFolderTreesVoid = useCallback(() => {
    void refreshAllFolderTrees();
  }, [refreshAllFolderTrees]);

  const sortedImageList = useSortedLibrary();

  const handleLibraryRefresh = useCallback(async () => {
    if (currentFolderPath) {
      if (currentFolderPath.startsWith('Album: ')) {
        const { activeAlbumId, albumTree } = useLibraryStore.getState();
        if (activeAlbumId) {
          const album = findAlbumById(albumTree, activeAlbumId);
          if (album) await handleSelectAlbum(album.id, album.name, album.images, true);
        }
      } else {
        await handleSelectSubfolder(currentFolderPath, false, undefined, false, true);
      }
    }
  }, [currentFolderPath, handleSelectSubfolder, handleSelectAlbum]);

  const handleLinkedVariantImported = useCallback(
    async (path: string) => {
      await handleLibraryRefresh();
      const { imageList, setLibrary } = useLibraryStore.getState();
      if (!imageList.some((image) => image.path === path)) return;
      setLibrary({ libraryActivePath: path, multiSelectedPaths: [path], selectionAnchorPath: path });
      requestThumbnails([path]);
    },
    [handleLibraryRefresh, requestThumbnails],
  );

  const {
    executeDelete,
    handleDeleteSelected,
    handleCreateFolder,
    handleRenameFolder,
    handleSaveRename,
    handleRenameFiles,
    handleStartImport,
    handleImportClick,
    handlePasteFiles,
  } = useFileOperations(
    handleLibraryRefresh,
    refreshAllFolderTrees,
    handleImageSelectVoid,
    handleBackToLibrary,
    sortedImageList,
  );
  const handleImportClickVoid = useCallback(
    (path: string) => {
      void handleImportClick(path);
    },
    [handleImportClick],
  );
  const handlePasteFilesVoid = useCallback(
    (mode: string) => {
      void handlePasteFiles(mode);
    },
    [handlePasteFiles],
  );

  const {
    handleStartPanorama,
    handleSavePanorama,
    handleStartHdr,
    handleSaveHdr,
    handleApplyDenoise,
    handleBatchDenoise,
    handleSaveDenoisedImage,
    handleSaveCollage,
  } = useProductivityActions(handleLibraryRefresh);
  const handleStartPanoramaVoid = useCallback(
    (paths: string[]) => {
      void handleStartPanorama(paths);
    },
    [handleStartPanorama],
  );

  const {
    handleEditorContextMenu,
    handleThumbnailContextMenu,
    handleFolderTreeContextMenu,
    handleAlbumTreeContextMenu,
    handleMainLibraryContextMenu,
  } = useAppContextMenus({
    handleImageSelect: handleImageSelectVoid,
    handleBackToLibrary,
    handleLibraryRefresh,
    handleRenameFiles,
    handleImportClick: handleImportClickVoid,
    refreshAllFolderTrees,
    refreshImageList: handleLibraryRefresh,
    executeDelete,
    handleTogglePinFolder,
  });

  useTauriListeners({
    refreshAllFolderTrees: refreshAllFolderTreesVoid,
    handleSelectSubfolder: handleSelectSubfolderVoid,
    refreshImageList: () => {
      void handleLibraryRefresh();
    },
    markGenerated,
  });

  const handleToggleFullScreen = useCallback(() => {
    const { zoom, selectedImage } = useEditorStore.getState();
    const currentlyZoomed = zoom > 1.01;
    setUI({ isInstantTransition: currentlyZoomed });

    if (isFullScreen) {
      setUI({ isFullScreen: false });
    } else {
      if (!selectedImage) return;
      setUI({ isFullScreen: true });
    }

    if (currentlyZoomed) {
      setTimeout(() => {
        setUI({ isInstantTransition: false });
      }, 100);
    }
  }, [isFullScreen, setUI]);

  useKeyboardShortcuts({
    sortedImageList,
    handleBackToLibrary,
    handleDeleteSelected,
    handleImageSelect: handleImageSelectVoid,
    handlePasteFiles: handlePasteFilesVoid,
    handleToggleFullScreen,
    handleZoomChange,
  });

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const updateViewportSize = () => {
      const nextViewportSize = {
        width: Math.round(window.visualViewport?.width ?? window.innerWidth),
        height: Math.round(window.visualViewport?.height ?? window.innerHeight),
      };

      setViewportSize((prev) =>
        prev.width === nextViewportSize.width && prev.height === nextViewportSize.height ? prev : nextViewportSize,
      );
    };

    updateViewportSize();

    window.addEventListener('resize', updateViewportSize);
    window.addEventListener('orientationchange', updateViewportSize);
    window.visualViewport?.addEventListener('resize', updateViewportSize);

    return () => {
      window.removeEventListener('resize', updateViewportSize);
      window.removeEventListener('orientationchange', updateViewportSize);
      window.visualViewport?.removeEventListener('resize', updateViewportSize);
    };
  }, []);

  useEffect(() => {
    const handleGlobalContextMenu = (event: MouseEvent) => {
      event.preventDefault();
    };
    window.addEventListener('contextmenu', handleGlobalContextMenu);
    return () => {
      window.removeEventListener('contextmenu', handleGlobalContextMenu);
    };
  }, []);

  const isLightTheme = useMemo(() => [Theme.Light, Theme.Snow, Theme.Arctic].includes(theme), [theme]);

  useEffect(() => {
    if (
      (activeRightPanel !== Panel.Masks || !activeMaskContainerId) &&
      (activeRightPanel !== Panel.Ai || !activeAiPatchContainerId)
    ) {
      setEditor({ isMaskControlHovered: false });
    }
  }, [activeRightPanel, activeMaskContainerId, activeAiPatchContainerId, setEditor]);

  useEffect(() => {
    const appWindow = getOptionalCurrentWindow();
    if (!appWindow) {
      setUI({ isWindowFullScreen: false });
      return undefined;
    }

    const checkFullscreen = async () => {
      setUI({ isWindowFullScreen: await appWindow.isFullscreen() });
    };
    void checkFullscreen();
    let unlisten: UnlistenFn | undefined;
    let didCleanup = false;
    void appWindow
      .onResized(checkFullscreen)
      .then((nextUnlisten: UnlistenFn) => {
        if (didCleanup) {
          nextUnlisten();
          return;
        }
        unlisten = nextUnlisten;
      })
      .catch((err: unknown) => {
        console.error('Failed to subscribe to window resize listener:', err);
      });
    return () => {
      didCleanup = true;
      unlisten?.();
    };
  }, [setUI]);

  const handleRightPanelSelect = useCallback(
    (panelId: Panel) => {
      setRightPanel(panelId);
      setEditor({ activeMaskId: null, activeAiSubMaskId: null, isWbPickerActive: false });
    },
    [setRightPanel, setEditor],
  );

  const enableFolderImageCounts = appSettings?.enableFolderImageCounts ?? false;
  const handleToggleFolder = useFolderExpansionLoader(enableFolderImageCounts);

  const hasRoots = rootPaths.length > 0;

  const renderFolderTree = () => {
    if (!hasRoots) return null;

    return (
      <div
        className={cx(
          'flex h-full overflow-hidden shrink-0',
          !isResizing && !isInstantTransition && 'transition-all duration-300 ease-in-out',
        )}
        style={{
          maxWidth: isFullScreen ? '0px' : '1000px',
          opacity: isFullScreen ? 0 : 1,
        }}
      >
        <FolderTreePanel
          isResizing={isResizing}
          isVisible={uiVisibility.folderTree}
          onContextMenu={handleFolderTreeContextMenu}
          onAlbumContextMenu={handleAlbumTreeContextMenu}
          onSelectAlbum={handleSelectAlbumVoid}
          onFolderSelect={(path) => {
            void handleSelectSubfolder(path, false);
          }}
          onToggleFolder={(path) => {
            void handleToggleFolder(path);
          }}
          onOpenFolder={handleOpenFolderVoid}
          setIsVisible={(value: boolean) => {
            setUI((state) => ({ uiVisibility: { ...state.uiVisibility, folderTree: value } }));
          }}
          style={{ width: uiVisibility.folderTree ? `${leftPanelWidth}px` : '32px' }}
          isInstantTransition={isInstantTransition}
        />
        <Resizer direction={Orientation.Vertical} onMouseDown={createResizeHandler('left', leftPanelWidth)} />
      </div>
    );
  };

  const shouldHideFolderTree = isAndroid;
  const isWgpuActive = appSettings?.useWgpuRenderer !== false && selectedImage?.isReady && hasRenderedFirstFrame;
  const useMacWindowShell = osPlatform === 'macos' && !appSettings?.decorations && !isWindowFullScreen && !isFullScreen;

  return (
    <>
      <ImageProcessingManager
        transformWrapperRef={transformWrapperRef}
        prevAdjustmentsRef={prevAdjustmentsRef}
        previewJobIdRef={previewJobIdRef}
        latestRenderedJobIdRef={latestRenderedJobIdRef}
        currentResRef={currentResRef}
      />
      <ImageLoaderManager cachedEditStateRef={cachedEditStateRef} />
      <div
        className={cx(
          'flex flex-col h-screen font-sans text-text-primary overflow-hidden select-none',
          useMacWindowShell && 'macos-window-shell',
          isWgpuActive ? 'bg-transparent' : 'bg-bg-primary',
        )}
      >
        <div
          className={cx(
            'shrink-0 overflow-hidden z-50',
            !isInstantTransition && 'transition-all duration-300 ease-in-out',
            isFullScreen ? 'max-h-0 opacity-0 pointer-events-none' : 'max-h-[60px] opacity-100',
          )}
        >
          {appSettings?.decorations || (!isWindowFullScreen && <TitleBar />)}
        </div>
        <div
          className={cx(
            'flex-1 flex flex-col min-h-0',
            isLayoutReady && hasRoots && !isInstantTransition && 'transition-all duration-300 ease-in-out',
            [hasRoots && (isFullScreen ? 'p-0 gap-0' : 'p-2 gap-2')],
          )}
        >
          <div className="flex flex-row grow h-full min-h-0">
            {!shouldHideFolderTree && renderFolderTree()}
            <div className="flex-1 flex flex-col min-w-0">
              {selectedImage ? (
                <EditorView
                  transformWrapperRef={transformWrapperRef}
                  isResizing={isResizing}
                  isCompactPortrait={isCompactPortrait}
                  isAndroid={isAndroid}
                  compactEditorPanelHeight={compactEditorPanelHeight}
                  compactEditorPanelCollapsedHeight={compactEditorPanelCollapsedHeight}
                  thumbnailAspectRatio={thumbnailAspectRatio}
                  sortedImageList={sortedImageList}
                  createResizeHandler={createResizeHandler}
                  handleBackToLibrary={handleBackToLibrary}
                  handleEditorContextMenu={handleEditorContextMenu}
                  handleThumbnailContextMenu={handleThumbnailContextMenu}
                  handleImageClick={handleImageClick}
                  handleImageSelect={handleImageSelectVoid}
                  handleClearSelection={handleClearSelection}
                  handleCopyAdjustments={handleCopyAdjustmentsVoid}
                  handlePasteAdjustments={handlePasteAdjustmentsVoid}
                  handleRate={handleRate}
                  handleZoomChange={handleZoomChange}
                  handleRightPanelSelect={handleRightPanelSelect}
                  requestThumbnails={requestThumbnails}
                  refreshImageList={handleLibraryRefresh}
                />
              ) : (
                <LibraryView
                  sortedImageList={sortedImageList}
                  thumbnailSize={thumbnailSize}
                  thumbnailAspectRatio={thumbnailAspectRatio}
                  libraryViewMode={libraryViewMode}
                  isAndroid={isAndroid}
                  setThumbnailSize={setThumbnailSize}
                  setThumbnailAspectRatio={setThumbnailAspectRatio}
                  setLibraryViewMode={setLibraryViewMode}
                  handleClearSelection={handleClearSelection}
                  handleLibraryImageSingleClick={handleLibraryImageSingleClick}
                  handleImageSelect={handleImageSelectVoid}
                  handleRate={handleRate}
                  handleThumbnailContextMenu={handleThumbnailContextMenu}
                  handleMainLibraryContextMenu={handleMainLibraryContextMenu}
                  handleContinueSession={handleContinueSession}
                  handleGoHome={handleGoHome}
                  handleOpenFolder={handleOpenFolder}
                  handleImportClick={handleImportClickVoid}
                  handleLibraryRefresh={handleLibraryRefresh}
                  handleCopyAdjustments={handleCopyAdjustmentsVoid}
                  handlePasteAdjustments={handlePasteAdjustmentsVoid}
                  handleResetAdjustments={handleResetAdjustments}
                  requestThumbnails={requestThumbnails}
                />
              )}
            </div>
            <LibraryExportPanelSlot
              hasSelectedImage={selectedImage !== null}
              isLibraryExportPanelVisible={isLibraryExportPanelVisible}
            >
              <>
                <Resizer direction={Orientation.Vertical} onMouseDown={createResizeHandler('right', rightPanelWidth)} />
                <div
                  className={cx(
                    'shrink-0 overflow-hidden',
                    !isResizing && !isInstantTransition && 'transition-all duration-300 ease-in-out',
                  )}
                  style={{ width: isFullScreen ? '0px' : `${rightPanelWidth}px` }}
                >
                  <ExportPanel
                    exportState={exportState}
                    multiSelectedPaths={multiSelectedPaths}
                    selectedImage={null}
                    setExportState={setExportState}
                    appSettings={appSettings}
                    onSettingsChange={handleSettingsChangeVoid}
                    rootPaths={rootPaths}
                    isVisible={isLibraryExportPanelVisible}
                    onLinkedVariantImported={handleLinkedVariantImported}
                    onClose={() => {
                      setUI({ isLibraryExportPanelVisible: false });
                    }}
                  />
                </div>
              </>
            </LibraryExportPanelSlot>
          </div>
        </div>
        <AppModals
          handleImageSelect={handleImageSelect}
          handleSavePanorama={handleSavePanorama}
          handleStartPanorama={handleStartPanoramaVoid}
          handleSaveHdr={handleSaveHdr}
          handleStartHdr={handleStartHdr}
          refreshImageList={handleLibraryRefresh}
          handleApplyDenoise={handleApplyDenoise}
          handleBatchDenoise={handleBatchDenoise}
          handleSaveDenoisedImage={handleSaveDenoisedImage}
          handleCreateFolder={handleCreateFolder}
          handleRenameFolder={handleRenameFolder}
          handleSaveRename={handleSaveRename}
          handleStartImport={handleStartImport}
          handleSetColorLabel={handleSetColorLabel}
          handleRate={handleRate}
          executeDelete={executeDelete}
          handleSaveCollage={handleSaveCollage}
          handleCreateAlbumItem={handleCreateAlbumItem}
          handleRenameAlbumItem={handleRenameAlbumItem}
          handleBackToLibrary={handleBackToLibrary}
        />
        <ToastContainer
          position="bottom-right"
          autoClose={5000}
          hideProgressBar={false}
          newestOnTop
          closeOnClick
          rtl={false}
          pauseOnFocusLoss
          draggable={false}
          pauseOnHover
          theme={isLightTheme ? 'light' : 'dark'}
          transition={Slide}
          toastClassName={() =>
            cx(
              'relative flex min-h-16 p-4 rounded-lg justify-between overflow-hidden cursor-pointer mb-4',
              'bg-surface! text-text-primary! border! border-border-color! shadow-2xl! max-w-[420px]!',
            )
          }
        />
      </div>
    </>
  );
}

const AppWrapper = () => (
  <ClerkProvider publishableKey={CLERK_PUBLISHABLE_KEY} routerPush={(_to) => {}} routerReplace={(_to) => {}}>
    <ContextMenuProvider>
      <App />
      <GlobalTooltip />
    </ContextMenuProvider>
  </ClerkProvider>
);

export default AppWrapper;
