import cx from 'clsx';
import { AnimatePresence, motion } from 'framer-motion';
import {
  AlertTriangle,
  ChartArea,
  ChevronDown,
  ChevronRight,
  GalleryHorizontal,
  RotateCcw,
  Rows3,
  ShieldCheck,
} from 'lucide-react';
import { type KeyboardEvent, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useShallow } from 'zustand/react/shallow';

import { useEditorActions } from '../../../../hooks/editor/useEditorActions';
import { useWaveformControls } from '../../../../hooks/editor/useWaveformControls';
import { type PanelScopesLayout, useEditorStore } from '../../../../store/useEditorStore';
import { useSettingsStore } from '../../../../store/useSettingsStore';
import { useUIStore } from '../../../../store/useUIStore';
import { type Adjustments, DisplayMode } from '../../../../utils/adjustments';
import {
  getPreviewScopeFreshnessStatus,
  getRenderedPreviewWarningStatus,
  type PreviewBoundWarningState,
} from '../../../../utils/color/runtime/gamutWarningDisplay';
import { requestColorOutputFocus } from '../../../../utils/colorWorkspaceNavigation';
import { PANEL_SCOPES_HEIGHT } from '../../../../utils/waveformSizing';
import { Orientation, Panel } from '../../../ui/AppProperties';
import { professionalInspectorDensityTokens } from '../../../ui/inspectorTokens';
import Resizer from '../../../ui/Resizer';
import Waveform from '../../editor/Waveform';

interface InspectorAnalyticsHeaderProps {
  testId: string;
}

const scopeModes = [
  { label: 'L', mode: DisplayMode.Luma, testId: 'luma', tooltipKey: 'ui.waveform.tooltips.luma' },
  { label: 'RGB', mode: DisplayMode.Rgb, testId: 'rgb', tooltipKey: 'ui.waveform.tooltips.rgb' },
  { label: 'P', mode: DisplayMode.Parade, testId: 'parade', tooltipKey: 'ui.waveform.tooltips.parade' },
  { label: 'V', mode: DisplayMode.Vectorscope, testId: 'vectorscope', tooltipKey: 'ui.waveform.tooltips.vectorscope' },
  { label: 'H', mode: DisplayMode.Histogram, testId: 'histogram', tooltipKey: 'ui.waveform.tooltips.histogram' },
] as const;

const layoutToggles: Record<
  PanelScopesLayout,
  { icon: typeof GalleryHorizontal; labelKey: string; next: PanelScopesLayout }
> = {
  overlay: { icon: GalleryHorizontal, labelKey: 'ui.waveform.drawerControls.layoutOverlay', next: 'stacked' },
  stacked: { icon: Rows3, labelKey: 'ui.waveform.drawerControls.layoutStacked', next: 'overlay' },
};

const stateClasses: Record<PreviewBoundWarningState | 'error' | 'loading', string> = {
  current: 'text-editor-success',
  error: 'text-editor-danger',
  loading: 'text-text-secondary',
  stale: 'text-editor-warning',
  unavailable: 'text-text-secondary',
  unsupported: 'text-editor-warning',
};

export default function InspectorAnalyticsHeader({ testId }: InspectorAnalyticsHeaderProps) {
  const { t } = useTranslation();
  const { setAdjustments } = useEditorActions();
  const {
    handleWaveformResize,
    isResizingWaveform,
    onToggleWaveform,
    resetWaveformHeight,
    setActiveWaveformChannel,
    setPanelScopesLayout,
  } = useWaveformControls();
  const setRightPanel = useUIStore((state) => state.setRightPanel);
  const theme = useSettingsStore((state) => state.theme);
  const {
    adjustments,
    activeWaveformChannel,
    exportSoftProofRecipeId,
    exportSoftProofTransform,
    gamutWarningOverlay,
    histogram,
    isExportSoftProofEnabled,
    isWaveformVisible,
    panelScopesLayout,
    previewScopeStatus,
    selectedImage,
    waveform,
    waveformHeight,
  } = useEditorStore(
    useShallow((state) => ({
      adjustments: state.adjustments,
      activeWaveformChannel: state.activeWaveformChannel,
      exportSoftProofRecipeId: state.exportSoftProofRecipeId,
      exportSoftProofTransform: state.exportSoftProofTransform,
      gamutWarningOverlay: state.gamutWarningOverlay,
      histogram: state.histogram,
      isExportSoftProofEnabled: state.isExportSoftProofEnabled,
      isWaveformVisible: state.isWaveformVisible,
      panelScopesLayout: state.panelScopesLayout,
      previewScopeStatus: state.previewScopeStatus,
      selectedImage: state.selectedImage,
      waveform: state.waveform,
      waveformHeight: state.waveformHeight,
    })),
  );
  const clippingEnabled = adjustments.showClipping || false;
  const currentHeight = waveformHeight || PANEL_SCOPES_HEIGHT.default;
  const activeLayoutToggle = layoutToggles[panelScopesLayout];
  const LayoutIcon = activeLayoutToggle.icon;
  const selectedImagePath = selectedImage?.path ?? null;
  const scopeFreshness = getPreviewScopeFreshnessStatus(previewScopeStatus, selectedImagePath);
  const proofStatus = getRenderedPreviewWarningStatus(gamutWarningOverlay, {
    exportSoftProofRecipeId,
    exportSoftProofTransform,
    isExportSoftProofEnabled,
    selectedImagePath,
  });
  const hasScopeError = previewScopeStatus?.warningCodes.some((code) => /error|fail/iu.test(code)) ?? false;
  const analyticsState = hasScopeError
    ? 'error'
    : selectedImage !== null && !selectedImage.isReady
      ? 'loading'
      : scopeFreshness.state;
  const analyticsLabel = hasScopeError
    ? 'Scopes error'
    : analyticsState === 'loading'
      ? t('editor.adjustments.status.loadingImage', { defaultValue: 'Loading image preview' })
      : scopeFreshness.statusLabel;
  const proofLabel = isExportSoftProofEnabled ? `Proof on: ${proofStatus.coverageLabel}` : 'Proof off';
  const clippingLabel = clippingEnabled
    ? t('ui.waveform.tooltips.hideClipping')
    : t('ui.waveform.tooltips.showClipping');

  const toggleClipping = useCallback(() => {
    setAdjustments((previous: Adjustments) => ({ ...previous, showClipping: !previous.showClipping }));
  }, [setAdjustments]);

  const openOutputControls = useCallback(() => {
    requestColorOutputFocus();
    setRightPanel(Panel.Color);
    requestAnimationFrame(() => {
      document.querySelector<HTMLElement>('[data-testid="color-workspace-tab-output"]')?.focus();
    });
  }, [setRightPanel]);

  const handleModeKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    const direction =
      event.key === 'ArrowRight' || event.key === 'ArrowDown'
        ? 1
        : event.key === 'ArrowLeft' || event.key === 'ArrowUp'
          ? -1
          : 0;
    if (direction === 0) return;
    event.preventDefault();
    const currentIndex = scopeModes.findIndex(({ mode }) => mode === activeWaveformChannel);
    const nextIndex = (currentIndex + direction + scopeModes.length) % scopeModes.length;
    const nextMode = scopeModes[nextIndex];
    if (!nextMode) return;
    setActiveWaveformChannel(nextMode.mode);
    event.currentTarget.parentElement
      ?.querySelector<HTMLButtonElement>(`[data-scope-mode="${nextMode.mode}"]`)
      ?.focus();
  };

  return (
    <section
      aria-label={t('editor.adjustments.tooltips.toggleAnalytics')}
      className="shrink-0 border-b border-editor-border bg-editor-panel"
      data-active-waveform-channel={activeWaveformChannel}
      data-analytics-state={analyticsState}
      data-panel-scopes-height={currentHeight}
      data-panel-scopes-layout={panelScopesLayout}
      data-preview-scope-freshness={scopeFreshness.state}
      data-preview-scope-status-label={analyticsLabel}
      data-show-clipping={String(clippingEnabled)}
      data-state={isWaveformVisible ? 'open' : 'collapsed'}
      data-testid={testId}
    >
      <div className="flex h-8 min-w-0 items-center gap-1 px-2" data-testid={`${testId}-summary`}>
        <button
          aria-controls={`${testId}-content`}
          aria-expanded={isWaveformVisible}
          aria-label={t('editor.adjustments.tooltips.toggleAnalytics')}
          className={cx(
            professionalInspectorDensityTokens.frame.actionButton,
            isWaveformVisible && professionalInspectorDensityTokens.frame.actionButtonActive,
          )}
          data-testid={`${testId}-expand-toggle`}
          data-tooltip={t('editor.adjustments.tooltips.toggleAnalytics')}
          onClick={onToggleWaveform}
          type="button"
        >
          {isWaveformVisible ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </button>
        <ChartArea aria-hidden="true" className="shrink-0 text-text-secondary" size={14} />
        <span className="min-w-0 flex-1 truncate text-[11px] font-semibold text-text-primary">
          {t('editor.adjustments.tooltips.toggleAnalytics')}
        </span>
        <span
          aria-live={analyticsState === 'error' || analyticsState === 'stale' ? 'polite' : 'off'}
          className={cx('max-w-24 truncate text-[10px] font-medium', stateClasses[analyticsState])}
          data-testid={`${testId}-freshness-status`}
          title={analyticsLabel}
        >
          {analyticsLabel}
        </span>
        <button
          aria-label={`${proofLabel}. Open Color Output controls`}
          className={cx(
            'inline-flex h-6 max-w-24 items-center gap-1 truncate px-1 text-[10px] font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-editor-focus-ring',
            stateClasses[proofStatus.state],
          )}
          data-proof-state={proofStatus.state}
          data-testid={`${testId}-proof-status`}
          data-tooltip={proofLabel}
          onClick={openOutputControls}
          type="button"
        >
          <ShieldCheck aria-hidden="true" className="shrink-0" size={13} />
          <span className="truncate">{proofLabel}</span>
        </button>
      </div>

      <AnimatePresence initial={false}>
        {isWaveformVisible && (
          <motion.div
            animate={{ height: currentHeight, opacity: 1 }}
            className="relative flex min-h-0 flex-col overflow-hidden border-t border-editor-border"
            data-active-waveform-channel={activeWaveformChannel}
            data-max-height={PANEL_SCOPES_HEIGHT.max}
            data-min-height={PANEL_SCOPES_HEIGHT.min}
            data-panel-scopes-height={currentHeight}
            data-panel-scopes-layout={panelScopesLayout}
            exit={{ height: 0, opacity: 0 }}
            id={`${testId}-content`}
            initial={{ height: 0, opacity: 0 }}
            transition={{ duration: isResizingWaveform ? 0 : 0.16, ease: 'easeOut' }}
          >
            <div className="flex h-8 shrink-0 items-center gap-1 border-b border-editor-border px-2">
              <div
                aria-label={t('ui.waveform.drawerControls.mode', { defaultValue: 'Scope mode' })}
                className="grid min-w-0 flex-1 grid-cols-5 gap-px overflow-hidden rounded border border-editor-border bg-editor-panel-well p-px"
                role="group"
              >
                {scopeModes.map(({ label, mode, testId: modeTestId, tooltipKey }) => (
                  <button
                    aria-label={t(tooltipKey, { defaultValue: label })}
                    aria-pressed={activeWaveformChannel === mode}
                    className={cx(
                      'h-6 min-w-0 px-1 text-[10px] font-semibold transition-colors focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-editor-focus-ring',
                      activeWaveformChannel === mode
                        ? 'bg-editor-primary-active text-editor-primary-active-text'
                        : 'text-text-secondary hover:bg-editor-panel-raised hover:text-text-primary',
                    )}
                    data-scope-mode={mode}
                    data-testid={`${testId}-mode-${modeTestId}`}
                    data-tooltip={t(tooltipKey, { defaultValue: label })}
                    key={mode}
                    onClick={() => setActiveWaveformChannel(mode)}
                    onKeyDown={handleModeKeyDown}
                    tabIndex={activeWaveformChannel === mode ? 0 : -1}
                    type="button"
                  >
                    {label}
                  </button>
                ))}
              </div>
              {(['shadows', 'highlights'] as const).map((edge) => (
                <button
                  aria-label={`${clippingLabel}: ${edge}`}
                  aria-pressed={clippingEnabled}
                  className={cx(
                    professionalInspectorDensityTokens.frame.actionButton,
                    clippingEnabled && professionalInspectorDensityTokens.frame.actionButtonActive,
                  )}
                  data-testid={`${testId}-${edge === 'shadows' ? 'shadow' : 'highlight'}-clipping-toggle`}
                  key={edge}
                  onClick={toggleClipping}
                  title={`${clippingEnabled ? 'Hide' : 'Show'} ${edge} clipping overlay`}
                  type="button"
                >
                  <AlertTriangle
                    aria-hidden="true"
                    className={edge === 'shadows' ? 'rotate-180' : undefined}
                    size={13}
                  />
                </button>
              ))}
              <button
                aria-label={t(activeLayoutToggle.labelKey, { defaultValue: 'Toggle scope layout' })}
                className={professionalInspectorDensityTokens.frame.actionButton}
                data-testid={`${testId}-layout-toggle`}
                data-tooltip={t(activeLayoutToggle.labelKey, { defaultValue: 'Toggle scope layout' })}
                onClick={() => setPanelScopesLayout(activeLayoutToggle.next)}
                type="button"
              >
                <LayoutIcon size={14} />
              </button>
              <button
                aria-label={t('ui.waveform.drawerControls.resetHeight', { defaultValue: 'Reset scope height' })}
                className={professionalInspectorDensityTokens.frame.actionButton}
                data-testid={`${testId}-reset-height`}
                data-tooltip={t('ui.waveform.drawerControls.resetHeight', { defaultValue: 'Reset scope height' })}
                onClick={resetWaveformHeight}
                type="button"
              >
                <RotateCcw size={14} />
              </button>
            </div>
            <div className={cx('min-h-0 w-full grow', panelScopesLayout === 'overlay' ? 'p-2' : 'px-3 pb-1.5 pt-1')}>
              <Waveform
                displayMode={activeWaveformChannel}
                histogram={histogram}
                onToggleClipping={toggleClipping}
                previewScopeStatus={previewScopeStatus}
                setDisplayMode={setActiveWaveformChannel}
                showInlineControls={false}
                showClipping={clippingEnabled}
                theme={theme}
                waveformData={waveform || null}
              />
            </div>
            <Resizer
              ariaLabel="Resize image analytics"
              direction={Orientation.Horizontal}
              onMouseDown={handleWaveformResize}
              testId={`${testId}-resizer`}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  );
}
