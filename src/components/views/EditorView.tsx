import cx from 'clsx';
import type { MouseEvent, KeyboardEvent as ReactKeyboardEvent, RefObject } from 'react';
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useShallow } from 'zustand/react/shallow';
import type { CreateResizeHandler } from '../../hooks/viewport/usePanelResize';
import { useEditorStore } from '../../store/useEditorStore';
import { useLibraryStore } from '../../store/useLibraryStore';
import { useProcessStore } from '../../store/useProcessStore';
import { useSettingsStore } from '../../store/useSettingsStore';
import { useUIStore } from '../../store/useUIStore';
import BottomBar from '../panel/BottomBar';
import Editor from '../panel/Editor';
import { EditorRightPanelHost } from '../panel/right/EditorRightPanelHost';
import RightPanelSwitcher from '../panel/right/RightPanelSwitcher';
import { type ImageFile, Orientation, type Panel, type ThumbnailAspectRatio } from '../ui/AppProperties';
import Resizer from '../ui/Resizer';

interface TransformController {
  resetTransform(time?: number): void;
  setTransform(x: number, y: number, scale: number, time?: number): void;
  zoomIn(factor: number, time?: number): void;
  zoomOut(factor: number, time?: number): void;
}

interface EditorViewProps {
  transformWrapperRef: RefObject<TransformController | null>;
  isResizing: boolean;
  isCompactPortrait: boolean;
  isAndroid: boolean;
  isFullScreen?: boolean;
  compactEditorPanelHeight: number;
  compactEditorPanelCollapsedHeight: number;
  thumbnailAspectRatio: ThumbnailAspectRatio;
  sortedImageList: ImageFile[];
  createResizeHandler: CreateResizeHandler;
  handleBackToLibrary: () => void;
  handleEditorContextMenu: (event: MouseEvent<HTMLElement>) => void;
  handleThumbnailContextMenu: (event: MouseEvent<HTMLElement>, path: string) => void;
  handleImageClick: (path: string, event: MouseEvent<HTMLElement> | ReactKeyboardEvent<HTMLElement>) => void;
  handleImageSelect: (path: string) => void;
  handleClearSelection: () => void;
  handleCopyAdjustments: () => void;
  handlePasteAdjustments: () => void;
  handleRate: (rate: number, paths?: string[]) => void;
  handleZoomChange: (zoom: number) => void;
  handleRightPanelSelect: (panelId: Panel) => void;
  requestThumbnails: (paths: string[]) => void;
  refreshImageList: () => Promise<void>;
}

const DESKTOP_RIGHT_RAIL_WIDTH = 42;

export default function EditorView({
  transformWrapperRef,
  isResizing,
  isCompactPortrait,
  isAndroid,
  isFullScreen: isFullScreenProp,
  compactEditorPanelHeight,
  compactEditorPanelCollapsedHeight,
  thumbnailAspectRatio,
  sortedImageList,
  createResizeHandler,
  handleBackToLibrary,
  handleEditorContextMenu,
  handleThumbnailContextMenu,
  handleImageClick,
  handleImageSelect,
  handleClearSelection,
  handleCopyAdjustments,
  handlePasteAdjustments,
  handleRate,
  handleZoomChange,
  handleRightPanelSelect,
  requestThumbnails,
  refreshImageList,
}: EditorViewProps) {
  const { t } = useTranslation();
  const { selectedImage } = useEditorStore(
    useShallow((state) => ({
      selectedImage: state.selectedImage,
    })),
  );

  const {
    isFullScreen: isFullScreenFromStore,
    isInstantTransition,
    uiVisibility,
    bottomPanelHeight,
    rightPanelWidth,
    activeRightPanel,
    renderedRightPanel,
    slideDirection,
    setUI,
  } = useUIStore(
    useShallow((state) => ({
      isFullScreen: state.isFullScreen,
      isInstantTransition: state.isInstantTransition,
      uiVisibility: state.uiVisibility,
      bottomPanelHeight: state.bottomPanelHeight,
      rightPanelWidth: state.rightPanelWidth,
      activeRightPanel: state.activeRightPanel,
      renderedRightPanel: state.renderedRightPanel,
      slideDirection: state.slideDirection,
      setUI: state.setUI,
    })),
  );
  const isFullScreen = isFullScreenProp ?? isFullScreenFromStore;
  const desktopRightShellWidth = activeRightPanel
    ? rightPanelWidth + DESKTOP_RIGHT_RAIL_WIDTH
    : DESKTOP_RIGHT_RAIL_WIDTH;

  const { multiSelectedPaths, imageRatings, isViewLoading, rootPaths } = useLibraryStore(
    useShallow((state) => ({
      multiSelectedPaths: state.multiSelectedPaths,
      imageRatings: state.imageRatings,
      isViewLoading: state.isViewLoading,
      rootPaths: state.rootPaths,
    })),
  );

  const { exportState, isCopied, isPasted, setExportState } = useProcessStore(
    useShallow((state) => ({
      exportState: state.exportState,
      isCopied: state.isCopied,
      isPasted: state.isPasted,
      setExportState: state.setExportState,
    })),
  );

  const handleLinkedVariantImported = useCallback(
    async (path: string) => {
      useProcessStore.getState().invalidateThumbnails([path]);
      await refreshImageList();
      const { imageList, setLibrary } = useLibraryStore.getState();
      if (!imageList.some((image) => image.path === path)) return;
      setLibrary({ libraryActivePath: path, multiSelectedPaths: [path], selectionAnchorPath: path });
      requestThumbnails([path]);
    },
    [refreshImageList, requestThumbnails],
  );

  const handleTetherCaptureOpen = useCallback(
    async (path: string) => {
      await refreshImageList();
      requestThumbnails([path]);
      handleImageSelect(path);
    },
    [handleImageSelect, refreshImageList, requestThumbnails],
  );

  const { appSettings, handleSettingsChange } = useSettingsStore(
    useShallow((state) => ({
      appSettings: state.appSettings,
      handleSettingsChange: state.handleSettingsChange,
    })),
  );

  const editorNode = (
    <Editor
      onBackToLibrary={handleBackToLibrary}
      onContextMenu={handleEditorContextMenu}
      transformWrapperRef={transformWrapperRef}
    />
  );

  const editorBottomBarComponent = (
    <BottomBar
      filmstripHeight={bottomPanelHeight}
      imageList={sortedImageList}
      imageRatings={imageRatings}
      isCopied={isCopied}
      isCopyDisabled={!selectedImage}
      isFilmstripVisible={uiVisibility.filmstrip}
      isLoading={isViewLoading}
      isPasted={isPasted}
      isPasteDisabled={useEditorStore.getState().copiedAdjustments === null}
      isRatingDisabled={!selectedImage}
      isResizing={isResizing}
      multiSelectedPaths={multiSelectedPaths}
      onClearSelection={handleClearSelection}
      onContextMenu={handleThumbnailContextMenu}
      onCopy={handleCopyAdjustments}
      onOpenCopyPasteSettings={() => {
        setUI({ isCopyPasteSettingsModalOpen: true });
      }}
      onImageSelect={handleImageClick}
      onPaste={() => {
        handlePasteAdjustments();
      }}
      onRate={handleRate}
      onRequestThumbnails={requestThumbnails}
      onZoomChange={handleZoomChange}
      rating={imageRatings[selectedImage?.path || ''] || 0}
      selectedImage={selectedImage ?? undefined}
      setIsFilmstripVisible={(value: boolean) => {
        setUI((state) => ({ uiVisibility: { ...state.uiVisibility, filmstrip: value } }));
      }}
      showFilmstrip={!isCompactPortrait}
      showZoomControls={!isAndroid}
      thumbnailAspectRatio={thumbnailAspectRatio}
      totalImages={sortedImageList.length}
    />
  );

  const editorBottomBarNode = (
    <div
      className={cx(
        'flex flex-col w-full overflow-hidden shrink-0',
        !isResizing && !isInstantTransition && 'transition-all duration-300 ease-in-out',
      )}
      aria-hidden={isFullScreen}
      data-testid="editor-bottom-bar-shell"
      style={{
        maxHeight: isFullScreen ? '0px' : '500px',
        opacity: isFullScreen ? 0 : 1,
      }}
    >
      {!isCompactPortrait && (
        <Resizer direction={Orientation.Horizontal} onMouseDown={createResizeHandler('bottom', bottomPanelHeight)} />
      )}
      {editorBottomBarComponent}
    </div>
  );

  const editorRightPanelContent = (
    <EditorRightPanelHost
      activeRightPanel={activeRightPanel}
      appSettings={appSettings}
      exportState={exportState}
      handleSettingsChange={handleSettingsChange}
      multiSelectedPaths={multiSelectedPaths}
      onLinkedVariantImported={handleLinkedVariantImported}
      onNavigateToCommunity={() => {
        handleBackToLibrary();
        setUI({ activeView: 'community' });
      }}
      onOpenTetherCapture={(path) => {
        void handleTetherCaptureOpen(path);
      }}
      renderedRightPanel={renderedRightPanel}
      rootPaths={rootPaths}
      selectedImage={selectedImage}
      setExportState={setExportState}
      slideDirection={slideDirection}
    />
  );

  return (
    <div
      aria-label={t('editor.accessibility.workspace')}
      className={cx(
        'flex grow h-full min-h-0 bg-editor-matte',
        isCompactPortrait ? 'flex-col gap-2' : 'flex-row gap-2',
      )}
      role="main"
    >
      <div
        aria-label={t('editor.accessibility.previewRegion')}
        className={cx('flex-1 flex flex-col min-w-0 gap-2', isCompactPortrait && 'min-h-[240px]')}
        role="region"
      >
        {editorNode}
        {!isCompactPortrait && editorBottomBarNode}
      </div>
      <div
        aria-label={t('editor.accessibility.toolsPanel')}
        className={cx(
          'flex overflow-hidden shrink-0',
          isCompactPortrait
            ? 'flex-col rounded-lg border border-editor-border bg-editor-panel'
            : 'h-full min-w-0 bg-transparent',
          !isResizing && !isInstantTransition && 'transition-all duration-300 ease-in-out',
        )}
        aria-hidden={isFullScreen}
        data-testid="editor-right-panel-shell"
        role="complementary"
        style={
          isCompactPortrait
            ? {
                height: isFullScreen
                  ? '0px'
                  : `${activeRightPanel ? compactEditorPanelHeight : compactEditorPanelCollapsedHeight}px`,
                opacity: isFullScreen ? 0 : 1,
              }
            : {
                width: isFullScreen ? '0px' : `${desktopRightShellWidth + 8}px`,
                opacity: isFullScreen ? 0 : 1,
              }
        }
      >
        {isCompactPortrait ? (
          <>
            {activeRightPanel && !isFullScreen && (
              <Resizer
                direction={Orientation.Horizontal}
                onMouseDown={createResizeHandler('compact', compactEditorPanelHeight)}
              />
            )}
            <div className="min-h-0 flex-1 overflow-hidden">{editorRightPanelContent}</div>
            <div className="shrink-0 border-t border-editor-border">
              <RightPanelSwitcher
                activePanel={activeRightPanel}
                onPanelSelect={handleRightPanelSelect}
                isInstantTransition={isInstantTransition}
                layout="horizontal"
              />
            </div>
            <div
              aria-label={t('editor.accessibility.filmstrip')}
              className="shrink-0 border-t border-editor-border"
              role="region"
            >
              {editorBottomBarComponent}
            </div>
          </>
        ) : (
          <>
            <Resizer direction={Orientation.Vertical} onMouseDown={createResizeHandler('right', rightPanelWidth)} />
            <div
              className="grid h-full min-w-0 overflow-hidden rounded-lg border border-editor-border bg-editor-panel"
              style={{ gridTemplateColumns: `${DESKTOP_RIGHT_RAIL_WIDTH}px minmax(0, 1fr)` }}
            >
              <div
                className={cx(
                  'h-full border-r transition-colors',
                  activeRightPanel ? 'border-editor-border' : 'border-transparent',
                )}
              >
                <RightPanelSwitcher
                  activePanel={activeRightPanel}
                  onPanelSelect={handleRightPanelSelect}
                  isInstantTransition={isInstantTransition}
                />
              </div>
              <div
                className={cx(
                  'h-full min-w-0 overflow-hidden',
                  !isResizing && !isInstantTransition && 'transition-all duration-300 ease-in-out',
                )}
                style={{ width: activeRightPanel ? `${rightPanelWidth}px` : '0px' }}
              >
                <div style={{ width: `${rightPanelWidth}px` }} className="h-full min-w-0">
                  {editorRightPanelContent}
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
