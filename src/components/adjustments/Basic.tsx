import cx from 'clsx';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { EditDocumentNodeParamsV2 } from '../../../packages/rawengine-schema/src/editDocumentV2';
import { useEditorStore } from '../../store/useEditorStore';
import { useUIStore } from '../../store/useUIStore';
import { Invokes } from '../../tauri/commands';
import { BasicAdjustment, INITIAL_ADJUSTMENTS } from '../../utils/adjustments';
import { type BasicToneCommitIdentity, buildBasicToneEditTransaction } from '../../utils/basicToneEditTransaction';
import { invokeWithSchema } from '../../utils/tauriSchemaInvoke';
import {
  buildToneEqualizerEditTransaction,
  isCurrentToneEqualizerAsyncRequest,
} from '../../utils/toneEqualizerEditTransaction';
import { toneEqualizerPlacementResponseSchema } from '../../utils/toneEqualizerPicker';
import type { AppSettings } from '../ui/AppProperties';
import { compactInspectorSliderTokens } from '../ui/inspectorTokens';
import InspectorSegmentedControl from '../ui/primitives/InspectorSegmentedControl';
import AdjustmentSlider from './AdjustmentSlider';

export type BasicAdjustmentView = EditDocumentNodeParamsV2<'scene_global_color_tone'> &
  EditDocumentNodeParamsV2<'scene_to_view_transform'> &
  EditDocumentNodeParamsV2<'tone_equalizer'>;
export type BasicAdjustmentUpdate = Partial<BasicAdjustmentView> | ((prev: BasicAdjustmentView) => BasicAdjustmentView);

interface BasicAdjustmentsProps {
  adjustments: BasicAdjustmentView;
  setAdjustments: (adjustments: AdjustmentUpdate) => void;
  isForMask?: boolean;
  onRequireEditGraphV2?: () => void;
  onDragStateChange?: ((isDragging: boolean) => void) | undefined;
  appSettings?: Pick<AppSettings, 'tonemapperOverrideEnabled'> | null;
}

interface ToneMapperSwitchProps {
  selectedMapper: BasicAdjustmentView['toneMapper'];
  onMapperChange: (mapper: BasicAdjustmentView['toneMapper']) => void;
  onReset: () => void;
}

type AdjustmentUpdate = BasicAdjustmentUpdate;

const TONE_ZONE_LABELS = ['−8 EV', '−6 EV', '−4 EV', '−2 EV', '0 EV', '+2 EV', '+4 EV', '+6 EV', '+8 EV'];

const TONE_CONTROL_ORDER = [
  BasicAdjustment.Contrast,
  BasicAdjustment.Highlights,
  BasicAdjustment.Shadows,
  BasicAdjustment.Whites,
  BasicAdjustment.Blacks,
] as const;

const ToneMapperSwitch = ({ selectedMapper, onMapperChange, onReset }: ToneMapperSwitchProps) => {
  const { t } = useTranslation();
  const [isLabelHovered, setIsLabelHovered] = useState(false);
  const isModified = selectedMapper !== INITIAL_ADJUSTMENTS.toneMapper;
  const toneMapperOptions = useMemo(
    () => [
      {
        label: t('adjustments.basic.mappers.rapidView'),
        value: 'rapidView' as const,
      },
      {
        label: t('adjustments.basic.mappers.basic'),
        value: 'basic' as const,
      },
      {
        label: t('adjustments.basic.mappers.agx'),
        value: 'agx' as const,
      },
    ],
    [t],
  );

  return (
    <div
      className={cx(compactInspectorSliderTokens.root, 'mb-0.5 max-[319px]:grid-cols-[minmax(0,1fr)_3.5rem]')}
      data-modified={String(isModified)}
      data-testid="basic-tone-mapper"
    >
      {isModified ? <span className="sr-only">{t('ui.slider.modified', { defaultValue: 'Modified' })}</span> : null}
      <button
        className={compactInspectorSliderTokens.labelButton}
        data-testid="basic-tone-mapper-label"
        onClick={onReset}
        onDoubleClick={onReset}
        onMouseEnter={() => {
          setIsLabelHovered(true);
        }}
        onMouseLeave={() => {
          setIsLabelHovered(false);
        }}
        type="button"
      >
        <span
          aria-hidden={isLabelHovered}
          className={cx(compactInspectorSliderTokens.label, isLabelHovered ? 'opacity-0' : 'opacity-100')}
          data-tooltip={t('adjustments.basic.toneMapper')}
        >
          {t('adjustments.basic.toneMapper')}
        </span>
        <span
          aria-hidden={!isLabelHovered}
          className={cx(compactInspectorSliderTokens.resetLabel, isLabelHovered ? 'opacity-100' : 'opacity-0')}
        >
          {t('adjustments.basic.reset')}
        </span>
      </button>
      <InspectorSegmentedControl
        ariaLabel={t('adjustments.basic.toneMapper')}
        className="col-span-2 min-w-0 max-[319px]:col-span-2 max-[319px]:col-start-1 max-[319px]:row-start-2"
        onChange={onMapperChange}
        options={toneMapperOptions}
        value={selectedMapper}
      />
    </div>
  );
};

export default function BasicAdjustments({
  adjustments,
  setAdjustments,
  isForMask = false,
  onRequireEditGraphV2,
  onDragStateChange,
  appSettings,
}: BasicAdjustmentsProps) {
  const { t } = useTranslation();
  const [toneAdvancedOpen, setToneAdvancedOpen] = useState(false);
  const [tonePlacementStatus, setTonePlacementStatus] = useState<string | null>(null);
  const [toneHistogram, setToneHistogram] = useState<number[]>([]);
  const toneEqualizerPickerActive = useUIStore((state) => state.toneEqualizerPickerActive);
  const toneEqualizerPickerReceipt = useUIStore((state) => state.toneEqualizerPickerReceipt);
  const setUI = useUIStore((state) => state.setUI);
  const adjustmentRevision = useEditorStore((state) => state.adjustmentRevision);
  const applyEditTransaction = useEditorStore((state) => state.applyEditTransaction);
  const beginBasicToneSliderInteraction = useEditorStore((state) => state.beginBasicToneSliderInteraction);
  const updateBasicToneSliderInteraction = useEditorStore((state) => state.updateBasicToneSliderInteraction);
  const commitBasicToneSliderInteraction = useEditorStore((state) => state.commitBasicToneSliderInteraction);
  const cancelBasicToneSliderInteraction = useEditorStore((state) => state.cancelBasicToneSliderInteraction);
  const imageSessionId = useEditorStore(
    (state) => state.imageSession?.id ?? `editor-image-session:${String(state.imageSessionId)}`,
  );
  const selectedImagePath = useEditorStore((state) => state.selectedImage?.path ?? null);
  const basicToneCommitIdentity = useMemo<BasicToneCommitIdentity | null>(
    () =>
      !isForMask && selectedImagePath !== null
        ? { adjustmentRevision, imageSessionId, sourceIdentity: selectedImagePath }
        : null,
    [adjustmentRevision, imageSessionId, isForMask, selectedImagePath],
  );
  const basicToneCommitIdentityRef = useRef(basicToneCommitIdentity);
  basicToneCommitIdentityRef.current = basicToneCommitIdentity;
  const basicToneSliderInteractionIdsRef = useRef<Partial<Record<BasicAdjustment, string>>>({});
  const tonePlacementRequestGenerationRef = useRef(0);
  const toneHistogramPath = useMemo(() => {
    if (toneHistogram.length === 0) return '';
    const peak = Math.max(1, ...toneHistogram);
    const points = toneHistogram.map((count, index) => {
      const x = (index / Math.max(1, toneHistogram.length - 1)) * 320;
      const y = 31 - (count / peak) * 29;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    });
    return `M 0,32 L ${points.join(' L ')} L 320,32 Z`;
  }, [toneHistogram]);

  const handleAdjustmentChange = (key: BasicAdjustment, value: number) => {
    if (!isForMask) {
      const activeInteractionId = basicToneSliderInteractionIdsRef.current[key];
      if (activeInteractionId !== undefined) {
        updateBasicToneSliderInteraction(activeInteractionId, value);
        return;
      }
      const identity = basicToneCommitIdentityRef.current;
      if (identity === null) return;
      const result = applyEditTransaction(
        buildBasicToneEditTransaction(useEditorStore.getState(), identity, key, value, crypto.randomUUID()),
      );
      basicToneCommitIdentityRef.current = {
        ...identity,
        adjustmentRevision: result.nextAdjustmentRevision,
      };
      return;
    }
    setAdjustments((prev: BasicAdjustmentView) => ({ ...prev, [key]: value }));
  };

  const beginBasicSliderInteraction = (key: BasicAdjustment) => {
    if (isForMask) {
      onDragStateChange?.(true);
      return;
    }
    const identity = basicToneCommitIdentityRef.current;
    if (identity === null) return;
    const interactionId = crypto.randomUUID();
    if (beginBasicToneSliderInteraction(identity, key, interactionId)) {
      basicToneSliderInteractionIdsRef.current[key] = interactionId;
    }
  };

  const commitBasicSliderInteraction = (key: BasicAdjustment) => {
    if (isForMask) {
      onDragStateChange?.(false);
      return;
    }
    const interactionId = basicToneSliderInteractionIdsRef.current[key];
    if (interactionId === undefined) return;
    delete basicToneSliderInteractionIdsRef.current[key];
    const result = commitBasicToneSliderInteraction(interactionId);
    if (result !== null) {
      const identity = basicToneCommitIdentityRef.current;
      if (identity !== null) {
        basicToneCommitIdentityRef.current = { ...identity, adjustmentRevision: result.nextAdjustmentRevision };
      }
    }
  };

  const cancelBasicSliderInteraction = (key: BasicAdjustment) => {
    if (isForMask) {
      onDragStateChange?.(false);
      return;
    }
    const interactionId = basicToneSliderInteractionIdsRef.current[key];
    if (interactionId === undefined) return;
    delete basicToneSliderInteractionIdsRef.current[key];
    cancelBasicToneSliderInteraction(interactionId);
  };

  useEffect(
    () => () => {
      for (const interactionId of Object.values(basicToneSliderInteractionIdsRef.current)) {
        if (interactionId !== undefined) cancelBasicToneSliderInteraction(interactionId);
      }
      basicToneSliderInteractionIdsRef.current = {};
    },
    [adjustmentRevision, cancelBasicToneSliderInteraction, imageSessionId, selectedImagePath],
  );

  const handleToneMapperChange = (mapper: BasicAdjustmentView['toneMapper']) => {
    setAdjustments((prev: BasicAdjustmentView) => ({
      ...prev,
      toneMapper: mapper,
    }));
  };

  const handleToneMapperReset = () => {
    setAdjustments((prev: BasicAdjustmentView) => ({
      ...prev,
      toneMapper: INITIAL_ADJUSTMENTS.toneMapper,
    }));
  };

  const handleViewSettingChange = (key: keyof BasicAdjustmentView['viewTransform'], value: number) => {
    setAdjustments((prev: BasicAdjustmentView) => ({
      ...prev,
      viewTransform: { ...prev.viewTransform, [key]: value },
    }));
  };

  const commitToneEqualizerAtIdentity = (
    identity: BasicToneCommitIdentity,
    patch: Partial<BasicAdjustmentView['toneEqualizer']>,
  ) => {
    const result = applyEditTransaction(
      buildToneEqualizerEditTransaction(useEditorStore.getState(), identity, patch, crypto.randomUUID()),
    );
    basicToneCommitIdentityRef.current = {
      ...identity,
      adjustmentRevision: result.nextAdjustmentRevision,
    };
  };

  const updateToneEqualizer = (patch: Partial<BasicAdjustmentView['toneEqualizer']>) => {
    tonePlacementRequestGenerationRef.current += 1;
    if (!isForMask) {
      const identity = basicToneCommitIdentityRef.current;
      if (identity === null) {
        setAdjustments((prev: BasicAdjustmentView) => ({
          ...prev,
          rawEngineEditGraphVersion: 2,
          toneEqualizer: { ...prev.toneEqualizer, ...patch },
        }));
        return;
      }
      commitToneEqualizerAtIdentity(identity, patch);
      return;
    }
    onRequireEditGraphV2?.();
    setAdjustments((prev: BasicAdjustmentView) => ({
      ...prev,
      toneEqualizer: { ...prev.toneEqualizer, ...patch },
    }));
  };

  const updateToneBand = (index: number, value: number) => {
    const bandEv = [...adjustments.toneEqualizer.bandEv] as BasicAdjustmentView['toneEqualizer']['bandEv'];
    bandEv[index] = value;
    updateToneEqualizer({ bandEv, enabled: true, selectedBand: index });
  };

  const autoPlaceToneEqualizer = async () => {
    const identity = basicToneCommitIdentityRef.current;
    if (!selectedImagePath || (!isForMask && identity === null)) return;
    const requestGeneration = ++tonePlacementRequestGenerationRef.current;
    const expectedSourceIdentity = identity?.sourceIdentity ?? selectedImagePath;
    setTonePlacementStatus(t('adjustments.basic.toneEqualizer.analyzing'));
    try {
      const placement = await invokeWithSchema(
        Invokes.AnalyzeToneEqualizerPlacement,
        { expectedSourceIdentity },
        toneEqualizerPlacementResponseSchema,
      );
      const currentState = useEditorStore.getState();
      const requestIsCurrent =
        placement.sourceIdentity === expectedSourceIdentity &&
        (identity === null
          ? requestGeneration === tonePlacementRequestGenerationRef.current &&
            currentState.selectedImage?.path === expectedSourceIdentity
          : isCurrentToneEqualizerAsyncRequest(
              currentState,
              identity,
              requestGeneration,
              tonePlacementRequestGenerationRef.current,
            ));
      if (!requestIsCurrent) return;
      const patch = {
        autoPlacement: true,
        enabled: true,
        pivotEv: placement.pivotEv,
        rangeEv: placement.rangeEv,
      };
      if (identity === null) {
        onRequireEditGraphV2?.();
        setAdjustments((prev: BasicAdjustmentView) => ({
          ...prev,
          toneEqualizer: { ...prev.toneEqualizer, ...patch },
        }));
      } else {
        commitToneEqualizerAtIdentity(identity, patch);
      }
      setTonePlacementStatus(
        `${placement.sceneBlackEv.toFixed(1)}…${placement.sceneWhiteEv.toFixed(1)} EV · ${Math.round(placement.confidence * 100)}%`,
      );
      setToneHistogram(placement.histogram);
    } catch {
      const currentState = useEditorStore.getState();
      if (
        identity !== null &&
        !isCurrentToneEqualizerAsyncRequest(
          currentState,
          identity,
          requestGeneration,
          tonePlacementRequestGenerationRef.current,
        )
      )
        return;
      if (
        identity === null &&
        (requestGeneration !== tonePlacementRequestGenerationRef.current ||
          currentState.selectedImage?.path !== expectedSourceIdentity)
      )
        return;
      setTonePlacementStatus(t('adjustments.basic.toneEqualizer.analysisUnavailable'));
    }
  };

  const renderSlider = (key: BasicAdjustment, label: string, range: { max: number; min: number; step: number }) => (
    <AdjustmentSlider
      defaultValue={INITIAL_ADJUSTMENTS[key]}
      density="compact"
      label={label}
      max={range.max}
      min={range.min}
      onInteractionCancel={() => cancelBasicSliderInteraction(key)}
      onInteractionCommit={() => commitBasicSliderInteraction(key)}
      onInteractionStart={() => beginBasicSliderInteraction(key)}
      onValueChange={(value) => {
        handleAdjustmentChange(key, value);
      }}
      step={range.step}
      testId={`basic-control-${key}`}
      value={adjustments[key]}
    />
  );

  const hideToneMapper = isForMask || appSettings?.tonemapperOverrideEnabled;
  const toneLabels: Record<(typeof TONE_CONTROL_ORDER)[number], string> = {
    [BasicAdjustment.Blacks]: t('adjustments.basic.blacks'),
    [BasicAdjustment.Contrast]: t('adjustments.basic.contrast'),
    [BasicAdjustment.Highlights]: t('adjustments.basic.highlights'),
    [BasicAdjustment.Shadows]: t('adjustments.basic.shadows'),
    [BasicAdjustment.Whites]: t('adjustments.basic.whites'),
  };

  return (
    <div
      className="min-w-0 space-y-px"
      data-commit-adjustment-revision={basicToneCommitIdentity?.adjustmentRevision}
      data-commit-image-session={basicToneCommitIdentity?.imageSessionId}
      data-commit-source-identity={basicToneCommitIdentity?.sourceIdentity}
      data-testid="basic-light-controls"
    >
      {!hideToneMapper && (
        <ToneMapperSwitch
          selectedMapper={adjustments.toneMapper}
          onMapperChange={handleToneMapperChange}
          onReset={handleToneMapperReset}
        />
      )}

      {!hideToneMapper && adjustments.toneMapper === 'rapidView' ? (
        <div className="border-b border-editor-divider pb-1" data-testid="rapid-view-controls">
          <AdjustmentSlider
            defaultValue={INITIAL_ADJUSTMENTS.viewTransform.contrast}
            density="compact"
            label={t('adjustments.basic.viewContrast')}
            max={2}
            min={0.5}
            onValueChange={(value) => handleViewSettingChange('contrast', value)}
            step={0.01}
            testId="rapid-view-contrast"
            value={adjustments.viewTransform.contrast}
          />
          <AdjustmentSlider
            defaultValue={INITIAL_ADJUSTMENTS.viewTransform.shoulder}
            density="compact"
            label={t('adjustments.basic.highlightRolloff')}
            max={1}
            min={0}
            onValueChange={(value) => handleViewSettingChange('shoulder', value)}
            step={0.01}
            testId="rapid-view-shoulder"
            value={adjustments.viewTransform.shoulder}
          />
          <AdjustmentSlider
            defaultValue={INITIAL_ADJUSTMENTS.viewTransform.toe}
            density="compact"
            label={t('adjustments.basic.shadowRolloff')}
            max={1}
            min={0}
            onValueChange={(value) => handleViewSettingChange('toe', value)}
            step={0.01}
            testId="rapid-view-toe"
            value={adjustments.viewTransform.toe}
          />
        </div>
      ) : null}

      {renderSlider(BasicAdjustment.Exposure, t('adjustments.basic.evShift'), {
        max: 5,
        min: -5,
        step: 0.01,
      })}

      {TONE_CONTROL_ORDER.map((key) => (
        <div key={key}>{renderSlider(key, toneLabels[key], { max: 100, min: -100, step: 1 })}</div>
      ))}

      {!isForMask || adjustments.toneEqualizer ? (
        <div className="mt-1 border-t border-editor-divider pt-1" data-testid="tone-equalizer-panel">
          <div className="flex items-center justify-between gap-2 px-1 py-1">
            <button
              className="min-w-0 truncate text-left text-xs text-editor-text"
              data-testid="tone-equalizer-advanced-toggle"
              onClick={() => setToneAdvancedOpen((open) => !open)}
              type="button"
            >
              {t('adjustments.basic.toneEqualizer.title')} {toneAdvancedOpen ? '▾' : '▸'}
            </button>
            <button
              className="rounded border border-editor-divider px-1.5 py-0.5 text-[10px] text-editor-text"
              data-testid="tone-equalizer-enable"
              onClick={() => updateToneEqualizer({ enabled: !adjustments.toneEqualizer.enabled })}
              type="button"
            >
              {adjustments.toneEqualizer.enabled
                ? t('adjustments.basic.toneEqualizer.on')
                : t('adjustments.basic.toneEqualizer.enable')}
            </button>
          </div>
          {toneAdvancedOpen ? (
            <div className="space-y-px" data-testid="tone-equalizer-advanced">
              <div className="grid grid-cols-3 gap-1 px-1 pb-1">
                <button
                  className="rounded border border-editor-divider px-1 py-0.5 text-[10px] text-editor-text"
                  data-testid="tone-equalizer-auto-place"
                  onClick={() => void autoPlaceToneEqualizer()}
                  type="button"
                >
                  {t('adjustments.basic.toneEqualizer.autoPlace')}
                </button>
                {!isForMask ? (
                  <button
                    aria-pressed={toneEqualizerPickerActive}
                    className="rounded border border-editor-divider px-1 py-0.5 text-[10px] text-editor-text aria-pressed:bg-editor-accent/20"
                    data-testid="tone-equalizer-picker"
                    onClick={() =>
                      setUI({
                        toneEqualizerPickerActive: !toneEqualizerPickerActive,
                        toneEqualizerPickerReceipt: null,
                      })
                    }
                    type="button"
                  >
                    {t('adjustments.basic.toneEqualizer.pickZone')}
                  </button>
                ) : null}
                <button
                  className="rounded border border-editor-divider px-1 py-0.5 text-[10px] text-editor-text"
                  onClick={() => updateToneEqualizer(structuredClone(INITIAL_ADJUSTMENTS.toneEqualizer))}
                  type="button"
                >
                  {t('adjustments.basic.toneEqualizer.resetZones')}
                </button>
              </div>
              {tonePlacementStatus ? (
                <p className="px-1 text-[10px] text-editor-text-muted">{tonePlacementStatus}</p>
              ) : null}
              {toneEqualizerPickerReceipt?.sourceIdentity === selectedImagePath ? (
                <p className="px-1 text-[10px] text-editor-text-muted" data-testid="tone-equalizer-picker-receipt">
                  {t('adjustments.basic.toneEqualizer.pickerReceipt', {
                    band: toneEqualizerPickerReceipt.primaryBand + 1,
                    ev: toneEqualizerPickerReceipt.exposureEv.toFixed(2),
                  })}
                </p>
              ) : null}
              {toneHistogram.length > 0 ? (
                <svg
                  aria-label={t('adjustments.basic.toneEqualizer.histogram')}
                  className="h-8 w-full px-1 text-editor-text-muted/45"
                  data-testid="tone-equalizer-histogram"
                  preserveAspectRatio="none"
                  role="img"
                  viewBox="0 0 320 32"
                >
                  <path d={toneHistogramPath} fill="currentColor" />
                </svg>
              ) : null}
              {adjustments.toneEqualizer.bandEv.map((value, index) => (
                <AdjustmentSlider
                  defaultValue={0}
                  density="compact"
                  key={TONE_ZONE_LABELS[index]}
                  label={TONE_ZONE_LABELS[index] ?? `${index}`}
                  max={4}
                  min={-4}
                  onDragStateChange={onDragStateChange}
                  onValueChange={(next) => updateToneBand(index, next)}
                  step={0.05}
                  testId={`tone-equalizer-band-${index}`}
                  value={value}
                />
              ))}
              <AdjustmentSlider
                defaultValue={INITIAL_ADJUSTMENTS.toneEqualizer.detailPreservation}
                density="compact"
                label={t('adjustments.basic.toneEqualizer.detailPreservation')}
                max={1}
                min={0}
                onValueChange={(value) => updateToneEqualizer({ detailPreservation: value })}
                step={0.01}
                testId="tone-equalizer-detail"
                value={adjustments.toneEqualizer.detailPreservation}
              />
              <AdjustmentSlider
                defaultValue={INITIAL_ADJUSTMENTS.toneEqualizer.edgeRefinement}
                density="compact"
                label={t('adjustments.basic.toneEqualizer.edgeRefinement')}
                max={8}
                min={0}
                onValueChange={(value) => updateToneEqualizer({ edgeRefinement: value })}
                step={0.05}
                testId="tone-equalizer-edge"
                value={adjustments.toneEqualizer.edgeRefinement}
              />
              <AdjustmentSlider
                defaultValue={INITIAL_ADJUSTMENTS.toneEqualizer.smoothingRadius}
                density="compact"
                label={t('adjustments.basic.toneEqualizer.smoothingRadius')}
                max={64}
                min={4}
                onValueChange={(value) => updateToneEqualizer({ smoothingRadius: value })}
                step={1}
                testId="tone-equalizer-radius"
                value={adjustments.toneEqualizer.smoothingRadius}
              />
              <div className="grid grid-cols-5 gap-1 px-1 py-1" data-testid="tone-equalizer-preview-modes">
                {(
                  [
                    t('adjustments.basic.toneEqualizer.preview.image'),
                    t('adjustments.basic.toneEqualizer.preview.zones'),
                    t('adjustments.basic.toneEqualizer.preview.band'),
                    t('adjustments.basic.toneEqualizer.preview.filter'),
                    t('adjustments.basic.toneEqualizer.preview.clip'),
                  ] as const
                ).map((label, previewMode) => (
                  <button
                    aria-pressed={adjustments.toneEqualizer.previewMode === previewMode}
                    className="rounded border border-editor-divider px-1 py-0.5 text-[9px] text-editor-text aria-pressed:bg-editor-accent/20"
                    key={label}
                    onClick={() => updateToneEqualizer({ previewMode: previewMode as 0 | 1 | 2 | 3 | 4 })}
                    type="button"
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="mt-1 border-t border-editor-divider pt-1" data-testid="basic-secondary-controls">
        {renderSlider(
          BasicAdjustment.Brightness,
          t('adjustments.basic.brightness', { defaultValue: t('adjustments.basic.exposure') }),
          { max: 5, min: -5, step: 0.01 },
        )}
      </div>
    </div>
  );
}
