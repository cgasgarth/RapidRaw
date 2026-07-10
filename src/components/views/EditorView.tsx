import cx from 'clsx';
import { ChevronDown, ChevronsDown, ChevronsUp, GripHorizontal } from 'lucide-react';
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
    setCompactEditorDrawerState,
    compactDrawerState,
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
      setCompactEditorDrawerState: state.setCompactEditorDrawerState,
      compactDrawerState: state.editorWorkspacePreferences.compact.drawerState,
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

  useEffect(() => {
    if (!isCompactPortrait) return;
    const inspector = inspectorRegionRef.current;
    if (!inspector) return;

    const keepFocusedControlVisible = (event: FocusEvent) => {
      if (!(event.target instanceof HTMLElement) || !inspector.contains(event.target)) return;
      const focusedControl = event.target;
      requestAnimationFrame(() => focusedControl.scrollIntoView({ block: 'nearest', inline: 'nearest' }));
    };
    inspector.addEventListener('focusin', keepFocusedControlVisible);
    return () => inspector.removeEventListener('focusin', keepFocusedControlVisible);
  }, [compactDrawerState, isCompactPortrait]);

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
  const CompactPanelIcon = compactRightPanelEntry.icon;
  const compactPanelState = compactDrawerState;
  const handleCompactPanelSelect = (panelId: Panel) => {
    if (compactPanelState === 'collapsed' && panelId === activeRightPanel) {
      setCompactEditorDrawerState('expanded');
      return;
    }
    handleRightPanelSelect(panelId);
  };
  const compactPanelHeight =
    compactPanelState === 'collapsed'
      ? compactEditorPanelCollapsedHeight
      : compactPanelState === 'peek'
        ? Math.min(compactEditorPanelHeight, 260)
        : compactEditorPanelHeight;

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
      {isCompactPortrait && !isFullScreen && (
        <div className="compact-editor-command-row shrink-0" data-editor-region="command-row">
          {editorBottomBarComponent}
        </div>
      )}
      <div
        aria-label={t('editor.accessibility.previewRegion')}
        className={cx(
          'min-w-0',
          isCompactPortrait ? 'flex flex-1 flex-col min-h-[240px]' : 'grid min-h-0 grid-rows-[minmax(0,1fr)_auto]',
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
        data-compact-editor-panel-height={isCompactPortrait ? compactPanelHeight : undefined}
        data-compact-editor-panel-collapsed-height={isCompactPortrait ? compactEditorPanelCollapsedHeight : undefined}
        data-compact-panel-state={isCompactPortrait ? compactPanelState : undefined}
        inert={isFullScreen ? true : undefined}
        ref={rightPanelShellRef}
        role="complementary"
        style={
          isCompactPortrait
            ? {
                height: isFullScreen ? '0px' : `${compactPanelHeight}px`,
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
            {activeRightPanel && !isFullScreen && (
              <Resizer
                ariaLabel="Resize tools drawer"
                className="compact-editor-drawer-resizer"
                direction={Orientation.Horizontal}
                onMouseDown={createResizeHandler('compact', compactEditorPanelHeight)}
                testId="editor-compact-panel-resizer"
              />
            )}
            <div
              className="compact-editor-drawer-header flex min-h-11 shrink-0 items-center justify-between gap-2 border-b border-editor-border px-2"
              data-active-panel-id={compactRightPanelId}
              data-panel-state={compactPanelState}
              data-testid="editor-compact-tools-header"
            >
              <div className="flex min-w-0 items-center gap-2">
                <CompactPanelIcon aria-hidden="true" className="shrink-0 text-text-secondary" size={16} />
                <span
                  className="min-w-0 truncate text-sm font-medium text-text-primary"
                  data-testid="editor-compact-tools-active-panel"
                >
                  {compactRightPanelEntry.shortLabel}
                </span>
              </div>
              <div className="flex items-center gap-1">
                <span
                  aria-hidden="true"
                  className="flex h-9 w-9 items-center justify-center text-text-tertiary"
                  data-testid="editor-compact-tools-grip"
                  data-tooltip="Drag to resize tools"
                >
                  <GripHorizontal size={18} />
                </span>
                <button
                  aria-label={compactPanelState === 'collapsed' ? 'Peek tools drawer' : 'Collapse tools drawer'}
                  className={cx(
                    'flex h-9 w-9 items-center justify-center rounded-md border border-transparent text-text-secondary transition-colors hover:border-editor-border hover:bg-editor-panel-raised hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-editor-focus-ring',
                  )}
                  data-testid="editor-compact-tools-toggle"
                  data-tooltip={compactPanelState === 'collapsed' ? 'Peek tools drawer' : 'Collapse tools drawer'}
                  onClick={() => {
                    setCompactEditorDrawerState(compactPanelState === 'collapsed' ? 'peek' : 'collapsed');
                  }}
                  type="button"
                >
                  <ChevronDown size={16} className={cx(compactPanelState === 'collapsed' && 'rotate-180')} />
                </button>
                {compactPanelState !== 'collapsed' && (
                  <button
                    aria-label={compactPanelState === 'expanded' ? 'Show tools drawer peek' : 'Expand tools drawer'}
                    className="flex h-9 w-9 items-center justify-center rounded-md text-text-secondary hover:bg-editor-panel-raised hover:text-text-primary focus-visible:ring-2 focus-visible:ring-editor-focus-ring"
                    data-testid="editor-compact-tools-expand"
                    onClick={() => {
                      setCompactEditorDrawerState(compactPanelState === 'expanded' ? 'peek' : 'expanded');
                    }}
                    type="button"
                  >
                    {compactPanelState === 'expanded' ? <ChevronsDown size={16} /> : <ChevronsUp size={16} />}
                  </button>
                )}
              </div>
            </div>
            <div className="shrink-0 border-b border-editor-border" data-editor-region="tool-tabs">
              <RightPanelSwitcher
                activePanel={activeRightPanel}
                onPanelSelect={handleCompactPanelSelect}
                isInstantTransition={isInstantTransition}
                layout="horizontal"
              />
            </div>
            {compactPanelState !== 'collapsed' && (
              <div
                className="compact-editor-inspector min-h-0 flex-1 overflow-y-auto overscroll-contain"
                data-editor-region="inspector"
                ref={inspectorRegionRef}
              >
                {editorRightPanelContent}
              </div>
            )}
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
