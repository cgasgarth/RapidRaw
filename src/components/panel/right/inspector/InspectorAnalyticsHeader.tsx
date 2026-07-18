import { type KeyboardEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useShallow } from 'zustand/react/shallow';

import { useWaveformControls } from '../../../../hooks/editor/useWaveformControls';
import { useEditorStore } from '../../../../store/useEditorStore';
import { useSettingsStore } from '../../../../store/useSettingsStore';
import { useUIStore } from '../../../../store/useUIStore';
import { type BasicAdjustment, DisplayMode } from '../../../../utils/adjustments';
import {
  type BasicToneCommitIdentity,
  captureBasicToneCommitIdentity,
} from '../../../../utils/basicToneEditTransaction';
import {
  buildColorOutputProofingDiagnosticRow,
  buildColorOutputProofingDiagnostics,
  getPreviewHistogramFreshnessStatus,
  getPreviewScopeFreshnessStatus,
  getRenderedPreviewWarningStatus,
} from '../../../../utils/color/runtime/gamutWarningDisplay';
import { requestColorOutputFocus } from '../../../../utils/colorWorkspaceNavigation';
import { selectEditDocumentNode } from '../../../../utils/editDocumentSelectors';
import { PANEL_SCOPES_HEIGHT } from '../../../../utils/waveformSizing';
import { type ExifData, Panel } from '../../../ui/AppProperties';
import {
  getHistogramClippingSummary,
  getHistogramTonalZoneConfig,
  type HistogramHoverSample,
  type HistogramTonalZone,
  type HistogramTonalZoneEditor,
} from '../../editor/Waveform';
import DevelopToolStrip from './DevelopToolStrip';
import {
  AdvancedScopesDrawer,
  type HistogramHeaderState,
  HistogramHeaderSurface,
  scopeModes,
} from './HistogramHeaderSurface';

interface InspectorAnalyticsHeaderProps {
  includeDevelopToolStrip?: boolean;
  testId: string;
}

export interface DevelopPhotoMetadata {
  camera: string | null;
  settings: string | null;
}

const stateFallbacks: Record<HistogramHeaderState, string> = {
  current: 'Histogram current',
  degraded: 'Updating histogram for this photo',
  empty: 'Select a photo to view its histogram',
  error: 'Histogram could not be loaded',
  loading: 'Building histogram…',
  unavailable: 'Histogram unavailable for this preview',
};

interface HistogramStateInput {
  hasImage: boolean;
  histogramFreshness: 'current' | 'error' | 'stale' | 'unavailable' | 'unsupported';
  imageReady: boolean;
  recoveryState: 'error' | 'idle' | 'loading';
  scopeStatusPresent: boolean;
}

export const resolveHistogramHeaderState = ({
  hasImage,
  histogramFreshness,
  imageReady,
  recoveryState,
  scopeStatusPresent,
}: HistogramStateInput): HistogramHeaderState => {
  if (!hasImage) return 'empty';
  if (histogramFreshness === 'error') return 'error';
  if (recoveryState === 'error' && histogramFreshness !== 'current') return 'error';
  if (!imageReady || recoveryState === 'loading' || !scopeStatusPresent) return 'loading';
  if (histogramFreshness === 'current') return 'current';
  if (histogramFreshness === 'stale') return 'degraded';
  if (histogramFreshness === 'unsupported') return 'unavailable';
  return 'loading';
};

const readExif = (exif: ExifData | null, keys: readonly string[]): string | null => {
  for (const key of keys) {
    const value = exif?.[key]?.trim();
    if (value) return value;
  }
  return null;
};

const formatFNumber = (value: string | null): string | null => {
  if (value === null) return null;
  if (/^f\//iu.test(value)) return value;
  const fraction = /^(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)$/u.exec(value);
  const numeric = fraction ? Number(fraction[1]) / Number(fraction[2]) : Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return `f/${value}`;
  return `f/${Number.isInteger(numeric) ? numeric.toFixed(0) : numeric.toFixed(numeric < 10 ? 1 : 0)}`;
};

const formatExposure = (value: string | null): string | null => {
  if (value === null) return null;
  if (/\b(?:s|sec|second)s?\b/iu.test(value)) return value;
  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric > 0 && numeric < 1) return `1/${Math.round(1 / numeric)} s`;
  return `${value} s`;
};

const formatFocalLength = (value: string | null): string | null => {
  if (value === null) return null;
  return /mm/iu.test(value) ? value : `${value} mm`;
};

export const formatDevelopPhotoMetadata = (exif: ExifData | null): DevelopPhotoMetadata => {
  const make = readExif(exif, ['Make']);
  const model = readExif(exif, ['Model', 'CameraModelName']);
  const camera =
    model === null
      ? make
      : make === null || model.toLowerCase().includes(make.toLowerCase())
        ? model
        : `${make} ${model}`;
  const focalLength = formatFocalLength(readExif(exif, ['FocalLengthIn35mmFilm', 'FocalLength']));
  const exposure = formatExposure(readExif(exif, ['ExposureTime']));
  const aperture = formatFNumber(readExif(exif, ['FNumber']));
  const iso = readExif(exif, ['PhotographicSensitivity', 'ISOSpeedRatings', 'ISO']);
  const settings = [focalLength, exposure, aperture, iso === null ? null : `ISO ${iso}`]
    .filter((value): value is string => value !== null)
    .join(' · ');
  return { camera, settings: settings || null };
};

export default function InspectorAnalyticsHeader({
  includeDevelopToolStrip = false,
  testId,
}: InspectorAnalyticsHeaderProps) {
  const { t } = useTranslation();
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
  const [hoverSample, setHoverSample] = useState<HistogramHoverSample | null>(null);
  const {
    showClipping,
    setEditor,
    activeWaveformChannel,
    exportSoftProofRecipeId,
    exportSoftProofTransform,
    gamutWarningOverlay,
    histogram,
    editDocumentV2,
    isExportSoftProofEnabled,
    isWaveformVisible,
    panelScopesLayout,
    previewScopeStatus,
    previewScopeRecoveryRequestId,
    previewScopeRecoveryState,
    selectedImage,
    basicToneSliderInteraction,
    waveform,
    waveformHeight,
  } = useEditorStore(
    useShallow((state) => ({
      showClipping: state.showClipping,
      setEditor: state.setEditor,
      activeWaveformChannel: state.activeWaveformChannel,
      exportSoftProofRecipeId: state.exportSoftProofRecipeId,
      exportSoftProofTransform: state.exportSoftProofTransform,
      gamutWarningOverlay: state.gamutWarningOverlay,
      histogram: state.histogram,
      editDocumentV2: state.editDocumentV2,
      isExportSoftProofEnabled: state.isExportSoftProofEnabled,
      isWaveformVisible: state.isWaveformVisible,
      panelScopesLayout: state.panelScopesLayout,
      previewScopeStatus: state.previewScopeStatus,
      previewScopeRecoveryRequestId: state.previewScopeRecoveryRequestId,
      previewScopeRecoveryState: state.previewScopeRecoveryState,
      selectedImage: state.selectedImage,
      basicToneSliderInteraction: state.basicToneSliderInteraction,
      waveform: state.waveform,
      waveformHeight: state.waveformHeight,
    })),
  );
  const clippingEnabled = showClipping;
  const currentHeight = waveformHeight || PANEL_SCOPES_HEIGHT.default;
  const selectedImagePath = selectedImage?.path ?? null;
  const scopeFreshness = getPreviewScopeFreshnessStatus(previewScopeStatus, selectedImagePath);
  const histogramFreshness = getPreviewHistogramFreshnessStatus(previewScopeStatus, selectedImagePath);
  const proofStatus = getRenderedPreviewWarningStatus(gamutWarningOverlay, {
    exportSoftProofRecipeId,
    exportSoftProofTransform,
    isExportSoftProofEnabled,
    selectedImagePath,
  });
  const diagnosticRow = buildColorOutputProofingDiagnosticRow(
    buildColorOutputProofingDiagnostics({
      activeDisplayProfile: null,
      currentGamutWarningOverlay: proofStatus.state === 'current' ? gamutWarningOverlay : null,
      displayProfileError: null,
      displayProfileLoading: false,
      displayPreviewLutStatus: null,
      exportSoftProofRecipeId,
      exportSoftProofTransform,
      previewScopeFreshnessStatus: scopeFreshness,
      previewScopeWarningCodes: previewScopeStatus?.warningCodes ?? [],
      renderedPreviewWarningStatus: proofStatus,
    }),
  );
  const analyticsState = resolveHistogramHeaderState({
    hasImage: selectedImage !== null,
    histogramFreshness: histogramFreshness.state,
    imageReady: selectedImage?.isReady ?? false,
    recoveryState: previewScopeRecoveryState,
    scopeStatusPresent: previewScopeStatus !== null,
  });
  const tonalInteractionRef = useRef<{
    id: string;
    identity: BasicToneCommitIdentity;
    key: BasicAdjustment;
    zone: HistogramTonalZone;
  } | null>(null);
  const tonalZoneValues = useMemo(() => {
    const params = selectEditDocumentNode(editDocumentV2, 'scene_global_color_tone').params;
    const values: Partial<Record<BasicAdjustment, number>> = { ...params };
    const interaction = basicToneSliderInteraction;
    if (interaction !== null) values[interaction.key] = interaction.latestValue;
    return values;
  }, [basicToneSliderInteraction, editDocumentV2]);
  const cancelTonalInteraction = useCallback(() => {
    const interaction = tonalInteractionRef.current;
    if (interaction !== null) {
      useEditorStore.getState().cancelBasicToneSliderInteraction(interaction.id);
      tonalInteractionRef.current = null;
    }
  }, []);
  const beginTonalInteraction = useCallback(
    (zone: HistogramTonalZone) => {
      if (analyticsState !== 'current') return;
      const state = useEditorStore.getState();
      if (state.basicToneSliderInteraction !== null) return;
      const identity = captureBasicToneCommitIdentity(state);
      if (identity === null) return;
      const config = getHistogramTonalZoneConfig(zone);
      const interactionId = crypto.randomUUID();
      if (state.beginBasicToneSliderInteraction(identity, config.adjustment, interactionId)) {
        tonalInteractionRef.current = { id: interactionId, identity, key: config.adjustment, zone };
      }
    },
    [analyticsState],
  );
  const updateTonalInteraction = useCallback((zone: HistogramTonalZone, value: number) => {
    const interaction = tonalInteractionRef.current;
    const config = getHistogramTonalZoneConfig(zone);
    if (interaction === null || interaction.zone !== zone || interaction.key !== config.adjustment) return;
    useEditorStore.getState().updateBasicToneSliderInteraction(interaction.id, value);
  }, []);
  const commitTonalInteraction = useCallback((zone: HistogramTonalZone) => {
    const interaction = tonalInteractionRef.current;
    if (interaction === null || interaction.zone !== zone) return;
    useEditorStore.getState().commitBasicToneSliderInteraction(interaction.id);
    tonalInteractionRef.current = null;
  }, []);
  const resetTonalInteraction = useCallback(
    (zone: HistogramTonalZone) => {
      const config = getHistogramTonalZoneConfig(zone);
      beginTonalInteraction(zone);
      const interaction = tonalInteractionRef.current;
      if (interaction === null || interaction.key !== config.adjustment) return;
      useEditorStore.getState().updateBasicToneSliderInteraction(interaction.id, 0);
      useEditorStore.getState().commitBasicToneSliderInteraction(interaction.id);
      tonalInteractionRef.current = null;
    },
    [beginTonalInteraction],
  );
  useEffect(() => {
    return () => cancelTonalInteraction();
  }, [cancelTonalInteraction, selectedImage?.path]);
  useEffect(() => {
    if (tonalInteractionRef.current !== null && useEditorStore.getState().basicToneSliderInteraction === null) {
      tonalInteractionRef.current = null;
    }
  }, [basicToneSliderInteraction]);
  const stateLabel = t(`ui.waveform.header.states.${analyticsState}`, {
    defaultValue: stateFallbacks[analyticsState],
  });
  const clippingSummary = analyticsState === 'current' ? getHistogramClippingSummary(histogram) : null;
  const metadata = formatDevelopPhotoMetadata(selectedImage?.exif ?? null);
  const filename = selectedImage?.path.split('/').at(-1) ?? null;
  const photoIdentity = metadata.camera ?? filename ?? t('ui.waveform.header.photo', { defaultValue: 'Photo' });
  const photoSettings =
    metadata.settings ??
    (selectedImage === null
      ? null
      : t('ui.waveform.header.dimensions', {
          defaultValue: '{{width}} × {{height}}',
          height: selectedImage.height,
          width: selectedImage.width,
        }));
  const zoneLabel = hoverSample
    ? t(`ui.waveform.header.zones.${hoverSample.zone}`, { defaultValue: hoverSample.zone })
    : null;
  const clippingLabel = clippingEnabled
    ? t('ui.waveform.tooltips.hideClipping')
    : t('ui.waveform.tooltips.showClipping');
  const recoverScopesLabel = t('ui.waveform.header.retry', { defaultValue: 'Retry histogram' });
  const proofLabel = isExportSoftProofEnabled
    ? t('ui.waveform.header.proofOn', { defaultValue: 'Proof on: {{coverage}}', coverage: proofStatus.coverageLabel })
    : t('ui.waveform.header.proofOff', { defaultValue: 'Proof off' });
  const tonalZoneEditor = useMemo<HistogramTonalZoneEditor>(
    () => ({
      enabled: analyticsState === 'current' && selectedImage?.isReady === true,
      onInteractionCancel: cancelTonalInteraction,
      onInteractionChange: updateTonalInteraction,
      onInteractionCommit: commitTonalInteraction,
      onInteractionReset: resetTonalInteraction,
      onInteractionStart: beginTonalInteraction,
      values: tonalZoneValues,
    }),
    [
      analyticsState,
      beginTonalInteraction,
      cancelTonalInteraction,
      commitTonalInteraction,
      resetTonalInteraction,
      selectedImage?.isReady,
      tonalZoneValues,
      updateTonalInteraction,
    ],
  );

  const toggleClipping = useCallback(() => {
    if (analyticsState !== 'current') return;
    setEditor({ showClipping: !showClipping });
  }, [analyticsState, setEditor, showClipping]);

  const openOutputControls = useCallback(() => {
    requestColorOutputFocus();
    setRightPanel(Panel.Color);
    requestAnimationFrame(() => {
      document.querySelector<HTMLElement>('[data-testid="color-workspace-tab-output"]')?.focus();
    });
  }, [setRightPanel]);

  const recoverScopes = useCallback(() => {
    if (!selectedImage?.isReady || previewScopeRecoveryState === 'loading') return;
    useEditorStore.getState().setEditor({
      previewScopeRecoveryError: null,
      previewScopeRecoveryRequestId: previewScopeRecoveryRequestId + 1,
      previewScopeRecoveryState: 'loading',
    });
  }, [previewScopeRecoveryRequestId, previewScopeRecoveryState, selectedImage?.isReady]);

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
      aria-label={t('ui.waveform.header.region', { defaultValue: 'Photo histogram and metadata' })}
      className="shrink-0 border-b border-editor-border bg-editor-panel"
      data-active-waveform-channel={activeWaveformChannel}
      data-analytics-state={analyticsState}
      data-panel-scopes-height={currentHeight}
      data-panel-scopes-layout={panelScopesLayout}
      data-preview-scope-diagnostic-code={diagnosticRow.code}
      data-preview-histogram-freshness={histogramFreshness.state}
      data-preview-scope-freshness={scopeFreshness.state}
      data-preview-scope-status-label={stateLabel}
      data-preview-scope-transform-fingerprint={diagnosticRow.fingerprint ?? ''}
      data-show-clipping={String(clippingEnabled)}
      data-state={isWaveformVisible ? 'advanced-open' : 'histogram'}
      data-testid={testId}
    >
      <HistogramHeaderSurface
        analyticsState={analyticsState}
        clippingEnabled={clippingEnabled}
        clippingLabel={clippingLabel}
        clippingSummary={clippingSummary}
        histogram={histogram}
        hoverSample={hoverSample}
        isAdvancedOpen={isWaveformVisible}
        onHoverSample={setHoverSample}
        onRetry={recoverScopes}
        onToggleAdvanced={onToggleWaveform}
        onToggleClipping={toggleClipping}
        photoIdentity={photoIdentity}
        photoSettings={photoSettings}
        retryDisabled={!selectedImage?.isReady || previewScopeRecoveryState === 'loading'}
        retryLabel={recoverScopesLabel}
        stateLabel={stateLabel}
        testId={testId}
        tonalZoneEditor={tonalZoneEditor}
        toolStrip={includeDevelopToolStrip ? <DevelopToolStrip /> : undefined}
        zoneLabel={zoneLabel}
      />
      <AdvancedScopesDrawer
        activeMode={activeWaveformChannel}
        analyticsCurrent={analyticsState === 'current'}
        clippingEnabled={clippingEnabled}
        currentHeight={currentHeight}
        histogram={histogram}
        isOpen={isWaveformVisible}
        isResizing={isResizingWaveform}
        layout={panelScopesLayout}
        onModeKeyDown={handleModeKeyDown}
        onOpenOutput={openOutputControls}
        onResetHeight={resetWaveformHeight}
        onResize={handleWaveformResize}
        onSelectMode={setActiveWaveformChannel}
        onSetLayout={setPanelScopesLayout}
        onToggleClipping={toggleClipping}
        previewScopeStatus={previewScopeStatus}
        proofLabel={proofLabel}
        proofState={proofStatus.state}
        testId={testId}
        theme={theme}
        waveform={waveform}
      />
    </section>
  );
}
