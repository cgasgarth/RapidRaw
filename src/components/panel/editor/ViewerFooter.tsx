import cx from 'clsx';
import {
  Check,
  ChevronDown,
  Columns2,
  Eye,
  EyeOff,
  FlipHorizontal2,
  FlipVertical2,
  Loader2,
  Minus,
  MoreHorizontal,
  Plus,
  RotateCcw,
  RotateCw,
  ScanSearch,
  SplitSquareHorizontal,
  TriangleAlert,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useShallow } from 'zustand/react/shallow';
import { useEditorStore } from '../../../store/useEditorStore';
import { useLibraryStore } from '../../../store/useLibraryStore';
import {
  getEditorChromeStatusChips,
  getEditorChromeStatusStripChips,
} from '../../../utils/color/runtime/gamutWarningDisplay';
import { selectEditDocumentNode } from '../../../utils/editDocumentSelectors';
import {
  type EditorZoomCommand,
  type EditorZoomResolutionState,
  formatEditorZoomLabel,
  getEditorZoomModeForCommand,
  type ResolvedEditorZoom,
} from '../../../utils/editorZoom';
import { editorChromeStatusChipClassName, editorChromeTokens } from '../../ui/editorChromeTokens';
import { ViewerSamplerHud, type ViewerSamplerState } from './ViewerSamplerHud';
import {
  resolveViewerFooterCompareLabel,
  resolveViewerFooterRenderStatus,
  resolveViewerFooterResponsiveModel,
  resolveViewerFooterSelection,
  resolveViewerFooterToolHint,
  type ViewerFooterRenderStatus,
} from './viewerFooterModel';
import type { ViewerActiveTool } from './viewerInputResolver';

interface ViewerFooterProps {
  activeTool: ViewerActiveTool;
  isFullScreen: boolean;
  isRendering: boolean;
  resolvedZoom: ResolvedEditorZoom;
  samplerState: ViewerSamplerState | null;
  zoomResolutionState: EditorZoomResolutionState;
  onFlip?: (axis: 'horizontal' | 'vertical') => void;
  onRotate?: (degrees: number) => void;
}

const filenameFromPath = (path: string): string => path.split(/[\\/]/u).pop() || path;

const useCoalescedStatus = (next: ViewerFooterRenderStatus): ViewerFooterRenderStatus => {
  const [status, setStatus] = useState(next);

  useEffect(() => {
    if (next.phase !== 'coherent') {
      setStatus(next);
      return;
    }
    const timeout = window.setTimeout(() => setStatus(next), 180);
    return () => window.clearTimeout(timeout);
  }, [next]);

  return status;
};

export default function ViewerFooter({
  activeTool,
  isFullScreen,
  isRendering,
  resolvedZoom,
  samplerState,
  zoomResolutionState,
  onFlip,
  onRotate,
}: ViewerFooterProps) {
  const { t } = useTranslation();
  const footerRef = useRef<HTMLDivElement>(null);
  const [footerWidth, setFooterWidth] = useState(Number.POSITIVE_INFINITY);
  const { imageList, multiSelectedPaths } = useLibraryStore(
    useShallow((state) => ({ imageList: state.imageList, multiSelectedPaths: state.multiSelectedPaths })),
  );
  const editor = useEditorStore(
    useShallow((state) => ({
      levels: selectEditDocumentNode(state.editDocumentV2, 'luma_levels').params['levels'],
      compare: state.compare,
      exportSoftProofRecipeId: state.exportSoftProofRecipeId,
      exportSoftProofTransform: state.exportSoftProofTransform,
      gamutWarningOverlay: state.gamutWarningOverlay,
      isGamutWarningOverlayVisible: state.isGamutWarningOverlayVisible,
      isExportSoftProofEnabled: state.isExportSoftProofEnabled,
      previewQualityStatus: state.previewQualityStatus,
      previewScopeStatus: state.previewScopeStatus,
      selectedImage: state.selectedImage,
      referenceMatchReferences: state.referenceMatchReferences,
    })),
  );

  useEffect(() => {
    const element = footerRef.current;
    if (!element) return;
    const update = () => setFooterWidth(element.getBoundingClientRect().width);
    update();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const immediateStatus = useMemo(
    () =>
      resolveViewerFooterRenderStatus({
        isRendering,
        qualityStatus: editor.previewQualityStatus,
        zoomResolutionState,
      }),
    [editor.previewQualityStatus, isRendering, zoomResolutionState],
  );
  const renderStatus = useCoalescedStatus(immediateStatus);
  const toolHint = resolveViewerFooterToolHint(activeTool);
  const compareLabel = resolveViewerFooterCompareLabel(editor.compare.mode);
  const diagnostics = useMemo(
    () =>
      getEditorChromeStatusStripChips(
        getEditorChromeStatusChips({
          adjustments: { levels: editor.levels },
          gamutWarningOverlay: editor.gamutWarningOverlay,
          previewScopeStatus: editor.previewScopeStatus,
          proofContext: {
            exportSoftProofRecipeId: editor.exportSoftProofRecipeId,
            exportSoftProofTransform: editor.exportSoftProofTransform,
            isExportSoftProofEnabled: editor.isExportSoftProofEnabled,
            selectedImagePath: editor.selectedImage?.path ?? null,
          },
        }),
      ),
    [editor],
  );
  const selectedIndex = editor.selectedImage
    ? imageList.findIndex((image) => image.path === editor.selectedImage?.path)
    : -1;
  const selection = resolveViewerFooterSelection({
    filename: editor.selectedImage ? filenameFromPath(editor.selectedImage.path) : null,
    height: editor.selectedImage?.height ?? 0,
    index: selectedIndex,
    selectedCount: Math.max(multiSelectedPaths.length, editor.selectedImage ? 1 : 0),
    total: imageList.length,
    width: editor.selectedImage?.width ?? 0,
  });
  const responsive = resolveViewerFooterResponsiveModel({
    compareActive: compareLabel !== null,
    diagnosticsActive: diagnostics.length > 0,
    samplerActive: samplerState !== null,
    width: footerWidth,
  });
  const executeZoom = (command: EditorZoomCommand) => {
    useEditorStore.getState().setEditor({ zoomMode: getEditorZoomModeForCommand(command, resolvedZoom) });
  };
  const reference = editor.referenceMatchReferences[0] ?? null;
  const referenceActive = editor.compare.source.kind === 'reference';
  const softProofActive = editor.isExportSoftProofEnabled;
  const gamutWarningActive = editor.isGamutWarningOverlayVisible;
  const iconButton = cx(
    editorChromeTokens.button.base,
    editorChromeTokens.button.iconCompact,
    editorChromeTokens.button.quiet,
    editorChromeTokens.focusRing,
  );
  const buttonClassName = cx(iconButton, 'h-7 w-7');
  const toggleReference = () => {
    if (referenceActive) {
      useEditorStore.getState().dispatchCompare({ identity: null, type: 'set-original-source' });
      useEditorStore.getState().dispatchCompare({ mode: 'off', type: 'set-mode' });
      return;
    }
    if (reference === null) return;
    useEditorStore
      .getState()
      .dispatchCompare({ identity: reference.id, label: reference.label, type: 'set-reference-source' });
    useEditorStore.getState().dispatchCompare({ mode: 'side-by-side', type: 'set-mode' });
  };
  const toggleSoftProof = () => {
    const state = useEditorStore.getState();
    state.setEditor({ isExportSoftProofEnabled: !softProofActive });
  };
  const toggleGamutWarning = () => {
    const state = useEditorStore.getState();
    if (!softProofActive || editor.gamutWarningOverlay === null) return;
    state.setEditor({ isGamutWarningOverlayVisible: !gamutWarningActive });
  };
  const zoomLabel = formatEditorZoomLabel(resolvedZoom, {
    fill: t('editor.viewerFooter.zoom.fill'),
    fit: t('editor.viewerFooter.zoom.fit'),
  });
  const toolbarLabels = {
    beforeAfter: t('editor.viewerFooter.toolbar.beforeAfter'),
    flipHorizontal: t('editor.viewerFooter.toolbar.flipHorizontal'),
    flipVertical: t('editor.viewerFooter.toolbar.flipVertical'),
    gamutWarning: t('editor.viewerFooter.toolbar.gamutWarning'),
    loupe: t('editor.viewerFooter.toolbar.loupe'),
    noReference: t('editor.viewerFooter.toolbar.noReference'),
    original: t('editor.viewerFooter.toolbar.original'),
    reference: t('editor.viewerFooter.toolbar.reference'),
    rotateLeft: t('editor.viewerFooter.toolbar.rotateLeft'),
    rotateRight: t('editor.viewerFooter.toolbar.rotateRight'),
    softProof: t('editor.viewerFooter.toolbar.softProof'),
  };
  const statusIcon =
    renderStatus.phase === 'error' || renderStatus.phase === 'degraded' ? (
      <TriangleAlert aria-hidden="true" size={13} />
    ) : renderStatus.busy ? (
      <Loader2 aria-hidden="true" className="animate-spin motion-reduce:animate-none" size={13} />
    ) : (
      <Check aria-hidden="true" size={13} />
    );

  return (
    <div
      aria-label={t('editor.viewerFooter.accessibilityLabel')}
      className={cx(
        editorChromeTokens.region.viewerStatusFooter,
        'z-[130] grid min-h-9 w-full grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2 overflow-visible border-t border-editor-divider bg-editor-panel px-2 py-0.5 text-[11px]',
        isFullScreen &&
          'absolute inset-x-0 bottom-0 border-editor-overlay-stroke bg-editor-overlay-surface/95 opacity-35 shadow-[0_-10px_28px_var(--editor-overlay-shadow)] transition-opacity hover:opacity-100 focus-within:opacity-100',
      )}
      data-density={responsive.density}
      data-editor-chrome="viewer-footer"
      data-fullscreen={String(isFullScreen)}
      data-testid="viewer-footer"
      ref={footerRef}
      role="region"
    >
      <div className="flex min-w-0 items-center gap-1 overflow-hidden" data-testid="viewer-footer-left">
        <span className="shrink-0 font-medium tabular-nums text-text-primary">{selection.primary}</span>
        {responsive.showFilename && selection.filename && (
          <span className="min-w-0 truncate text-text-secondary" title={selection.filename}>
            {selection.filename}
          </span>
        )}
        {responsive.showDimensions && selection.dimensions && (
          <span className="shrink-0 tabular-nums text-text-tertiary">{selection.dimensions}</span>
        )}
        {toolHint && (
          <span className="min-w-0 truncate text-editor-info" data-testid="viewer-footer-tool-hint">
            {toolHint.label} {toolHint.cancelHint ? `(${toolHint.cancelHint})` : ''}
          </span>
        )}
      </div>

      <div className="flex min-w-0 items-center justify-center gap-0.5" data-testid="viewer-footer-center">
        <button
          aria-label={toolbarLabels.loupe}
          className={cx(buttonClassName, editor.compare.mode === 'off' && 'text-text-primary')}
          data-testid="viewer-toolbar-loupe"
          onClick={() => executeZoom({ kind: 'fit' })}
          title={toolbarLabels.loupe}
          type="button"
        >
          <ScanSearch aria-hidden="true" size={14} />
        </button>
        <button
          aria-label={toolbarLabels.beforeAfter}
          aria-pressed={editor.compare.mode !== 'off'}
          className={buttonClassName}
          data-testid="viewer-toolbar-before-after"
          onClick={() => useEditorStore.getState().dispatchCompare({ type: 'toggle-original' })}
          title={toolbarLabels.beforeAfter}
          type="button"
        >
          <Columns2 aria-hidden="true" size={14} />
        </button>
        <button
          aria-label={toolbarLabels.reference}
          aria-pressed={referenceActive}
          className={cx(buttonClassName, referenceActive && editorChromeTokens.button.selectedQuiet)}
          data-testid="viewer-toolbar-reference"
          disabled={reference === null}
          onClick={toggleReference}
          title={reference === null ? toolbarLabels.noReference : toolbarLabels.reference}
          type="button"
        >
          <SplitSquareHorizontal aria-hidden="true" size={14} />
        </button>
        <button
          aria-label={toolbarLabels.original}
          aria-pressed={editor.compare.isOriginalHeld || editor.compare.mode === 'hold-original'}
          className={buttonClassName}
          data-testid="viewer-toolbar-original"
          onClick={() => useEditorStore.getState().dispatchCompare({ type: 'toggle-original' })}
          title={toolbarLabels.original}
          type="button"
        >
          {editor.compare.isOriginalHeld ? (
            <EyeOff aria-hidden="true" size={14} />
          ) : (
            <Eye aria-hidden="true" size={14} />
          )}
        </button>
        <span className="mx-1 h-4 w-px bg-editor-border" />
        <button
          aria-label={toolbarLabels.rotateLeft}
          className={buttonClassName}
          data-testid="viewer-toolbar-rotate-left"
          disabled={onRotate === undefined}
          onClick={() => onRotate?.(-90)}
          title={toolbarLabels.rotateLeft}
          type="button"
        >
          <RotateCcw aria-hidden="true" size={14} />
        </button>
        <button
          aria-label={toolbarLabels.rotateRight}
          className={buttonClassName}
          data-testid="viewer-toolbar-rotate-right"
          disabled={onRotate === undefined}
          onClick={() => onRotate?.(90)}
          title={toolbarLabels.rotateRight}
          type="button"
        >
          <RotateCw aria-hidden="true" size={14} />
        </button>
        <button
          aria-label={toolbarLabels.flipHorizontal}
          className={buttonClassName}
          data-testid="viewer-toolbar-flip-horizontal"
          disabled={onFlip === undefined}
          onClick={() => onFlip?.('horizontal')}
          title={toolbarLabels.flipHorizontal}
          type="button"
        >
          <FlipHorizontal2 aria-hidden="true" size={14} />
        </button>
        <button
          aria-label={toolbarLabels.flipVertical}
          className={buttonClassName}
          data-testid="viewer-toolbar-flip-vertical"
          disabled={onFlip === undefined}
          onClick={() => onFlip?.('vertical')}
          title={toolbarLabels.flipVertical}
          type="button"
        >
          <FlipVertical2 aria-hidden="true" size={14} />
        </button>
        <span className="mx-1 h-4 w-px bg-editor-border" />
        <button
          aria-label={toolbarLabels.softProof}
          aria-pressed={softProofActive}
          className={cx(buttonClassName, softProofActive && editorChromeTokens.button.selectedQuiet)}
          data-testid="viewer-toolbar-soft-proof"
          onClick={toggleSoftProof}
          title={toolbarLabels.softProof}
          type="button"
        >
          {toolbarLabels.softProof.slice(0, 2)}
        </button>
        <button
          aria-label={toolbarLabels.gamutWarning}
          aria-pressed={gamutWarningActive}
          className={cx(buttonClassName, gamutWarningActive && editorChromeTokens.button.selectedQuiet)}
          data-testid="viewer-toolbar-gamut-warning"
          disabled={!softProofActive || editor.gamutWarningOverlay === null}
          onClick={toggleGamutWarning}
          title={toolbarLabels.gamutWarning}
          type="button"
        >
          {toolbarLabels.gamutWarning.slice(0, 1)}
        </button>
        <span
          aria-busy={renderStatus.busy}
          className={cx(
            editorChromeStatusChipClassName(renderStatus.tone),
            'min-w-28 justify-center whitespace-nowrap',
          )}
          data-phase={renderStatus.phase}
          data-testid="viewer-footer-render-status"
        >
          {statusIcon}
          {renderStatus.label}
        </span>
        <span
          aria-atomic="true"
          aria-live={renderStatus.announce === 'off' ? undefined : renderStatus.announce}
          className="sr-only"
          data-testid="viewer-footer-live-region"
          role={renderStatus.announce === 'assertive' ? 'alert' : 'status'}
        >
          {renderStatus.announce === 'off' ? '' : renderStatus.label}
        </span>
        {responsive.showCompare && compareLabel && (
          <span className="whitespace-nowrap text-text-secondary" data-testid="viewer-footer-compare">
            {compareLabel}
          </span>
        )}
      </div>

      <div className="flex min-w-0 items-center justify-end gap-1" data-testid="viewer-footer-right">
        {responsive.showSampler && samplerState && <ViewerSamplerHud {...samplerState} placement="footer" />}
        {responsive.showDiagnostics && (
          <div className="flex min-w-0 items-center gap-1" data-testid="viewer-footer-diagnostics">
            {diagnostics.slice(0, 2).map((diagnostic) => (
              <span
                className={cx(editorChromeStatusChipClassName(diagnostic.tone), 'max-w-28 truncate')}
                key={diagnostic.id}
                title={`${diagnostic.label}: ${diagnostic.value}. ${diagnostic.detail}`}
              >
                {diagnostic.label} {diagnostic.value}
              </span>
            ))}
          </div>
        )}
        {responsive.overflow.length > 0 && (
          <details className="group relative shrink-0" data-testid="viewer-footer-overflow">
            <summary
              aria-label={t('editor.viewerFooter.moreStatus')}
              className={cx(iconButton, 'list-none')}
              title={t('editor.viewerFooter.moreStatus')}
            >
              <MoreHorizontal aria-hidden="true" size={15} />
            </summary>
            <div className="absolute bottom-8 right-0 z-[160] w-64 space-y-1 rounded border border-editor-divider bg-editor-panel-raised p-2 text-text-secondary shadow-[0_14px_34px_var(--editor-overlay-shadow)]">
              {selection.filename && <div className="truncate text-text-primary">{selection.filename}</div>}
              {selection.dimensions && <div className="tabular-nums">{selection.dimensions}</div>}
              {compareLabel && <div>{compareLabel}</div>}
              {samplerState && <ViewerSamplerHud {...samplerState} placement="footer" />}
              {diagnostics.map((diagnostic) => (
                <div className="flex justify-between gap-2" key={diagnostic.id}>
                  <span>{diagnostic.label}</span>
                  <span className="truncate text-text-primary">{diagnostic.value}</span>
                </div>
              ))}
            </div>
          </details>
        )}
        <div className="flex h-7 shrink-0 items-center rounded border border-editor-border bg-editor-panel-well">
          <button
            aria-label={t('editor.viewerFooter.zoom.out')}
            className={iconButton}
            onClick={() => executeZoom({ direction: 'out', kind: 'step' })}
            title={t('editor.viewerFooter.zoom.out')}
            type="button"
          >
            <Minus aria-hidden="true" size={14} />
          </button>
          <label className="relative flex h-7 min-w-16 items-center border-x border-editor-border">
            <span className="pointer-events-none absolute inset-0 flex items-center justify-center gap-1 font-mono tabular-nums text-text-primary">
              {zoomLabel}
              <ChevronDown aria-hidden="true" size={11} />
            </span>
            <select
              aria-label={t('editor.viewerFooter.zoom.label')}
              className="h-full w-full cursor-pointer opacity-0"
              data-resolution-state={zoomResolutionState}
              data-testid="viewer-footer-zoom-select"
              onChange={(event) => {
                const value = event.currentTarget.value;
                if (value === 'fit' || value === 'fill' || value === 'one-to-one' || value === 'two-to-one') {
                  executeZoom({ kind: value });
                } else {
                  executeZoom({ devicePixelsPerImagePixel: Number(value), kind: 'ratio' });
                }
                event.currentTarget.value = '';
              }}
              value=""
            >
              <option disabled value="">
                {zoomLabel}
              </option>
              <option value="fit">{t('editor.viewerFooter.zoom.fit')}</option>
              <option value="fill">{t('editor.viewerFooter.zoom.fill')}</option>
              <option value="one-to-one">{t('editor.viewerFooter.zoom.oneToOne')}</option>
              <option value="two-to-one">{t('editor.viewerFooter.zoom.twoToOne')}</option>
              <option value="0.25">{t('editor.viewerFooter.zoom.percent', { value: 25 })}</option>
              <option value="0.5">{t('editor.viewerFooter.zoom.percent', { value: 50 })}</option>
              <option value="1">{t('editor.viewerFooter.zoom.percent', { value: 100 })}</option>
              <option value="2">{t('editor.viewerFooter.zoom.percent', { value: 200 })}</option>
            </select>
          </label>
          <button
            aria-label={t('editor.viewerFooter.zoom.in')}
            className={iconButton}
            onClick={() => executeZoom({ direction: 'in', kind: 'step' })}
            title={t('editor.viewerFooter.zoom.in')}
            type="button"
          >
            <Plus aria-hidden="true" size={14} />
          </button>
        </div>
      </div>
    </div>
  );
}
