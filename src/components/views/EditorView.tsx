import cx from 'clsx';
import { ChevronDown, GripVertical } from 'lucide-react';
import type { MouseEvent, KeyboardEvent as ReactKeyboardEvent, RefObject } from 'react';
import { useCallback, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useShallow } from 'zustand/react/shallow';
import type { CreateResizeHandler } from '../../hooks/viewport/usePanelResize';
import { useEditorStore } from '../../store/useEditorStore';
import { useLibraryStore } from '../../store/useLibraryStore';
import { useProcessStore } from '../../store/useProcessStore';
import { useSettingsStore } from '../../store/useSettingsStore';
import { useUIStore } from '../../store/useUIStore';
import type { EditorZoomCommand } from '../../utils/editorZoom';
import BottomBar from '../panel/BottomBar';
import Editor from '../panel/Editor';
import { EditorRightPanelHost } from '../panel/right/EditorRightPanelHost';
import RightPanelSwitcher from '../panel/right/RightPanelSwitcher';
import { DEFAULT_EDITOR_RIGHT_PANEL, getRightPanelEntry } from '../panel/right/rightPanelRegistry';
import { type ImageFile, Orientation, Panel, type ThumbnailAspectRatio } from '../ui/AppProperties';
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
  handleZoomChange: (command: EditorZoomCommand) => void;
  handleRightPanelSelect: (panelId: Panel) => void;
  requestThumbnails: (paths: string[]) => void;
  refreshImageList: () => Promise<void>;
}

const DESKTOP_RIGHT_RAIL_WIDTH = 42;

export default function EditorView({
  transformWrapperRef,
  isResizing,
  isCompactPortrait,
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
    lightsOutLevel,
    isInstantTransition,
    uiVisibility,
    bottomPanelHeight,
    rightPanelWidth,
    activeRightPanel,
    renderedRightPanel,
    slideDirection,
    setUI,
    setEditorRegionVisibility,
  } = useUIStore(
    useShallow((state) => ({
      isFullScreen: state.isFullScreen,
      lightsOutLevel: state.editorWorkspacePreferences.viewer.lightsOutLevel,
      isInstantTransition: state.isInstantTransition,
      uiVisibility: state.uiVisibility,
      bottomPanelHeight: state.bottomPanelHeight,
      rightPanelWidth: state.rightPanelWidth,
      activeRightPanel: state.activeRightPanel,
      renderedRightPanel: state.renderedRightPanel,
      slideDirection: state.slideDirection,
      setUI: state.setUI,
      setEditorRegionVisibility: state.setEditorRegionVisibility,
    })),
  );
  const isFullScreen = isFullScreenProp ?? isFullScreenFromStore;
  const previewRegionRef = useRef<HTMLDivElement | null>(null);
  const bottomBarShellRef = useRef<HTMLDivElement | null>(null);
  const rightPanelShellRef = useRef<HTMLDivElement | null>(null);
  const rightRailRef = useRef<HTMLDivElement | null>(null);
  const inspectorRegionRef = useRef<HTMLDivElement | null>(null);
  const previousActiveRightPanelRef = useRef<Panel | null>(activeRightPanel);
  const previousFullScreenRef = useRef(isFullScreen);
  const fullScreenRestoreFocusRef = useRef<HTMLElement | null>(null);
  const desktopRightShellWidth = activeRightPanel
    ? rightPanelWidth + DESKTOP_RIGHT_RAIL_WIDTH + 8
    : DESKTOP_RIGHT_RAIL_WIDTH;

  useEffect(() => {
    const wasFullScreen = previousFullScreenRef.current;
    previousFullScreenRef.current = isFullScreen;
    if (wasFullScreen === isFullScreen) return;

    if (!isFullScreen) {
      const restoreTarget = fullScreenRestoreFocusRef.current;
      fullScreenRestoreFocusRef.current = null;
      requestAnimationFrame(() => restoreTarget?.focus({ preventScroll: true }));
      return;
    }

    const activeElement = document.activeElement;
    if (!(activeElement instanceof HTMLElement)) return;
    fullScreenRestoreFocusRef.current = activeElement;

    const focusIsInsideHiddenChrome =
      bottomBarShellRef.current?.contains(activeElement) || rightPanelShellRef.current?.contains(activeElement);

    if (!focusIsInsideHiddenChrome) return;

    activeElement.blur();
    previewRegionRef.current?.focus({ preventScroll: true });
  }, [isFullScreen]);

  useEffect(() => {
    const previousActiveRightPanel = previousActiveRightPanelRef.current;
    previousActiveRightPanelRef.current = activeRightPanel;

    if (activeRightPanel !== null || previousActiveRightPanel === null) return;

    const activeElement = document.activeElement;
    if (!(activeElement instanceof HTMLElement) || !inspectorRegionRef.current?.contains(activeElement)) return;

    const panelToggle = rightRailRef.current?.querySelector<HTMLButtonElement>(
      `[data-panel-id="${previousActiveRightPanel}"]`,
    );
    panelToggle?.focus({ preventScroll: true });
  }, [activeRightPanel]);

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
      isContiguousShell={!isCompactPortrait}
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
      isContiguousShell={!isCompactPortrait}
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
      rating={imageRatings[selectedImage?.path || ''] || 0}
      selectedImage={selectedImage ?? undefined}
      setIsFilmstripVisible={(value: boolean) => {
        setEditorRegionVisibility('filmstrip', value);
      }}
      showFilmstrip={!isCompactPortrait}
      showZoomControls={false}
      thumbnailAspectRatio={thumbnailAspectRatio}
      totalImages={sortedImageList.length}
    />
  );

  const editorBottomBarNode = (
    <div
      className={cx(
        'editor-shell-track flex flex-col w-full overflow-hidden shrink-0',
        !isResizing && !isInstantTransition && !isFullScreen && 'transition-all duration-300 ease-in-out',
        isFullScreen && 'pointer-events-none',
      )}
      aria-hidden={isFullScreen}
      data-editor-region={!isCompactPortrait ? 'filmstrip' : undefined}
      data-editor-surrounding-chrome="true"
      data-testid="editor-bottom-bar-shell"
      inert={isFullScreen ? true : undefined}
      ref={bottomBarShellRef}
      style={{
        height: isFullScreen ? '0px' : undefined,
        maxHeight: isFullScreen ? '0px' : '500px',
        opacity: isFullScreen ? 0 : 1,
      }}
    >
      {!isCompactPortrait && (
        <Resizer
          className="editor-shell-resizer editor-shell-resizer-horizontal"
          direction={Orientation.Horizontal}
          onMouseDown={createResizeHandler('bottom', bottomPanelHeight)}
        />
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
  const compactRightPanelId = activeRightPanel ?? renderedRightPanel ?? DEFAULT_EDITOR_RIGHT_PANEL;
  const compactRightPanelEntry = getRightPanelEntry(compactRightPanelId);
  const isCompactRightPanelCollapsed = activeRightPanel === null;

  return (
    <div
      aria-label={t('editor.accessibility.workspace')}
      className={cx(
        'editor-workspace grow h-full min-h-0 bg-editor-matte',
        isCompactPortrait
          ? 'flex flex-col gap-2'
          : 'editor-desktop-workspace grid grid-cols-[minmax(0,1fr)_auto] overflow-hidden',
      )}
      data-editor-resizing={isCompactPortrait ? undefined : String(isResizing)}
      data-editor-shell={isCompactPortrait ? 'compact' : 'desktop'}
      data-testid="editor-workspace"
      data-viewer-lights-out={lightsOutLevel}
      role="main"
    >
      <div
        aria-label={t('editor.accessibility.previewRegion')}
        className={cx(
          'min-w-0',
          isCompactPortrait
            ? 'flex flex-1 flex-col gap-2 min-h-[240px]'
            : 'grid min-h-0 grid-rows-[minmax(0,1fr)_auto]',
        )}
        data-compact-preview-min-height={isCompactPortrait ? 240 : undefined}
        data-editor-region={!isCompactPortrait ? 'viewer' : undefined}
        ref={previewRegionRef}
        role="region"
        tabIndex={-1}
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
            : 'editor-shell-track h-full min-w-0 overflow-hidden bg-editor-panel',
          !isCompactPortrait &&
            !isResizing &&
            !isInstantTransition &&
            !isFullScreen &&
            'transition-[width] duration-300 ease-in-out',
          isCompactPortrait && !isResizing && !isInstantTransition && 'transition-all duration-300 ease-in-out',
          isFullScreen && 'pointer-events-none',
        )}
        aria-hidden={isFullScreen}
        data-testid="editor-right-panel-shell"
        data-editor-surrounding-chrome="true"
        data-active-panel-id={compactRightPanelId}
        data-compact-editor-panel-height={
          isCompactPortrait
            ? activeRightPanel
              ? compactEditorPanelHeight
              : compactEditorPanelCollapsedHeight
            : undefined
        }
        data-compact-editor-panel-collapsed-height={isCompactPortrait ? compactEditorPanelCollapsedHeight : undefined}
        data-compact-panel-state={
          isCompactPortrait ? (isCompactRightPanelCollapsed ? 'collapsed' : 'expanded') : undefined
        }
        inert={isFullScreen ? true : undefined}
        ref={rightPanelShellRef}
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
                width: isFullScreen ? '0px' : `${desktopRightShellWidth}px`,
                opacity: isFullScreen ? 0 : 1,
              }
        }
      >
        {isCompactPortrait ? (
          <>
            <div
              className="flex min-h-10 shrink-0 items-center justify-between gap-2 border-b border-editor-border px-2 py-1.5"
              data-active-panel-id={compactRightPanelId}
              data-panel-state={isCompactRightPanelCollapsed ? 'collapsed' : 'expanded'}
              data-testid="editor-compact-tools-header"
            >
              <div className="flex min-w-0 items-center gap-2">
                <span
                  className="min-w-0 truncate text-sm font-medium text-text-primary"
                  data-testid="editor-compact-tools-active-panel"
                >
                  {compactRightPanelEntry.shortLabel}
                </span>
                <span
                  className={cx(
                    'shrink-0 rounded-full border border-editor-border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-normal text-text-secondary',
                    isCompactRightPanelCollapsed && 'text-text-tertiary',
                  )}
                  data-testid="editor-compact-tools-state"
                >
                  {isCompactRightPanelCollapsed ? 'Closed' : 'Open'}
                </span>
              </div>
              <div className="flex items-center gap-1">
                <span
                  aria-hidden="true"
                  className="flex h-7 w-7 items-center justify-center rounded-md border border-transparent text-text-tertiary"
                  data-testid="editor-compact-tools-grip"
                  data-tooltip="Drag to resize tools"
                >
                  <GripVertical size={14} />
                </span>
                <button
                  aria-label={isCompactRightPanelCollapsed ? 'Open tools panel' : 'Collapse tools panel'}
                  className={cx(
                    'flex h-7 w-7 items-center justify-center rounded-md border border-transparent text-text-secondary transition-colors hover:border-editor-border hover:bg-editor-panel-raised hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-editor-focus-ring focus-visible:ring-offset-1 focus-visible:ring-offset-editor-panel',
                    isCompactRightPanelCollapsed && 'text-text-primary',
                  )}
                  data-testid="editor-compact-tools-toggle"
                  data-tooltip={isCompactRightPanelCollapsed ? 'Open tools panel' : 'Collapse tools panel'}
                  onClick={() => {
                    handleRightPanelSelect(compactRightPanelId);
                  }}
                  type="button"
                >
                  <ChevronDown
                    size={14}
                    className={cx('transition-transform', isCompactRightPanelCollapsed && 'rotate-180')}
                  />
                </button>
              </div>
            </div>
            {activeRightPanel && !isFullScreen && (
              <Resizer
                direction={Orientation.Horizontal}
                onMouseDown={createResizeHandler('compact', compactEditorPanelHeight)}
                testId="editor-compact-panel-resizer"
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
              data-compact-filmstrip-shell="true"
              data-testid="editor-compact-filmstrip-shell"
              role="region"
            >
              {editorBottomBarComponent}
            </div>
          </>
        ) : (
          <>
            {activeRightPanel && (
              <Resizer
                className="editor-shell-resizer editor-shell-resizer-vertical"
                direction={Orientation.Vertical}
                onMouseDown={createResizeHandler('right', rightPanelWidth)}
              />
            )}
            <div
              className="grid h-full min-w-0 overflow-hidden bg-editor-panel"
              style={{
                gridTemplateColumns: `${DESKTOP_RIGHT_RAIL_WIDTH}px minmax(0, ${activeRightPanel ? rightPanelWidth : 0}px)`,
              }}
            >
              <div
                className={cx('h-full border-r border-editor-divider', !activeRightPanel && 'border-r-0')}
                data-editor-region="tool-rail"
                ref={rightRailRef}
              >
                <RightPanelSwitcher
                  activePanel={activeRightPanel}
                  hiddenPanels={[Panel.Presets]}
                  onPanelSelect={handleRightPanelSelect}
                  isInstantTransition={isInstantTransition}
                />
              </div>
              <div className="h-full min-w-0 overflow-hidden" data-editor-region="inspector" ref={inspectorRegionRef}>
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
