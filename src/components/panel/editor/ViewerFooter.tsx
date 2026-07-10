import cx from 'clsx';
import { Check, ChevronDown, Loader2, Minus, MoreHorizontal, Plus, TriangleAlert } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useShallow } from 'zustand/react/shallow';
import { useEditorStore } from '../../../store/useEditorStore';
import { useLibraryStore } from '../../../store/useLibraryStore';
import {
  getEditorChromeStatusChips,
  getEditorChromeStatusStripChips,
} from '../../../utils/color/runtime/gamutWarningDisplay';
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
}: ViewerFooterProps) {
  const { t } = useTranslation();
  const footerRef = useRef<HTMLDivElement>(null);
  const [footerWidth, setFooterWidth] = useState(Number.POSITIVE_INFINITY);
  const { imageList, multiSelectedPaths } = useLibraryStore(
    useShallow((state) => ({ imageList: state.imageList, multiSelectedPaths: state.multiSelectedPaths })),
  );
  const editor = useEditorStore(
    useShallow((state) => ({
      adjustments: state.adjustments,
      compare: state.compare,
      exportSoftProofRecipeId: state.exportSoftProofRecipeId,
      exportSoftProofTransform: state.exportSoftProofTransform,
      gamutWarningOverlay: state.gamutWarningOverlay,
      isExportSoftProofEnabled: state.isExportSoftProofEnabled,
      previewQualityStatus: state.previewQualityStatus,
      previewScopeStatus: state.previewScopeStatus,
      selectedImage: state.selectedImage,
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
          adjustments: editor.adjustments,
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
  const zoomLabel = formatEditorZoomLabel(resolvedZoom, {
    fill: t('editor.viewerFooter.zoom.fill'),
    fit: t('editor.viewerFooter.zoom.fit'),
  });
  const statusIcon =
    renderStatus.phase === 'error' || renderStatus.phase === 'degraded' ? (
      <TriangleAlert aria-hidden="true" size={13} />
    ) : renderStatus.busy ? (
      <Loader2 aria-hidden="true" className="animate-spin motion-reduce:animate-none" size={13} />
    ) : (
      <Check aria-hidden="true" size={13} />
    );
  const iconButton = cx(
    editorChromeTokens.button.base,
    editorChromeTokens.button.iconCompact,
    editorChromeTokens.button.quiet,
    editorChromeTokens.focusRing,
  );

  return (
    <div
      aria-label={t('editor.viewerFooter.accessibilityLabel')}
      className={cx(
        editorChromeTokens.region.viewerStatusFooter,
        'z-[130] grid min-h-9 w-full grid-cols-[minmax(0,1fr)_minmax(9rem,auto)_minmax(0,1fr)] items-center gap-2 overflow-visible py-0.5 text-[11px]',
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
      <div className="flex min-w-0 items-center gap-2 overflow-hidden" data-testid="viewer-footer-left">
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

      <div className="flex min-w-0 items-center justify-center gap-2" data-testid="viewer-footer-center">
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
