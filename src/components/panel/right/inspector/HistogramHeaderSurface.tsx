import cx from 'clsx';
import { AnimatePresence, motion } from 'framer-motion';
import {
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  GalleryHorizontal,
  RefreshCw,
  RotateCcw,
  Rows3,
  Settings2,
  ShieldCheck,
} from 'lucide-react';
import type { KeyboardEventHandler, PointerEventHandler } from 'react';
import { useTranslation } from 'react-i18next';
import type { PanelScopesLayout, PreviewScopeStatus } from '../../../../store/useEditorStore';
import { DisplayMode } from '../../../../utils/adjustments';
import type { PreviewBoundWarningState } from '../../../../utils/color/runtime/gamutWarningDisplay';
import { PANEL_SCOPES_HEIGHT } from '../../../../utils/waveformSizing';
import type { ChannelConfig } from '../../../adjustments/Curves';
import { Orientation, type Theme, type WaveformData } from '../../../ui/AppProperties';
import { professionalInspectorDensityTokens } from '../../../ui/inspectorTokens';
import Resizer from '../../../ui/Resizer';
import Waveform, {
  formatClipPercent,
  type HistogramClippingSummary,
  type HistogramHoverSample,
  HistogramView,
} from '../../editor/Waveform';

export type HistogramHeaderState = 'current' | 'degraded' | 'empty' | 'error' | 'loading' | 'unavailable';

export const scopeModes = [
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

const percent = (value: number): string => `${Math.round(value)}%`;

interface ClippingToggleProps {
  clippingEnabled: boolean;
  clippingLabel: string;
  edge: 'highlights' | 'shadows';
  edgePercent: number | undefined;
  enabled: boolean;
  onToggle: () => void;
  stateLabel: string;
  testId: string;
}

function ClippingToggle({
  clippingEnabled,
  clippingLabel,
  edge,
  edgePercent,
  enabled,
  onToggle,
  stateLabel,
  testId,
}: ClippingToggleProps) {
  const { t } = useTranslation();
  const edgeLabel = t(`ui.waveform.header.${edge}`, { defaultValue: edge });
  const formattedPercent = edgePercent === undefined ? '' : formatClipPercent(edgePercent);
  return (
    <button
      aria-label={`${clippingLabel}. ${edgeLabel} ${formattedPercent}`.trim()}
      aria-pressed={clippingEnabled}
      className={cx(
        'absolute top-1 z-30 inline-flex h-7 w-7 items-center justify-center rounded text-[8px] font-bold text-white/70 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-editor-focus-ring disabled:cursor-not-allowed disabled:opacity-35',
        edge === 'shadows' ? 'left-1' : 'right-1',
        clippingEnabled && 'bg-white/12 text-white',
        edgePercent !== undefined && edgePercent > 0 && (edge === 'shadows' ? 'text-blue-300' : 'text-red-300'),
      )}
      data-clipped={String(edgePercent !== undefined && edgePercent > 0)}
      data-clipping-percent={formattedPercent}
      data-testid={`${testId}-${edge === 'shadows' ? 'shadow' : 'highlight'}-clipping-toggle`}
      disabled={!enabled}
      onClick={onToggle}
      title={`${edgeLabel}: ${formattedPercent || stateLabel}`}
      type="button"
    >
      <AlertTriangle aria-hidden="true" className={edge === 'shadows' ? 'rotate-180' : undefined} size={16} />
      <span className="absolute">{edge === 'shadows' ? 'S' : 'H'}</span>
    </button>
  );
}

interface HistogramStatusProps {
  analyticsState: Exclude<HistogramHeaderState, 'current'>;
  onRetry: () => void;
  retryDisabled: boolean;
  retryLabel: string;
  stateLabel: string;
  testId: string;
}

function HistogramStatus({
  analyticsState,
  onRetry,
  retryDisabled,
  retryLabel,
  stateLabel,
  testId,
}: HistogramStatusProps) {
  const actionable = analyticsState === 'error' || analyticsState === 'degraded';
  return (
    <div
      aria-live={actionable ? 'polite' : 'off'}
      className="absolute inset-0 flex flex-col items-center justify-center gap-2 px-8 text-center"
      data-testid={`${testId}-state`}
    >
      {analyticsState === 'loading' && <RefreshCw aria-hidden="true" className="text-text-secondary" size={16} />}
      {analyticsState === 'error' && <AlertTriangle aria-hidden="true" className="text-editor-danger" size={17} />}
      <span className="text-[11px] font-medium text-text-secondary">{stateLabel}</span>
      {actionable && (
        <button
          className="rounded border border-editor-border bg-editor-panel-raised px-2 py-1 text-[10px] font-semibold text-text-primary hover:bg-editor-panel-well focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-editor-focus-ring"
          data-testid={`${testId}-recover-scopes`}
          disabled={retryDisabled}
          onClick={onRetry}
          type="button"
        >
          {retryLabel}
        </button>
      )}
    </div>
  );
}

interface HistogramPlotFrameProps {
  analyticsState: HistogramHeaderState;
  clippingEnabled: boolean;
  clippingLabel: string;
  clippingSummary: HistogramClippingSummary | null;
  histogram: ChannelConfig | null;
  hoverSample: HistogramHoverSample | null;
  onHoverSample: (sample: HistogramHoverSample | null) => void;
  onRetry: () => void;
  onToggleClipping: () => void;
  retryDisabled: boolean;
  retryLabel: string;
  stateLabel: string;
  testId: string;
  zoneLabel: string | null;
}

function HistogramPlotFrame(props: HistogramPlotFrameProps) {
  const current = props.analyticsState === 'current';
  return (
    <div
      className="relative h-32 overflow-hidden rounded border border-editor-border bg-[#101216] shadow-inner"
      data-testid={`${props.testId}-histogram-frame`}
    >
      {current && (
        <HistogramView
          histogram={props.histogram}
          interactive
          onHoverSample={props.onHoverSample}
          showClippingReadouts={false}
          testId={`${props.testId}-histogram`}
        />
      )}
      <div className="pointer-events-none absolute inset-x-9 top-1.5 z-20 flex justify-center">
        {props.hoverSample && props.zoneLabel && (
          <span
            className="rounded bg-black/75 px-2 py-1 text-[10px] font-medium text-white shadow"
            data-histogram-bin={props.hoverSample.bin}
            data-histogram-zone={props.hoverSample.zone}
            data-testid={`${props.testId}-hover-readout`}
          >
            {props.zoneLabel} · <span className="text-red-300">R {percent(props.hoverSample.redPercent)}</span>{' '}
            <span className="text-green-300">G {percent(props.hoverSample.greenPercent)}</span>{' '}
            <span className="text-blue-300">B {percent(props.hoverSample.bluePercent)}</span>{' '}
            <span className="text-white/80">L {percent(props.hoverSample.lumaPercent)}</span>
          </span>
        )}
      </div>
      <ClippingToggle
        clippingEnabled={props.clippingEnabled}
        clippingLabel={props.clippingLabel}
        edge="shadows"
        edgePercent={props.clippingSummary?.shadowPercent}
        enabled={current}
        onToggle={props.onToggleClipping}
        stateLabel={props.stateLabel}
        testId={props.testId}
      />
      <ClippingToggle
        clippingEnabled={props.clippingEnabled}
        clippingLabel={props.clippingLabel}
        edge="highlights"
        edgePercent={props.clippingSummary?.highlightPercent}
        enabled={current}
        onToggle={props.onToggleClipping}
        stateLabel={props.stateLabel}
        testId={props.testId}
      />
      {props.analyticsState === 'current' ? null : (
        <HistogramStatus
          analyticsState={props.analyticsState}
          onRetry={props.onRetry}
          retryDisabled={props.retryDisabled}
          retryLabel={props.retryLabel}
          stateLabel={props.stateLabel}
          testId={props.testId}
        />
      )}
    </div>
  );
}

interface HistogramHeaderSurfaceProps extends HistogramPlotFrameProps {
  isAdvancedOpen: boolean;
  onToggleAdvanced: () => void;
  photoIdentity: string;
  photoSettings: string | null;
}

export function HistogramHeaderSurface({
  isAdvancedOpen,
  onToggleAdvanced,
  photoIdentity,
  photoSettings,
  ...plotProps
}: HistogramHeaderSurfaceProps) {
  const { t } = useTranslation();
  return (
    <div className="px-2.5 pb-1.5 pt-2">
      <HistogramPlotFrame {...plotProps} />
      <div className="mt-1.5 flex min-w-0 items-start gap-2" data-testid={`${plotProps.testId}-metadata`}>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[10px] font-semibold text-text-primary" title={photoIdentity}>
            {photoIdentity}
          </div>
          {photoSettings && (
            <div className="truncate text-[10px] text-text-secondary" title={photoSettings}>
              {photoSettings}
            </div>
          )}
        </div>
        <button
          aria-controls={`${plotProps.testId}-advanced-scopes`}
          aria-expanded={isAdvancedOpen}
          className={cx(
            'inline-flex h-7 shrink-0 items-center gap-1 rounded px-1.5 text-[10px] font-semibold text-text-secondary hover:bg-editor-panel-raised hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-editor-focus-ring',
            isAdvancedOpen && 'bg-editor-panel-raised text-text-primary',
          )}
          data-testid={`${plotProps.testId}-expand-toggle`}
          onClick={onToggleAdvanced}
          type="button"
        >
          <Settings2 aria-hidden="true" size={13} />
          {t('ui.waveform.header.advancedScopes')}
          {isAdvancedOpen ? (
            <ChevronDown aria-hidden="true" size={12} />
          ) : (
            <ChevronRight aria-hidden="true" size={12} />
          )}
        </button>
      </div>
      <div data-develop-tool-strip-slot="true" data-testid={`${plotProps.testId}-tool-strip-mount`} />
    </div>
  );
}

interface AdvancedScopesDrawerProps {
  activeMode: DisplayMode;
  analyticsCurrent: boolean;
  clippingEnabled: boolean;
  currentHeight: number;
  histogram: ChannelConfig | null;
  isOpen: boolean;
  isResizing: boolean;
  layout: PanelScopesLayout;
  onModeKeyDown: KeyboardEventHandler<HTMLButtonElement>;
  onOpenOutput: () => void;
  onResetHeight: () => void;
  onResize: PointerEventHandler<HTMLDivElement>;
  onSelectMode: (mode: DisplayMode) => void;
  onSetLayout: (layout: PanelScopesLayout) => void;
  onToggleClipping: () => void;
  previewScopeStatus: PreviewScopeStatus | null;
  proofLabel: string;
  proofState: PreviewBoundWarningState;
  testId: string;
  theme: Theme;
  waveform: WaveformData | null;
}

export function AdvancedScopesDrawer(props: AdvancedScopesDrawerProps) {
  const { t } = useTranslation();
  const activeLayoutToggle = layoutToggles[props.layout];
  const LayoutIcon = activeLayoutToggle.icon;
  return (
    <AnimatePresence initial={false}>
      {props.isOpen && (
        <motion.div
          animate={{ height: props.currentHeight, opacity: 1 }}
          className="relative flex min-h-0 flex-col overflow-hidden border-t border-editor-border"
          data-active-waveform-channel={props.activeMode}
          data-max-height={PANEL_SCOPES_HEIGHT.max}
          data-min-height={PANEL_SCOPES_HEIGHT.min}
          data-panel-scopes-height={props.currentHeight}
          data-panel-scopes-layout={props.layout}
          data-testid={`${props.testId}-advanced-scopes`}
          exit={{ height: 0, opacity: 0 }}
          id={`${props.testId}-advanced-scopes`}
          initial={{ height: 0, opacity: 0 }}
          transition={{ duration: props.isResizing ? 0 : 0.16, ease: 'easeOut' }}
        >
          <div className="flex h-8 shrink-0 items-center gap-1 border-b border-editor-border px-2">
            <div
              aria-label={t('ui.waveform.drawerControls.mode')}
              className="grid min-w-0 flex-1 grid-cols-5 gap-px overflow-hidden rounded border border-editor-border bg-editor-panel-well p-px"
              role="group"
            >
              {scopeModes.map(({ label, mode, testId: modeTestId, tooltipKey }) => (
                <button
                  aria-label={t(tooltipKey)}
                  aria-pressed={props.activeMode === mode}
                  className={cx(
                    'h-6 min-w-0 px-1 text-[10px] font-semibold transition-colors focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-editor-focus-ring',
                    props.activeMode === mode
                      ? 'bg-editor-primary-active text-editor-primary-active-text'
                      : 'text-text-secondary hover:bg-editor-panel-raised hover:text-text-primary',
                  )}
                  data-scope-mode={mode}
                  data-testid={`${props.testId}-mode-${modeTestId}`}
                  data-tooltip={t(tooltipKey)}
                  key={mode}
                  onClick={() => props.onSelectMode(mode)}
                  onKeyDown={props.onModeKeyDown}
                  tabIndex={props.activeMode === mode ? 0 : -1}
                  type="button"
                >
                  {label}
                </button>
              ))}
            </div>
            <button
              aria-label={`${props.proofLabel}. ${t('ui.waveform.header.openOutput')}`}
              className={professionalInspectorDensityTokens.frame.actionButton}
              data-proof-state={props.proofState}
              data-testid={`${props.testId}-proof-status`}
              data-tooltip={props.proofLabel}
              onClick={props.onOpenOutput}
              type="button"
            >
              <ShieldCheck aria-hidden="true" size={13} />
            </button>
            <button
              aria-label={t(activeLayoutToggle.labelKey, { defaultValue: 'Toggle scope layout' })}
              className={professionalInspectorDensityTokens.frame.actionButton}
              data-testid={`${props.testId}-layout-toggle`}
              onClick={() => props.onSetLayout(activeLayoutToggle.next)}
              type="button"
            >
              <LayoutIcon aria-hidden="true" size={14} />
            </button>
            <button
              aria-label={t('ui.waveform.drawerControls.resetHeight')}
              className={professionalInspectorDensityTokens.frame.actionButton}
              data-testid={`${props.testId}-reset-height`}
              onClick={props.onResetHeight}
              type="button"
            >
              <RotateCcw aria-hidden="true" size={14} />
            </button>
          </div>
          <div className={cx('min-h-0 w-full grow', props.layout === 'overlay' ? 'p-2' : 'px-3 pb-1.5 pt-1')}>
            <Waveform
              displayMode={props.activeMode}
              histogram={props.analyticsCurrent ? props.histogram : null}
              onToggleClipping={props.onToggleClipping}
              previewScopeStatus={props.previewScopeStatus}
              setDisplayMode={props.onSelectMode}
              showInlineControls={false}
              showClipping={props.clippingEnabled}
              theme={props.theme}
              waveformData={props.analyticsCurrent ? props.waveform : null}
            />
          </div>
          <Resizer
            ariaLabel={t('ui.waveform.header.resizeAdvanced')}
            direction={Orientation.Horizontal}
            onMouseDown={props.onResize}
            testId={`${props.testId}-resizer`}
          />
        </motion.div>
      )}
    </AnimatePresence>
  );
}
