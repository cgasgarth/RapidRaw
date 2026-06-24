import cx from 'clsx';
import { motion, AnimatePresence, type Variants } from 'framer-motion';
import { lazy, Suspense, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useShallow } from 'zustand/react/shallow';

import { useEditorStore } from '../../store/useEditorStore';
import { useLibraryStore } from '../../store/useLibraryStore';
import { useProcessStore } from '../../store/useProcessStore';
import { useSettingsStore } from '../../store/useSettingsStore';
import { useUIStore } from '../../store/useUIStore';
import BottomBar from '../panel/BottomBar';
import Editor from '../panel/Editor';
import Controls from '../panel/right/ControlsPanel';
import CropPanel from '../panel/right/CropPanel';
import ExportPanel from '../panel/right/ExportPanel';
import MetadataPanel from '../panel/right/MetadataPanel';
import RightPanelSwitcher from '../panel/right/RightPanelSwitcher';
import { type ImageFile, Orientation, Panel, type ThumbnailAspectRatio } from '../ui/AppProperties';
import Resizer from '../ui/Resizer';

import type {
  KeyboardEvent as ReactKeyboardEvent,
  MouseEvent,
  RefObject,
  PointerEvent as ReactPointerEvent,
} from 'react';

const AIPanel = lazy(() => import('../panel/right/AIPanel.js').then((module) => ({ default: module.AIPanel })));
const MasksPanel = lazy(() =>
  import('../panel/right/MasksPanel.js').then((module) => ({ default: module.MasksPanel })),
);
const PresetsPanel = lazy(() =>
  import('../panel/right/PresetsPanel.js').then((module) => ({ default: module.PresetsPanel })),
);
const TetherPanel = lazy(() =>
  import('../panel/right/TetherPanel.js').then((module) => ({ default: module.TetherPanel })),
);

const panelVariants: Variants = {
  animate: (direction: number) => ({
    opacity: 1,
    y: 0,
    transition: { duration: direction === 0 ? 0 : 0.2, ease: 'circOut' },
  }),
  exit: (direction: number) => ({
    opacity: direction === 0 ? 1 : 0.2,
    y: direction === 0 ? 0 : direction > 0 ? -20 : 20,
    transition: { duration: direction === 0 ? 0 : 0.1, ease: 'circIn' },
  }),
  initial: (direction: number) => ({
    opacity: direction === 0 ? 1 : 0.2,
    y: direction === 0 ? 0 : direction > 0 ? 20 : -20,
  }),
};

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
  compactEditorPanelHeight: number;
  compactEditorPanelCollapsedHeight: number;
  thumbnailAspectRatio: ThumbnailAspectRatio;
  sortedImageList: ImageFile[];
  createResizeHandler: (stateKey: string, startSize: number) => (e: ReactPointerEvent<HTMLDivElement>) => void;
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

export default function EditorView({
  transformWrapperRef,
  isResizing,
  isCompactPortrait,
  isAndroid,
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
    isFullScreen,
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
    <AnimatePresence mode="wait" custom={slideDirection}>
      {activeRightPanel && (
        <motion.div
          animate="animate"
          className="h-full w-full"
          custom={slideDirection}
          exit="exit"
          initial="initial"
          key={renderedRightPanel}
          variants={panelVariants}
        >
          <Suspense fallback={<div className="h-full w-full bg-bg-secondary" aria-busy="true" />}>
            {renderedRightPanel &&
              {
                [Panel.Adjustments]: <Controls />,
                [Panel.Ai]: <AIPanel />,
                [Panel.Crop]: <CropPanel />,
                [Panel.Export]: (
                  <ExportPanel
                    exportState={exportState}
                    multiSelectedPaths={multiSelectedPaths}
                    selectedImage={selectedImage}
                    setExportState={setExportState}
                    appSettings={appSettings}
                    onSettingsChange={(settings) => {
                      void handleSettingsChange(settings);
                    }}
                    rootPaths={rootPaths}
                    onLinkedVariantImported={handleLinkedVariantImported}
                  />
                ),
                [Panel.Masks]: <MasksPanel />,
                [Panel.Metadata]: <MetadataPanel />,
                [Panel.Presets]: (
                  <PresetsPanel
                    onNavigateToCommunity={() => {
                      handleBackToLibrary();
                      setUI({ activeView: 'community' });
                    }}
                  />
                ),
                [Panel.Tether]: (
                  <TetherPanel
                    onOpenCapture={(path) => {
                      void handleTetherCaptureOpen(path);
                    }}
                  />
                ),
              }[renderedRightPanel]}
          </Suspense>
        </motion.div>
      )}
    </AnimatePresence>
  );

  return (
    <div
      aria-label={t('editor.accessibility.workspace')}
      className={cx('flex grow h-full min-h-0', isCompactPortrait ? 'flex-col gap-2' : 'flex-row')}
      role="main"
    >
      <div
        aria-label={t('editor.accessibility.previewRegion')}
        className={cx('flex-1 flex flex-col min-w-0', isCompactPortrait && 'min-h-0')}
        role="region"
      >
        {editorNode}
        {!isCompactPortrait && editorBottomBarNode}
      </div>
      <div
        aria-label={t('editor.accessibility.toolsPanel')}
        className={cx(
          'flex overflow-hidden shrink-0',
          isCompactPortrait ? 'flex-col bg-bg-secondary rounded-lg' : 'h-full bg-transparent',
          !isResizing && !isInstantTransition && 'transition-all duration-300 ease-in-out',
        )}
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
                maxWidth: isFullScreen ? '0px' : '1000px',
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
            <div className="shrink-0 border-t border-surface">
              <RightPanelSwitcher
                activePanel={activeRightPanel}
                onPanelSelect={handleRightPanelSelect}
                isInstantTransition={isInstantTransition}
                layout="horizontal"
              />
            </div>
            <div
              aria-label={t('editor.accessibility.filmstrip')}
              className="shrink-0 border-t border-surface"
              role="region"
            >
              {editorBottomBarComponent}
            </div>
          </>
        ) : (
          <>
            <Resizer direction={Orientation.Vertical} onMouseDown={createResizeHandler('right', rightPanelWidth)} />
            <div className="flex bg-bg-secondary rounded-lg h-full">
              <div
                className={cx(
                  'h-full overflow-hidden',
                  !isResizing && !isInstantTransition && 'transition-all duration-300 ease-in-out',
                )}
                style={{ width: activeRightPanel ? `${rightPanelWidth}px` : '0px' }}
              >
                <div style={{ width: `${rightPanelWidth}px` }} className="h-full">
                  {editorRightPanelContent}
                </div>
              </div>
              <div
                className={cx(
                  'h-full border-l transition-colors',
                  activeRightPanel ? 'border-surface' : 'border-transparent',
                )}
              >
                <RightPanelSwitcher
                  activePanel={activeRightPanel}
                  onPanelSelect={handleRightPanelSelect}
                  isInstantTransition={isInstantTransition}
                />
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
