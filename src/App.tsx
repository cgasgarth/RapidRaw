import { ClerkProvider } from '@clerk/react';
import cx from 'clsx';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';

import { AppModalHost } from './components/app/AppModalHost';
import { AppServices } from './components/app/AppServices';
import { GlobalStatusSurfaces } from './components/app/GlobalStatusSurfaces';
import { LibraryExportPanelRoot } from './components/app/LibraryExportPanelRoot';
import { RenderIsland } from './components/app/RenderIsland';
import { EditorWorkspaceRoot, LibraryWorkspaceRoot } from './components/app/WorkspaceRoots';
import { EditorHistorySection, EditorSnapshotsSection } from './components/panel/editor/EditorHistorySections';
import EditorLeftSidebar, { type EditorLeftSectionId } from './components/panel/editor/EditorLeftSidebar';
import EditorNavigator, { type EditorTransformController } from './components/panel/editor/EditorNavigator';
import { FocusStackRetouchPanel } from './components/panel/editor/FocusStackRetouchPanel';
import FolderTreePanel from './components/panel/FolderTree';
import { PresetsPanel } from './components/panel/right/color/PresetsPanel';
import {
  type ImageFile,
  LibraryViewMode,
  Orientation,
  type Panel,
  ThumbnailAspectRatio,
  ThumbnailSize,
} from './components/ui/AppProperties';
import GlobalTooltip from './components/ui/GlobalTooltip';
import Resizer from './components/ui/Resizer';
import { ContextMenuProvider } from './context/ContextMenuContext';
import { useAiConnectorStatus } from './hooks/ai/useAiConnectorStatus';
import { useAppContextMenus } from './hooks/app/useAppContextMenus';
import { useAppInitialization } from './hooks/app/useAppInitialization';
import { useAppNavigation } from './hooks/app/useAppNavigation';
import { useKeyboardShortcuts } from './hooks/app/useKeyboardShortcuts';
import { useProductivityActions } from './hooks/app/useProductivityActions';
import { useTauriListeners } from './hooks/app/useTauriListeners';
import { useTooltipAccessibility } from './hooks/app/useTooltipAccessibility';
import { useEditorActions } from './hooks/editor/useEditorActions';
import { useFileOperations } from './hooks/library/useFileOperations';
import { useFolderExpansionLoader } from './hooks/library/useFolderExpansionLoader';
import { useLibraryActions } from './hooks/library/useLibraryActions';
import { useSelectedFolderRefreshWatcher } from './hooks/library/useSelectedFolderRefreshWatcher';
import { useSortedLibrary } from './hooks/library/useSortedLibrary';
import { useThumbnails } from './hooks/library/useThumbnails';
import { useEditorWorkspaceViewportSubscription } from './hooks/viewport/useEditorWorkspaceViewportSubscription';
import { usePanelResize } from './hooks/viewport/usePanelResize';
import './i18n';
import type { UnlistenFn } from '@tauri-apps/api/event';
import type { FolderTree as FolderTreeNode } from './components/panel/FolderTree';
import { useEditorStore } from './store/useEditorStore';
import { useLibraryStore } from './store/useLibraryStore';
import { useProcessStore } from './store/useProcessStore';
import { useSettingsStore } from './store/useSettingsStore';
import { useUIStore } from './store/useUIStore';
import type { Adjustments } from './utils/adjustments';
import { findAlbumById } from './utils/folderTreeUtils';
import { getViteEnv } from './utils/frontendEnv.mjs';
import { globalImageCache } from './utils/ImageLRUCache';
import { getWorkspaceLeftSurface } from './utils/workspaceLeftSurface';
import { getOptionalCurrentWindow } from './window/currentWindow';
import TitleBar from './window/TitleBar';

const LOCAL_DEV_CLERK_PUBLISHABLE_KEY = 'pk_test_YnJpZWYtc2Vhc25haWwtMTIuY2xlcmsuYWNjb3VudHMuZGV2JA';
const CLERK_PUBLISHABLE_KEY = getViteEnv().VITE_CLERK_PUBLISHABLE_KEY ?? LOCAL_DEV_CLERK_PUBLISHABLE_KEY;

interface PreviousAdjustments {
  adjustments: Adjustments;
  path: string;
}

interface TransformController extends EditorTransformController {
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

function App() {
  useTooltipAccessibility();

  const { appSettings, osPlatform } = useSettingsStore(
    useShallow((state) => ({
      appSettings: state.appSettings,
      osPlatform: state.osPlatform,
    })),
  );

  const {
    isFullScreen,
    lightsOutLevel,
    isWindowFullScreen,
    isInstantTransition,
    isLayoutReady,
    editorLeftSidebarPreferences,
    leftPanelWidth,
    libraryLeftPanelWidth,
    libraryWorkspacePreferences,
    rightPanelWidth,
    compactEditorPanelHeightOverride,
    activeRightPanel,
    setUI,
    setEditorRegionSize,
    setEditorRegionVisibility,
    setEditorLeftSectionExpanded,
    setLibraryFolderTreeVisibility,
    setLibraryFolderTreeWidth,
    selectEditorPanel,
  } = useUIStore(
    useShallow((state) => ({
      isFullScreen: state.isFullScreen,
      lightsOutLevel: state.editorWorkspacePreferences.viewer.lightsOutLevel,
      isWindowFullScreen: state.isWindowFullScreen,
      isInstantTransition: state.isInstantTransition,
      isLayoutReady: state.isLayoutReady,
      editorLeftSidebarPreferences: state.editorWorkspacePreferences.leftSidebar,
      leftPanelWidth: state.leftPanelWidth,
      libraryLeftPanelWidth: state.libraryLeftPanelWidth,
      libraryWorkspacePreferences: state.libraryWorkspacePreferences,
      rightPanelWidth: state.rightPanelWidth,
      compactEditorPanelHeightOverride: state.compactEditorPanelHeightOverride,
      activeRightPanel: state.activeRightPanel,
      setUI: state.setUI,
      setEditorRegionSize: state.setEditorRegionSize,
      setEditorRegionVisibility: state.setEditorRegionVisibility,
      setEditorLeftSectionExpanded: state.setEditorLeftSectionExpanded,
      setLibraryFolderTreeVisibility: state.setLibraryFolderTreeVisibility,
      setLibraryFolderTreeWidth: state.setLibraryFolderTreeWidth,
      selectEditorPanel: state.selectEditorPanel,
    })),
  );

  const { rootPaths, currentFolderPath } = useLibraryStore(
    useShallow((state) => ({
      rootPaths: state.rootPaths,
      currentFolderPath: state.currentFolderPath,
    })),
  );

  const { selectedImage, hasRenderedFirstFrame, setEditor } = useEditorStore(
    useShallow((state) => ({
      selectedImage: state.selectedImage,
      hasRenderedFirstFrame: state.hasRenderedFirstFrame,
      setEditor: state.setEditor,
    })),
  );

  const defaultThumbnailSize = osPlatform === 'android' ? ThumbnailSize.Small : ThumbnailSize.Medium;
  const defaultLibraryViewMode = osPlatform === 'android' ? LibraryViewMode.Recursive : LibraryViewMode.Flat;

  const prevAdjustmentsRef = useRef<PreviousAdjustments | null>(null);

  const viewportSize = useEditorWorkspaceViewportSubscription();

  const isBackendReadyRef = useRef(true);
  const previewJobIdRef = useRef<number>(0);
  const latestRenderedJobIdRef = useRef<number>(0);
  const currentResRef = useRef<number>(1280);

  const [libraryViewMode, setLibraryViewMode] = useState<LibraryViewMode>(defaultLibraryViewMode);
  const [isResizing, setIsResizing] = useState(false);
  const [thumbnailSize, setThumbnailSize] = useState(defaultThumbnailSize);
  const [thumbnailAspectRatio, setThumbnailAspectRatio] = useState(ThumbnailAspectRatio.Cover);

  const { requestThumbnails, updateThumbnailViewport, clearThumbnailQueue, invalidateThumbnails, markGenerated } =
    useThumbnails();

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
  const isCompactPortrait = viewportSize.isCompactPortrait;

  const compactEditorPanelMinHeight = 220;
  const compactEditorPreviewSafeHeight = 300;
  const compactEditorPanelMaxHeight =
    viewportSize.height > 0
      ? Math.max(
          compactEditorPanelMinHeight,
          Math.min(Math.round(viewportSize.height - compactEditorPreviewSafeHeight), 850),
        )
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
      setEditorRegionSize('leftSidebar', width);
    },
    [setEditorRegionSize],
  );
  const handleLibraryLeftPanelWidthChange = useCallback(
    (width: number) => {
      setLibraryFolderTreeWidth(width);
    },
    [setLibraryFolderTreeWidth],
  );
  const handleRightPanelWidthChange = useCallback(
    (width: number) => {
      setEditorRegionSize('rightInspector', width);
    },
    [setEditorRegionSize],
  );
  const handleBottomPanelHeightChange = useCallback(
    (height: number) => {
      setEditorRegionSize('filmstrip', height);
    },
    [setEditorRegionSize],
  );
  const handleCompactEditorPanelHeightOverrideChange = useCallback(
    (height: number) => {
      setEditorRegionSize('compactTools', height);
    },
    [setEditorRegionSize],
  );
  const createResizeHandler = usePanelResize({
    compactEditorPanelMaxHeight,
    compactEditorPanelMinHeight,
    onBottomPanelHeightChange: handleBottomPanelHeightChange,
    onCompactEditorPanelHeightOverrideChange: handleCompactEditorPanelHeightOverrideChange,
    onLeftPanelWidthChange: handleLeftPanelWidthChange,
    onLibraryLeftPanelWidthChange: handleLibraryLeftPanelWidthChange,
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
    invalidateThumbnails,
    requestThumbnails,
    refs: navigationRefs,
  });
  const handleImageSelectVoid = useCallback(
    (path: string) => {
      void handleImageSelect(path);
    },
    [handleImageSelect],
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
      useProcessStore.getState().invalidateThumbnails([path]);
      globalImageCache.delete(path);
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
    (paths: string[], operationId: string) => {
      void handleStartPanorama(paths, operationId);
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
    refreshImageList: () => {
      void handleLibraryRefresh();
    },
    markGenerated,
  });

  useSelectedFolderRefreshWatcher({
    libraryViewMode,
    reconcile: async () => {
      await handleLibraryRefresh();
      await refreshAllFolderTrees();
    },
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
    const handleGlobalContextMenu = (event: MouseEvent) => {
      event.preventDefault();
    };
    window.addEventListener('contextmenu', handleGlobalContextMenu);
    return () => {
      window.removeEventListener('contextmenu', handleGlobalContextMenu);
    };
  }, []);

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
      selectEditorPanel(panelId, viewportSize);
    },
    [selectEditorPanel, viewportSize],
  );

  const enableFolderImageCounts = appSettings?.enableFolderImageCounts ?? false;
  const handleToggleFolder = useFolderExpansionLoader(enableFolderImageCounts);

  const hasRoots = rootPaths.length > 0;

  const renderLibraryFolderTree = () => {
    if (!hasRoots) return null;

    return (
      <div
        className={cx(
          'flex h-full min-h-0 overflow-hidden shrink-0',
          !isResizing && !isInstantTransition && !isFullScreen && 'transition-all duration-300 ease-in-out',
        )}
        style={{
          width: isFullScreen ? '0px' : undefined,
          opacity: isFullScreen ? 0 : 1,
        }}
      >
        <RenderIsland name="folder-tree">
          <FolderTreePanel
            isContiguousShell={false}
            isResizing={isResizing}
            isVisible={libraryWorkspacePreferences.folderTree.visible}
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
              setLibraryFolderTreeVisibility(value);
            }}
            style={{ width: libraryWorkspacePreferences.folderTree.visible ? `${libraryLeftPanelWidth}px` : '32px' }}
            isInstantTransition={isInstantTransition}
          />
        </RenderIsland>
        <Resizer
          direction={Orientation.Vertical}
          onMouseDown={createResizeHandler('libraryLeft', libraryLeftPanelWidth)}
        />
      </div>
    );
  };

  const leftSurface = getWorkspaceLeftSurface({
    hasRoots,
    hasSelectedImage: selectedImage !== null,
    isAndroid,
    isCompactPortrait,
  });
  const isWgpuActive = appSettings?.useWgpuRenderer !== false && selectedImage?.isReady && hasRenderedFirstFrame;
  const useMacWindowShell = osPlatform === 'macos' && !appSettings?.decorations && !isWindowFullScreen && !isFullScreen;

  return (
    <>
      <AppServices
        imageProcessing={{
          transformWrapperRef,
          prevAdjustmentsRef,
          previewJobIdRef,
          latestRenderedJobIdRef,
          currentResRef,
        }}
      />
      <div
        className={cx(
          'flex flex-col h-screen font-sans text-text-primary overflow-hidden select-none',
          useMacWindowShell && 'macos-window-shell',
          isWgpuActive ? 'bg-transparent' : 'bg-bg-primary',
        )}
        data-viewer-lights-out={selectedImage ? lightsOutLevel : 'off'}
      >
        <div
          className={cx(
            'shrink-0 overflow-hidden z-50',
            !isInstantTransition && 'transition-all duration-300 ease-in-out',
            isFullScreen ? 'max-h-0 opacity-0 pointer-events-none' : 'max-h-[60px] opacity-100',
          )}
          data-editor-surrounding-chrome="true"
        >
          {appSettings?.decorations || (!isWindowFullScreen && <TitleBar />)}
        </div>
        <div
          className={cx(
            'flex-1 flex flex-col min-h-0',
            isLayoutReady && hasRoots && !isInstantTransition && 'transition-all duration-300 ease-in-out',
            [hasRoots && !selectedImage && (isFullScreen ? 'p-0 gap-0' : 'p-2 gap-2')],
          )}
        >
          <div
            className={cx(
              'grow h-full min-h-0',
              selectedImage && !isCompactPortrait
                ? 'editor-shell grid grid-cols-[auto_minmax(0,1fr)] bg-editor-matte'
                : 'flex flex-row',
            )}
            data-editor-resizing={selectedImage && !isCompactPortrait ? String(isResizing) : undefined}
            data-editor-shell={selectedImage && !isCompactPortrait ? 'desktop' : undefined}
          >
            {leftSurface === 'editor' ? (
              <EditorLeftSidebar
                expandedSections={editorLeftSidebarPreferences.expandedSections}
                isFullScreen={isFullScreen}
                isResizing={isResizing}
                isVisible={editorLeftSidebarPreferences.visible}
                onResizeStart={createResizeHandler('left', leftPanelWidth)}
                onSectionExpandedChange={(sectionId: EditorLeftSectionId, expanded: boolean) => {
                  setEditorLeftSectionExpanded(sectionId, expanded);
                }}
                onVisibleChange={(visible: boolean) => {
                  setEditorRegionVisibility('leftSidebar', visible);
                }}
                slots={{
                  focusSources: <FocusStackRetouchPanel packagePath={selectedImage?.path ?? ''} />,
                  history: <EditorHistorySection />,
                  navigator: (
                    <EditorNavigator onZoomChange={handleZoomChange} transformControllerRef={transformWrapperRef} />
                  ),
                  presets: (
                    <PresetsPanel
                      onNavigateToCommunity={() => {
                        handleBackToLibrary();
                        useUIStore.getState().setUI({ activeView: 'community' });
                      }}
                      placement="sidebar"
                    />
                  ),
                  snapshots: <EditorSnapshotsSection />,
                }}
                width={leftPanelWidth}
              />
            ) : leftSurface === 'library' ? (
              renderLibraryFolderTree()
            ) : null}
            <div className="flex-1 flex flex-col min-w-0">
              {selectedImage ? (
                <EditorWorkspaceRoot
                  transformWrapperRef={transformWrapperRef}
                  isResizing={isResizing}
                  isCompactPortrait={isCompactPortrait}
                  isAndroid={isAndroid}
                  isFullScreen={isFullScreen}
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
                <LibraryWorkspaceRoot
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
                  updateThumbnailViewport={updateThumbnailViewport}
                />
              )}
            </div>
            <LibraryExportPanelRoot
              isResizing={isResizing}
              onLinkedVariantImported={handleLinkedVariantImported}
              onResizeStart={createResizeHandler('right', rightPanelWidth)}
            />
          </div>
        </div>
        <AppModalHost
          handleImageSelect={handleImageSelect}
          handleSavePanorama={handleSavePanorama}
          handleStartPanorama={handleStartPanoramaVoid}
          handleSaveHdr={handleSaveHdr}
          handleStartHdr={handleStartHdr}
          requestThumbnails={requestThumbnails}
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
        <GlobalStatusSurfaces />
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
