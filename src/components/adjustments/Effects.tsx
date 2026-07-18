import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { EditDocumentNodeParamsV2 } from '../../../packages/rawengine-schema/src/editDocumentV2';
import type { FilmStageControlDescriptorV1 } from '../../../packages/rawengine-schema/src/index.js';
import { useEditorStore } from '../../store/useEditorStore';
import { TextVariants } from '../../types/typography';
import { CreativeAdjustment, Effect } from '../../utils/adjustments';
import {
  buildDisplayCreativePatchEditTransaction,
  type DisplayCreativeCommitIdentity,
  type DisplayCreativeNodeAdjustment,
  isDisplayCreativeNodeAdjustment,
} from '../../utils/displayCreativeEditTransaction';
import { selectEditDocumentNode } from '../../utils/editDocumentSelectors';
import { reduceEditTransaction } from '../../utils/editTransaction';
import {
  buildFilmStageOperation,
  FILM_REFERENCE_STAGE_DEFAULT_P,
  getFilmStageControlDescriptors,
} from '../../utils/film-look/filmStageControls';
import { buildFilmGrainPresetAdjustmentPatch, FILM_GRAIN_UI_PRESETS } from '../../utils/filmGrainControls';
import { buildLutClearEditTransaction } from '../../utils/lutEditTransaction';
import FilmStageControls from '../film/FilmStageControls';
import type { AppSettings } from '../ui/AppProperties';
import { editorChromeStatusChipClassName } from '../ui/editorChromeTokens';
import { professionalInspectorDensityTokens } from '../ui/inspectorTokens';
import UiText from '../ui/primitives/Text';
import AdjustmentSlider from './AdjustmentSlider';
import LUTControl from './LUTControl';

export type EffectAdjustmentView = EditDocumentNodeParamsV2<'display_creative'> &
  EditDocumentNodeParamsV2<'film_emulation'> & {
    /** Mask adjustment views carry this legacy section toggle outside display_creative.params. */
    effectsEnabled?: boolean;
  };
export type EffectAdjustmentUpdate =
  | Partial<EffectAdjustmentView>
  | ((prev: EffectAdjustmentView) => EffectAdjustmentView);

interface EffectsPanelProps {
  adjustments: EffectAdjustmentView;
  isForMask: boolean;
  setAdjustments: (adjustments: AdjustmentUpdate) => void;
  handleLutSelect: (path: string) => void;
  appSettings: AppSettings | null;
  onDragStateChange?: ((isDragging: boolean) => void) | undefined;
  onFilmEmulationOperation?:
    | ((
        operation:
          | { kind: 'set_profile'; profileId: string; mix: number }
          | ReturnType<typeof buildFilmStageOperation>
          | { kind: 'reset_to_profile' },
      ) => Promise<void>)
    | undefined;
}

type AdjustmentUpdate = EffectAdjustmentUpdate;

const formatEffectSummaryValue = (value: number) => (value > 0 ? `+${value}` : `${value}`);
const formatEffectSummaryPercent = (value: number) => `${value}%`;
const summaryChipClassName =
  'inline-flex min-h-5 max-w-full items-center gap-1 rounded border border-editor-border bg-editor-panel px-1.5 py-0.5 text-[10px] font-medium leading-3 text-text-secondary';
const summaryChipLabelClassName = 'truncate text-text-tertiary';
const summaryChipValueClassName = 'shrink-0 font-mono tabular-nums text-text-primary';

interface EffectSummaryChip {
  label: string;
  value: string;
}

export default function EffectsPanel({
  adjustments,
  setAdjustments,
  isForMask,
  handleLutSelect,
  appSettings,
  onDragStateChange,
  onFilmEmulationOperation,
}: EffectsPanelProps) {
  const { t } = useTranslation();
  const [filmStageP, setFilmStageP] = useState(FILM_REFERENCE_STAGE_DEFAULT_P);
  const [advancedOpen, setAdvancedOpen] = useState(isForMask);
  const adjustmentRevision = useEditorStore((state) => state.adjustmentRevision);
  const applyEditTransaction = useEditorStore((state) => state.applyEditTransaction);
  const displayCreativeNodeEnabled = useEditorStore(
    (state) => selectEditDocumentNode(state.editDocumentV2, 'display_creative').enabled,
  );
  const imageSessionId = useEditorStore(
    (state) => state.imageSession?.id ?? `editor-image-session:${String(state.imageSessionId)}`,
  );
  const selectedImagePath = useEditorStore((state) => state.selectedImage?.path ?? null);
  const displayCreativeCommitIdentity: DisplayCreativeCommitIdentity | null =
    !isForMask && selectedImagePath !== null
      ? { adjustmentRevision, imageSessionId, sourceIdentity: selectedImagePath }
      : null;
  const displayCreativeCommitIdentityRef = useRef(displayCreativeCommitIdentity);
  displayCreativeCommitIdentityRef.current = displayCreativeCommitIdentity;
  const displayCreativeSliderInteractionsRef = useRef<
    Partial<
      Record<
        DisplayCreativeNodeAdjustment,
        {
          baseEditDocumentV2: ReturnType<typeof useEditorStore.getState>['editDocumentV2'];
          identity: DisplayCreativeCommitIdentity;
          interactionId: string;
          latestValue: number;
        }
      >
    >
  >({});

  const cancelDisplayCreativeSliderInteraction = (key: DisplayCreativeNodeAdjustment) => {
    const interaction = displayCreativeSliderInteractionsRef.current[key];
    if (interaction === undefined) return;
    useEditorStore.getState().publishWhiteBalancePickerPreview(interaction.baseEditDocumentV2);
    delete displayCreativeSliderInteractionsRef.current[key];
    useEditorStore.getState().setEditor({ isSliderDragging: false });
  };

  const beginDisplayCreativeSliderInteraction = (key: DisplayCreativeNodeAdjustment) => {
    if (isForMask || displayCreativeSliderInteractionsRef.current[key] !== undefined) {
      if (isForMask) onDragStateChange?.(true);
      return;
    }
    const identity = displayCreativeCommitIdentityRef.current;
    if (identity === null) return;
    const state = useEditorStore.getState();
    const currentValue = selectEditDocumentNode(state.editDocumentV2, 'display_creative').params[key];
    displayCreativeSliderInteractionsRef.current[key] = {
      baseEditDocumentV2: structuredClone(state.editDocumentV2),
      identity,
      interactionId: crypto.randomUUID(),
      latestValue: currentValue,
    };
    state.setEditor({ isSliderDragging: true });
  };

  const updateDisplayCreativeSliderInteraction = (key: DisplayCreativeNodeAdjustment, value: number) => {
    const interaction = displayCreativeSliderInteractionsRef.current[key];
    if (interaction === undefined) {
      commitDisplayCreativePatch({ [key]: value });
      return;
    }
    const result = reduceEditTransaction(
      interaction.baseEditDocumentV2,
      interaction.identity.adjustmentRevision,
      {
        baseAdjustmentRevision: interaction.identity.adjustmentRevision,
        history: 'none',
        imageSessionId: interaction.identity.imageSessionId,
        operations: [{ nodeType: 'display_creative', patch: { [key]: value }, type: 'patch-edit-document-node' }],
        persistence: 'preview-only',
        source: 'manual-control',
        transactionId: interaction.interactionId,
      },
      interaction.identity.imageSessionId,
    );
    interaction.latestValue = value;
    useEditorStore.getState().publishWhiteBalancePickerPreview(result.after);
  };

  const commitDisplayCreativeSliderInteraction = (key: DisplayCreativeNodeAdjustment) => {
    const interaction = displayCreativeSliderInteractionsRef.current[key];
    if (interaction === undefined) {
      if (isForMask) onDragStateChange?.(false);
      return;
    }
    delete displayCreativeSliderInteractionsRef.current[key];
    try {
      const result = applyEditTransaction(
        buildDisplayCreativePatchEditTransaction(
          useEditorStore.getState(),
          interaction.identity,
          { [key]: interaction.latestValue },
          interaction.interactionId,
        ),
      );
      displayCreativeCommitIdentityRef.current = {
        ...interaction.identity,
        adjustmentRevision: result.nextAdjustmentRevision,
      };
    } catch {
      useEditorStore.getState().publishWhiteBalancePickerPreview(interaction.baseEditDocumentV2);
    } finally {
      useEditorStore.getState().setEditor({ isSliderDragging: false });
    }
  };

  useEffect(() => {
    return () => {
      for (const key of Object.keys(displayCreativeSliderInteractionsRef.current) as DisplayCreativeNodeAdjustment[]) {
        cancelDisplayCreativeSliderInteraction(key);
      }
    };
  }, [adjustmentRevision, imageSessionId, selectedImagePath]);

  useEffect(() => {
    if (isForMask) setAdvancedOpen(true);
  }, [isForMask]);

  const commitDisplayCreativePatch = (patch: Parameters<typeof buildDisplayCreativePatchEditTransaction>[2]) => {
    const identity = displayCreativeCommitIdentityRef.current;
    if (identity === null) return;
    const result = applyEditTransaction(
      buildDisplayCreativePatchEditTransaction(useEditorStore.getState(), identity, patch, crypto.randomUUID()),
    );
    displayCreativeCommitIdentityRef.current = {
      ...identity,
      adjustmentRevision: result.nextAdjustmentRevision,
    };
  };

  const handleAdjustmentChange = (key: string, value: number) => {
    const nextValue = Math.trunc(value);
    if (isDisplayCreativeNodeAdjustment(key)) {
      if (!isForMask) {
        updateDisplayCreativeSliderInteraction(key, nextValue);
        return;
      }
      setAdjustments((prev: EffectAdjustmentView) => ({
        ...prev,
        [key]: nextValue,
      }));
      return;
    }
    setAdjustments((prev: EffectAdjustmentView) => ({
      ...prev,
      [key]: nextValue,
    }));
  };

  const displayCreativeSliderInteractionProps = (key: DisplayCreativeNodeAdjustment) =>
    isForMask
      ? {}
      : {
          onInteractionCancel: () => cancelDisplayCreativeSliderInteraction(key),
          onInteractionCommit: () => commitDisplayCreativeSliderInteraction(key),
          onInteractionStart: () => beginDisplayCreativeSliderInteraction(key),
        };

  const handleLutIntensityChange = (intensity: number) => {
    handleAdjustmentChange(Effect.LutIntensity, intensity);
  };

  const handleLutClear = () => {
    const identity = displayCreativeCommitIdentityRef.current;
    if (identity === null) return;
    const result = applyEditTransaction(
      buildLutClearEditTransaction(useEditorStore.getState(), identity, crypto.randomUUID()),
    );
    displayCreativeCommitIdentityRef.current = { ...identity, adjustmentRevision: result.nextAdjustmentRevision };
  };

  const filmStageDescriptors = getFilmStageControlDescriptors(filmStageP);
  const handleFilmStageChange = (descriptor: FilmStageControlDescriptorV1, value: number) => {
    const operation = buildFilmStageOperation(descriptor, value);
    setFilmStageP(operation.patch.p);
    if (onFilmEmulationOperation !== undefined) void onFilmEmulationOperation(operation);
  };
  const handleFilmStageReset = (descriptor: FilmStageControlDescriptorV1) => {
    if (descriptor.parameterId !== 'reference_luminance_shaper_p') return;
    setFilmStageP(FILM_REFERENCE_STAGE_DEFAULT_P);
    if (onFilmEmulationOperation !== undefined) void onFilmEmulationOperation({ kind: 'reset_to_profile' });
  };

  const handleFilmGrainPresetApply = (preset: (typeof FILM_GRAIN_UI_PRESETS)[number]) => {
    const patch = buildFilmGrainPresetAdjustmentPatch(preset);
    if (!isForMask) {
      commitDisplayCreativePatch(patch);
      return;
    }
    setAdjustments((prev: EffectAdjustmentView) => ({
      ...prev,
      ...patch,
    }));
  };

  const handleEffectsEnabledToggle = () => {
    if (isForMask) {
      setAdjustments((prev: EffectAdjustmentView) => ({
        ...prev,
        effectsEnabled: !(prev.effectsEnabled ?? true),
      }));
      return;
    }
    const identity = displayCreativeCommitIdentityRef.current;
    if (identity === null) return;
    const state = useEditorStore.getState();
    const displayCreativeNode = selectEditDocumentNode(state.editDocumentV2, 'display_creative');
    const result = applyEditTransaction({
      baseAdjustmentRevision: identity.adjustmentRevision,
      history: 'single-entry',
      imageSessionId: identity.imageSessionId,
      operations: [
        {
          enabled: !displayCreativeNode.enabled,
          nodeType: 'display_creative',
          type: 'set-edit-document-node-enabled',
        },
      ],
      persistence: 'commit',
      source: 'manual-control',
      transactionId: crypto.randomUUID(),
    });
    displayCreativeCommitIdentityRef.current = {
      ...identity,
      adjustmentRevision: result.nextAdjustmentRevision,
    };
  };

  const adjustmentVisibility = appSettings?.adjustmentVisibility || {};
  const density = professionalInspectorDensityTokens;
  const effectsEnabled = isForMask ? (adjustments.effectsEnabled ?? true) : displayCreativeNodeEnabled;
  const activeLutName =
    typeof adjustments.lutName === 'string' && adjustments.lutName.length > 0 ? adjustments.lutName : null;
  const activeLutIntensity = adjustments.lutIntensity ?? 100;
  const activeEffectSummaryChips: Array<EffectSummaryChip> = [
    ...(adjustments.filmEmulation !== null
      ? [
          {
            label: t('adjustments.effects.filmLookBrowser.activeLook'),
            value: formatEffectSummaryPercent(Math.round(adjustments.filmEmulation.mix * 100)),
          },
        ]
      : []),
    ...(activeLutName !== null
      ? [
          {
            label: t('adjustments.effects.lut'),
            value:
              activeLutIntensity === 100
                ? activeLutName
                : `${activeLutName} ${formatEffectSummaryPercent(activeLutIntensity)}`,
          },
        ]
      : []),
    ...(adjustments.glowAmount > 0
      ? [{ label: t('adjustments.effects.glow'), value: formatEffectSummaryValue(adjustments.glowAmount) }]
      : []),
    ...(adjustments.halationAmount > 0
      ? [{ label: t('adjustments.effects.halation'), value: formatEffectSummaryValue(adjustments.halationAmount) }]
      : []),
    ...(!isForMask && adjustments.flareAmount > 0
      ? [{ label: t('adjustments.effects.lightFlares'), value: formatEffectSummaryValue(adjustments.flareAmount) }]
      : []),
    ...(!isForMask && adjustmentVisibility['vignette'] !== false && adjustments.vignetteAmount !== 0
      ? [{ label: t('adjustments.effects.vignette'), value: formatEffectSummaryValue(adjustments.vignetteAmount) }]
      : []),
    ...(!isForMask && adjustmentVisibility['grain'] !== false && adjustments.grainAmount > 0
      ? [
          {
            label: t('adjustments.effects.grain'),
            value: `${formatEffectSummaryValue(adjustments.grainAmount)} / ${adjustments.grainSize}`,
          },
        ]
      : []),
  ];

  return (
    <div
      className={density.gutter.section}
      data-commit-adjustment-revision={displayCreativeCommitIdentity?.adjustmentRevision}
      data-commit-image-session={displayCreativeCommitIdentity?.imageSessionId}
      data-commit-source-identity={displayCreativeCommitIdentity?.sourceIdentity}
      data-testid="effects-controls"
    >
      <div
        className="flex items-center justify-between rounded border border-editor-border bg-editor-panel-well px-1.5 py-1"
        data-testid="effects-section-enable"
      >
        <UiText className={density.sectionHeader.title} variant={TextVariants.heading}>
          {t('adjustments.effects.title', { defaultValue: 'Effects' })}
        </UiText>
        <button
          aria-pressed={effectsEnabled}
          className={editorChromeStatusChipClassName(effectsEnabled ? 'success' : 'neutral')}
          data-testid="effects-enable-toggle"
          onClick={handleEffectsEnabledToggle}
          type="button"
        >
          {effectsEnabled
            ? t('adjustments.effects.enabled', { defaultValue: 'On' })
            : t('adjustments.effects.disabled', { defaultValue: 'Off' })}
        </button>
      </div>

      {!isForMask && adjustmentVisibility['vignette'] !== false && (
        <section
          className="rounded border border-editor-border bg-editor-panel-well px-1.5 py-1"
          data-testid="effects-vignette-section"
        >
          <UiText variant={TextVariants.heading} className={density.sectionHeader.title}>
            {t('adjustments.effects.vignette')}
          </UiText>
          <AdjustmentSlider
            {...displayCreativeSliderInteractionProps(Effect.VignetteAmount)}
            density="compact"
            label={t('adjustments.effects.amount')}
            max={100}
            min={-100}
            onValueChange={(value) => {
              handleAdjustmentChange(Effect.VignetteAmount, value);
            }}
            step={1}
            testId="effects-control-vignette-amount"
            value={adjustments.vignetteAmount}
            onDragStateChange={onDragStateChange}
          />
          <AdjustmentSlider
            {...displayCreativeSliderInteractionProps(Effect.VignetteMidpoint)}
            density="compact"
            defaultValue={50}
            label={t('adjustments.effects.midpoint')}
            max={100}
            min={0}
            onValueChange={(value) => {
              handleAdjustmentChange(Effect.VignetteMidpoint, value);
            }}
            step={1}
            testId="effects-control-vignette-midpoint"
            value={adjustments.vignetteMidpoint}
            onDragStateChange={onDragStateChange}
            fillOrigin="min"
          />
          <AdjustmentSlider
            {...displayCreativeSliderInteractionProps(Effect.VignetteRoundness)}
            density="compact"
            label={t('adjustments.effects.roundness')}
            max={100}
            min={-100}
            onValueChange={(value) => {
              handleAdjustmentChange(Effect.VignetteRoundness, value);
            }}
            step={1}
            testId="effects-control-vignette-roundness"
            value={adjustments.vignetteRoundness}
            onDragStateChange={onDragStateChange}
          />
          <AdjustmentSlider
            {...displayCreativeSliderInteractionProps(Effect.VignetteFeather)}
            density="compact"
            defaultValue={50}
            label={t('adjustments.effects.feather')}
            max={100}
            min={0}
            onValueChange={(value) => {
              handleAdjustmentChange(Effect.VignetteFeather, value);
            }}
            step={1}
            testId="effects-control-vignette-feather"
            value={adjustments.vignetteFeather}
            onDragStateChange={onDragStateChange}
            fillOrigin="min"
          />
        </section>
      )}

      {!isForMask && adjustmentVisibility['grain'] !== false && (
        <section
          className="rounded border border-editor-border bg-editor-panel-well px-1.5 py-1"
          data-testid="film-grain-ui-controls"
        >
          <div className={density.sectionHeader.root}>
            <UiText variant={TextVariants.heading} className={density.sectionHeader.title}>
              {t('adjustments.effects.grain')}
            </UiText>
            <span className={editorChromeStatusChipClassName('neutral')} data-testid="film-grain-renderer-status">
              {t('adjustments.effects.grainRendererStatus')}
            </span>
          </div>
          <div className="mb-0.5 grid grid-cols-3 gap-1" data-testid="film-grain-preset-shortcuts">
            {FILM_GRAIN_UI_PRESETS.map((preset) => (
              <button
                className="min-h-5 rounded border border-editor-border bg-editor-panel px-1 py-px text-[10px] font-medium leading-4 text-text-primary transition-colors hover:border-editor-focus-ring hover:bg-editor-selected-quiet focus:outline-none focus:ring-2 focus:ring-editor-focus-ring"
                data-testid={`film-grain-preset-${preset.id}`}
                key={preset.id}
                onClick={() => {
                  handleFilmGrainPresetApply(preset);
                }}
                type="button"
              >
                {t(preset.labelKey)}
              </button>
            ))}
          </div>
          <AdjustmentSlider
            {...displayCreativeSliderInteractionProps(Effect.GrainAmount)}
            density="compact"
            label={t('adjustments.effects.amount')}
            max={100}
            min={0}
            onValueChange={(value) => {
              handleAdjustmentChange(Effect.GrainAmount, value);
            }}
            step={1}
            testId="effects-control-grain-amount"
            value={adjustments.grainAmount}
            onDragStateChange={onDragStateChange}
          />
          <AdjustmentSlider
            {...displayCreativeSliderInteractionProps(Effect.GrainSize)}
            density="compact"
            defaultValue={25}
            label={t('adjustments.effects.size')}
            max={100}
            min={0}
            onValueChange={(value) => {
              handleAdjustmentChange(Effect.GrainSize, value);
            }}
            step={1}
            testId="effects-control-grain-size"
            value={adjustments.grainSize}
            onDragStateChange={onDragStateChange}
            fillOrigin="min"
          />
          <AdjustmentSlider
            {...displayCreativeSliderInteractionProps(Effect.GrainRoughness)}
            density="compact"
            defaultValue={50}
            label={t('adjustments.effects.roughness')}
            max={100}
            min={0}
            onValueChange={(value) => {
              handleAdjustmentChange(Effect.GrainRoughness, value);
            }}
            step={1}
            testId="effects-control-grain-roughness"
            value={adjustments.grainRoughness}
            onDragStateChange={onDragStateChange}
            fillOrigin="min"
          />
          <div
            className="mt-1 rounded border border-editor-border bg-editor-panel px-1.5 py-0.5 text-[10px] leading-4 text-text-secondary"
            data-testid="film-grain-chroma-planned"
          >
            {t('adjustments.effects.grainChromaPlanned')}
          </div>
        </section>
      )}

      <section
        aria-label={t('adjustments.effects.activeSummary', { defaultValue: 'Active effects summary' })}
        className="rounded border border-editor-border bg-editor-panel-well px-1.5 py-1"
        data-active-effect-count={activeEffectSummaryChips.length}
        data-testid="effects-active-summary"
      >
        <div className="mb-1 flex items-center justify-between gap-2">
          <UiText className={density.sectionHeader.title} variant={TextVariants.heading}>
            {t('adjustments.effects.activeSummary', { defaultValue: 'Active effects' })}
          </UiText>
          <span
            className={editorChromeStatusChipClassName(activeEffectSummaryChips.length > 0 ? 'success' : 'neutral')}
          >
            {activeEffectSummaryChips.length > 0
              ? t('adjustments.effects.activeSummaryCount', {
                  count: activeEffectSummaryChips.length,
                  defaultValue: '{{count}} active',
                })
              : t('adjustments.effects.activeSummaryEmpty', { defaultValue: 'None active' })}
          </span>
        </div>
        {activeEffectSummaryChips.length > 0 ? (
          <div className="flex flex-wrap gap-1">
            {activeEffectSummaryChips.map((summary) => (
              <span className={summaryChipClassName} key={`${summary.label}:${summary.value}`}>
                <span className={summaryChipLabelClassName}>{summary.label}</span>
                <span className={summaryChipValueClassName}>{summary.value}</span>
              </span>
            ))}
          </div>
        ) : (
          <UiText className="block text-[11px] leading-4 text-text-secondary" variant={TextVariants.small}>
            {t('adjustments.effects.activeSummaryNoScroll', {
              defaultValue: 'Creative, LUT, vignette, and grain controls are currently neutral.',
            })}
          </UiText>
        )}
      </section>

      <section
        className="rounded border border-editor-border bg-editor-panel-well"
        data-testid="effects-advanced-section"
      >
        <button
          aria-controls="effects-advanced-controls"
          aria-expanded={advancedOpen}
          className="flex min-h-7 w-full items-center justify-between px-1.5 py-1 text-left text-[11px] font-medium text-text-primary hover:bg-editor-selected-quiet focus:outline-none focus:ring-2 focus:ring-editor-focus-ring"
          data-testid="effects-advanced-toggle"
          onClick={() => {
            setAdvancedOpen((open) => !open);
          }}
          type="button"
        >
          <span>{t('adjustments.effects.advanced', { defaultValue: 'Creative and advanced' })}</span>
          <span aria-hidden="true">{advancedOpen ? '−' : '+'}</span>
        </button>
        {advancedOpen && (
          <div
            className="space-y-1.5 border-t border-editor-border p-1.5"
            data-testid="effects-advanced"
            id="effects-advanced-controls"
          >
            <div className="rounded border border-editor-border bg-editor-panel-well px-1.5 py-1">
              <UiText variant={TextVariants.heading} className={density.sectionHeader.title}>
                {t('adjustments.effects.creative')}
              </UiText>

              <AdjustmentSlider
                {...displayCreativeSliderInteractionProps(CreativeAdjustment.GlowAmount)}
                density="compact"
                label={t('adjustments.effects.glow')}
                max={100}
                min={0}
                onValueChange={(value) => {
                  handleAdjustmentChange(CreativeAdjustment.GlowAmount, value);
                }}
                step={1}
                testId="effects-control-glow-amount"
                value={adjustments.glowAmount}
                onDragStateChange={onDragStateChange}
              />

              <AdjustmentSlider
                {...displayCreativeSliderInteractionProps(CreativeAdjustment.HalationAmount)}
                density="compact"
                label={t('adjustments.effects.halation')}
                max={100}
                min={0}
                onValueChange={(value) => {
                  handleAdjustmentChange(CreativeAdjustment.HalationAmount, value);
                }}
                step={1}
                testId="effects-control-halation-amount"
                value={adjustments.halationAmount}
                onDragStateChange={onDragStateChange}
              />

              {!isForMask && (
                <AdjustmentSlider
                  {...displayCreativeSliderInteractionProps(CreativeAdjustment.FlareAmount)}
                  density="compact"
                  label={t('adjustments.effects.lightFlares')}
                  max={100}
                  min={0}
                  onValueChange={(value) => {
                    handleAdjustmentChange(CreativeAdjustment.FlareAmount, value);
                  }}
                  step={1}
                  testId="effects-control-flare-amount"
                  value={adjustments.flareAmount}
                  onDragStateChange={onDragStateChange}
                />
              )}
            </div>

            {!isForMask && (
              <>
                <div className="rounded border border-editor-border bg-editor-panel-well px-1.5 py-1">
                  <UiText variant={TextVariants.heading} className={density.sectionHeader.title}>
                    {t('adjustments.effects.filmStages.title', { defaultValue: 'Film stages' })}
                  </UiText>
                  <FilmStageControls
                    descriptors={filmStageDescriptors}
                    onChange={handleFilmStageChange}
                    onReset={handleFilmStageReset}
                  />
                </div>

                <div className="rounded border border-editor-border bg-editor-panel-well px-1.5 py-1">
                  <UiText variant={TextVariants.heading} className={density.sectionHeader.title}>
                    {t('adjustments.effects.lut')}
                  </UiText>
                  <LUTControl
                    lutName={adjustments.lutName || null}
                    lutIntensity={adjustments.lutIntensity ?? 100}
                    onLutSelect={handleLutSelect}
                    onIntensityChange={handleLutIntensityChange}
                    onClear={handleLutClear}
                    onDragStateChange={onDragStateChange}
                  />
                </div>
              </>
            )}
          </div>
        )}
      </section>
    </div>
  );
}
