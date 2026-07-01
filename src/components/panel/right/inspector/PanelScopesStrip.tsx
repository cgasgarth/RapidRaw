import cx from 'clsx';
import { AnimatePresence, motion } from 'framer-motion';
import { AlertOctagon, GalleryHorizontal, RotateCcw, Rows3 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useShallow } from 'zustand/react/shallow';

import { useEditorActions } from '../../../../hooks/editor/useEditorActions';
import { useWaveformControls } from '../../../../hooks/editor/useWaveformControls';
import { type PanelScopesLayout, useEditorStore } from '../../../../store/useEditorStore';
import { useSettingsStore } from '../../../../store/useSettingsStore';
import { type Adjustments, DisplayMode } from '../../../../utils/adjustments';
import { PANEL_SCOPES_HEIGHT } from '../../../../utils/waveformSizing';
import { Orientation } from '../../../ui/AppProperties';
import Resizer from '../../../ui/Resizer';
import Waveform from '../../editor/Waveform';

interface PanelScopesStripProps {
  testId: string;
}

const scopeModeButtons: ReadonlyArray<{ label: string; mode: DisplayMode; testId: string; tooltipKey: string }> = [
  { label: 'L', mode: DisplayMode.Luma, testId: 'luma', tooltipKey: 'ui.waveform.tooltips.luma' },
  { label: 'RGB', mode: DisplayMode.Rgb, testId: 'rgb', tooltipKey: 'ui.waveform.tooltips.rgb' },
  { label: 'P', mode: DisplayMode.Parade, testId: 'parade', tooltipKey: 'ui.waveform.tooltips.parade' },
  { label: 'V', mode: DisplayMode.Vectorscope, testId: 'vectorscope', tooltipKey: 'ui.waveform.tooltips.vectorscope' },
  { label: 'H', mode: DisplayMode.Histogram, testId: 'histogram', tooltipKey: 'ui.waveform.tooltips.histogram' },
] as const;

const layoutToggleLabels: Record<
  PanelScopesLayout,
  { icon: typeof GalleryHorizontal; labelKey: string; next: PanelScopesLayout }
> = {
  overlay: {
    icon: GalleryHorizontal,
    labelKey: 'ui.waveform.drawerControls.layoutOverlay',
    next: 'stacked',
  },
  stacked: {
    icon: Rows3,
    labelKey: 'ui.waveform.drawerControls.layoutStacked',
    next: 'overlay',
  },
};

export default function PanelScopesStrip({ testId }: PanelScopesStripProps) {
  const { t } = useTranslation();
  const { setAdjustments } = useEditorActions();
  const {
    handleWaveformResize,
    isResizingWaveform,
    resetWaveformHeight,
    setActiveWaveformChannel,
    setPanelScopesLayout,
  } = useWaveformControls();
  const theme = useSettingsStore((state) => state.theme);
  const {
    adjustments,
    activeWaveformChannel,
    histogram,
    isWaveformVisible,
    panelScopesLayout,
    previewScopeStatus,
    waveform,
    waveformHeight,
  } = useEditorStore(
    useShallow((state) => ({
      adjustments: state.adjustments,
      activeWaveformChannel: state.activeWaveformChannel,
      histogram: state.histogram,
      isWaveformVisible: state.isWaveformVisible,
      panelScopesLayout: state.panelScopesLayout,
      previewScopeStatus: state.previewScopeStatus,
      waveform: state.waveform,
      waveformHeight: state.waveformHeight,
    })),
  );
  const clippingEnabled = adjustments.showClipping || false;
  const currentHeight = waveformHeight || PANEL_SCOPES_HEIGHT.default;
  const activeLayoutToggle = layoutToggleLabels[panelScopesLayout];
  const LayoutIcon = activeLayoutToggle.icon;
  const controlsId = `${testId}-controls`;
  const waveformPaddingClass = panelScopesLayout === 'overlay' ? 'p-2 pt-9' : 'px-3 pb-1.5 pt-1';

  const toggleClipping = () => {
    setAdjustments((prev: Adjustments) => ({
      ...prev,
      showClipping: !prev.showClipping,
    }));
  };

  return (
    <AnimatePresence initial={false}>
      {isWaveformVisible ? (
        <motion.div
          animate={{ height: currentHeight, opacity: 1 }}
          className="relative flex shrink-0 flex-col overflow-hidden border-b border-surface"
          data-active-waveform-channel={activeWaveformChannel}
          data-max-height={PANEL_SCOPES_HEIGHT.max}
          data-min-height={PANEL_SCOPES_HEIGHT.min}
          data-panel-scopes-height={currentHeight}
          data-panel-scopes-layout={panelScopesLayout}
          data-show-clipping={String(clippingEnabled)}
          data-testid={testId}
          data-state="open"
          exit={{ height: 0, opacity: 0 }}
          initial={{ height: 0, opacity: 0 }}
          transition={{ duration: isResizingWaveform ? 0 : 0.2, ease: 'easeOut' }}
        >
          <div
            className={cx(
              'z-30 flex shrink-0 items-center gap-1 border-surface bg-editor-panel/95 px-2 py-1 text-text-primary backdrop-blur',
              panelScopesLayout === 'overlay' ? 'absolute inset-x-2 top-2 rounded border shadow-lg' : 'border-b',
            )}
            data-testid={controlsId}
          >
            <div
              aria-label={t('ui.waveform.drawerControls.mode', { defaultValue: 'Scope mode' })}
              className="grid min-w-0 flex-1 grid-cols-5 gap-0.5 rounded bg-bg-secondary p-0.5"
              role="group"
            >
              {scopeModeButtons.map(({ label, mode, testId: modeTestId, tooltipKey }) => (
                <button
                  aria-label={t(tooltipKey, { defaultValue: label })}
                  aria-pressed={activeWaveformChannel === mode}
                  className={cx(
                    'h-6 min-w-0 rounded px-1 text-[10px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-editor-focus-ring',
                    activeWaveformChannel === mode
                      ? 'bg-accent text-button-text'
                      : 'text-text-secondary hover:bg-bg-tertiary hover:text-text-primary',
                  )}
                  data-testid={`${testId}-mode-${modeTestId}`}
                  data-tooltip={t(tooltipKey, { defaultValue: label })}
                  key={mode}
                  onClick={() => {
                    setActiveWaveformChannel(mode);
                  }}
                  type="button"
                >
                  {label}
                </button>
              ))}
            </div>
            <button
              aria-label={
                clippingEnabled ? t('ui.waveform.tooltips.hideClipping') : t('ui.waveform.tooltips.showClipping')
              }
              aria-pressed={clippingEnabled}
              className={cx(
                'inline-flex h-7 w-7 shrink-0 items-center justify-center rounded transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-editor-focus-ring',
                clippingEnabled ? 'bg-accent text-button-text' : 'text-text-secondary hover:bg-bg-tertiary',
              )}
              data-testid={`${testId}-clipping-toggle`}
              data-tooltip={
                clippingEnabled ? t('ui.waveform.tooltips.hideClipping') : t('ui.waveform.tooltips.showClipping')
              }
              onClick={toggleClipping}
              type="button"
            >
              <AlertOctagon size={14} />
            </button>
            <button
              aria-label={t(activeLayoutToggle.labelKey, { defaultValue: 'Toggle scope layout' })}
              className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded text-text-secondary transition-colors hover:bg-bg-tertiary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-editor-focus-ring"
              data-testid={`${testId}-layout-toggle`}
              data-tooltip={t(activeLayoutToggle.labelKey, { defaultValue: 'Toggle scope layout' })}
              onClick={() => {
                setPanelScopesLayout(activeLayoutToggle.next);
              }}
              type="button"
            >
              <LayoutIcon size={14} />
            </button>
            <button
              aria-label={t('ui.waveform.drawerControls.resetHeight', { defaultValue: 'Reset scope height' })}
              className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded text-text-secondary transition-colors hover:bg-bg-tertiary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-editor-focus-ring"
              data-testid={`${testId}-reset-height`}
              data-tooltip={t('ui.waveform.drawerControls.resetHeight', { defaultValue: 'Reset scope height' })}
              onClick={resetWaveformHeight}
              type="button"
            >
              <RotateCcw size={14} />
            </button>
          </div>
          <div className={cx('min-h-0 h-full w-full grow', waveformPaddingClass)}>
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
            ariaLabel="Resize scopes"
            direction={Orientation.Horizontal}
            onMouseDown={handleWaveformResize}
            testId={`${testId}-resizer`}
          />
        </motion.div>
      ) : (
        <div data-testid={testId} data-state="closed" hidden />
      )}
    </AnimatePresence>
  );
}
