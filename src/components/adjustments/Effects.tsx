import { invoke } from '@tauri-apps/api/core';
import { save as saveDialog } from '@tauri-apps/plugin-dialog';
import { lazy, Suspense, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { FilmStageControlDescriptorV1 } from '../../../packages/rawengine-schema/src/index.js';
import { Invokes } from '../../tauri/commands';
import { TextVariants } from '../../types/typography';
import { type Adjustments, CreativeAdjustment, Effect } from '../../utils/adjustments';
import {
  buildFilmLookPresetDraft,
  type FilmLookBrowserItem,
  formatFilmLookPresetName,
  getFilmLookControlledAdjustmentKeys,
} from '../../utils/film-look/filmLookBrowser';
import {
  buildFilmStageOperation,
  FILM_REFERENCE_STAGE_DEFAULT_P,
  getFilmStageControlDescriptors,
} from '../../utils/film-look/filmStageControls';
import { buildFilmGrainPresetAdjustmentPatch, FILM_GRAIN_UI_PRESETS } from '../../utils/filmGrainControls';
import FilmStageControls from '../film/FilmStageControls';
import type { AppSettings, Preset } from '../ui/AppProperties';
import { editorChromeStatusChipClassName } from '../ui/editorChromeTokens';
import { professionalInspectorDensityTokens } from '../ui/inspectorTokens';
import UiText from '../ui/primitives/Text';
import AdjustmentSlider from './AdjustmentSlider';
import LUTControl from './LUTControl';

const FilmLookBrowser = lazy(() =>
  import('./FilmLookBrowser.js').then((module) => ({ default: module.FilmLookBrowser })),
);

interface EffectsPanelProps {
  adjustments: Adjustments;
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

type AdjustmentUpdate = Partial<Adjustments> | ((prev: Adjustments) => Adjustments);

type PresetExportItem = { preset: Preset };

const FILM_LOOK_PRESET_FILE_EXTENSION = 'rrpreset';
const FILM_LOOK_PRESET_FILE_TYPE = 'RapidRaw Preset';
const FILM_LOOK_SAVE_FAILED = 'Film look preset save failed.';
const FILM_LOOK_SHARE_FAILED = 'Film look preset export failed.';
const FILM_LOOK_CONTROLLED_ADJUSTMENT_KEYS = new Set<string>([
  ...getFilmLookControlledAdjustmentKeys(),
  CreativeAdjustment.HalationAmount,
  Effect.GrainRoughness,
]);
const formatFilmLookSavedStatus = (look: FilmLookBrowserItem, strength: number) =>
  `Saved ${formatFilmLookPresetName(look, strength)}`;
const formatFilmLookSharedStatus = (look: FilmLookBrowserItem, strength: number) =>
  `Exported ${formatFilmLookPresetName(look, strength)}`;
const formatEffectSummaryValue = (value: number) => (value > 0 ? `+${value}` : `${value}`);
const formatEffectSummaryPercent = (value: number) => `${value}%`;
const sanitizeFilmLookPresetFileName = (look: FilmLookBrowserItem, strength: number) =>
  `${formatFilmLookPresetName(look, strength)}.rrpreset`.replace(/[<>:"/\\|?*]/g, '_');
const createFilmLookPreset = (look: FilmLookBrowserItem, strength: number): Preset => ({
  ...buildFilmLookPresetDraft(look, strength),
  id: crypto.randomUUID(),
});
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
  const [filmLookPresetStatus, setFilmLookPresetStatus] = useState<string | null>(null);
  const [filmStageP, setFilmStageP] = useState(FILM_REFERENCE_STAGE_DEFAULT_P);

  const handleAdjustmentChange = (key: string, value: number) => {
    setAdjustments((prev: Adjustments) => ({
      ...prev,
      [key]: Math.trunc(value),
      ...(FILM_LOOK_CONTROLLED_ADJUSTMENT_KEYS.has(key) ? { filmLookId: null, filmLookStrength: 100 } : {}),
    }));
  };

  const handleLutIntensityChange = (intensity: number) => {
    setAdjustments((prev: Adjustments) => ({ ...prev, lutIntensity: intensity }));
  };

  const handleLutClear = () => {
    setAdjustments((prev: Adjustments) => ({
      ...prev,
      lutPath: null,
      lutName: null,
      lutData: null,
      lutSize: 0,
      lutIntensity: 100,
    }));
  };

  const handleFilmLookApply = async (look: FilmLookBrowserItem, strength: number) => {
    if (onFilmEmulationOperation === undefined) {
      setFilmLookPresetStatus('Film operation adapter unavailable; no legacy patch was applied.');
      return;
    }
    await onFilmEmulationOperation({ kind: 'set_profile', profileId: look.id, mix: strength / 100 });
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
    setAdjustments((prev: Adjustments) => ({
      ...prev,
      ...buildFilmGrainPresetAdjustmentPatch(preset),
    }));
  };

  const saveFilmLookPreset = async (look: FilmLookBrowserItem, strength: number) => {
    try {
      await invoke(Invokes.SaveCommunityPreset, buildFilmLookPresetDraft(look, strength));
      setFilmLookPresetStatus(formatFilmLookSavedStatus(look, strength));
    } catch (error) {
      setFilmLookPresetStatus(FILM_LOOK_SAVE_FAILED);
      console.error(FILM_LOOK_SAVE_FAILED, error);
    }
  };

  const shareFilmLookPreset = async (look: FilmLookBrowserItem, strength: number) => {
    const filePath = await saveDialog({
      defaultPath: sanitizeFilmLookPresetFileName(look, strength),
      filters: [{ name: FILM_LOOK_PRESET_FILE_TYPE, extensions: [FILM_LOOK_PRESET_FILE_EXTENSION] }],
      title: t('editor.presets.dialog.exportTitle', {
        type: t('editor.presets.types.preset'),
      }),
    });

    if (typeof filePath !== 'string') {
      return;
    }

    const presetsToExport: Array<PresetExportItem> = [{ preset: createFilmLookPreset(look, strength) }];
    try {
      await invoke(Invokes.HandleExportPresetsToFile, { presetsToExport, filePath });
      setFilmLookPresetStatus(formatFilmLookSharedStatus(look, strength));
    } catch (error) {
      setFilmLookPresetStatus(FILM_LOOK_SHARE_FAILED);
      console.error(FILM_LOOK_SHARE_FAILED, error);
    }
  };

  const handleFilmLookSave = (look: FilmLookBrowserItem, strength: number) => {
    void saveFilmLookPreset(look, strength);
  };

  const handleFilmLookShare = (look: FilmLookBrowserItem, strength: number) => {
    void shareFilmLookPreset(look, strength);
  };

  const adjustmentVisibility = appSettings?.adjustmentVisibility || {};
  const density = professionalInspectorDensityTokens;
  const activeLutName =
    typeof adjustments.lutName === 'string' && adjustments.lutName.length > 0 ? adjustments.lutName : null;
  const activeLutIntensity = adjustments.lutIntensity ?? 100;
  const activeEffectSummaryChips: Array<EffectSummaryChip> = [
    ...(adjustments.filmLookId !== null
      ? [
          {
            label: t('adjustments.effects.filmLookBrowser.activeLook'),
            value: formatEffectSummaryPercent(adjustments.filmLookStrength),
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
    <div className={density.gutter.section}>
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

      <div className="rounded border border-editor-border bg-editor-panel-well px-1.5 py-1">
        <UiText variant={TextVariants.heading} className={density.sectionHeader.title}>
          {t('adjustments.effects.creative')}
        </UiText>

        <AdjustmentSlider
          density="compact"
          label={t('adjustments.effects.glow')}
          max={100}
          min={0}
          onValueChange={(value) => {
            handleAdjustmentChange(CreativeAdjustment.GlowAmount, value);
          }}
          step={1}
          value={adjustments.glowAmount}
          onDragStateChange={onDragStateChange}
        />

        <AdjustmentSlider
          density="compact"
          label={t('adjustments.effects.halation')}
          max={100}
          min={0}
          onValueChange={(value) => {
            handleAdjustmentChange(CreativeAdjustment.HalationAmount, value);
          }}
          step={1}
          value={adjustments.halationAmount}
          onDragStateChange={onDragStateChange}
        />

        {!isForMask && (
          <AdjustmentSlider
            density="compact"
            label={t('adjustments.effects.lightFlares')}
            max={100}
            min={0}
            onValueChange={(value) => {
              handleAdjustmentChange(CreativeAdjustment.FlareAmount, value);
            }}
            step={1}
            value={adjustments.flareAmount}
            onDragStateChange={onDragStateChange}
          />
        )}
      </div>

      {!isForMask && (
        <div className={density.gutter.section}>
          <div className="rounded border border-editor-border bg-editor-panel-well px-1.5 py-1">
            <Suspense fallback={null}>
              <FilmLookBrowser
                activeLookId={adjustments.filmLookId}
                activeStrength={adjustments.filmLookStrength}
                onApplyLook={handleFilmLookApply}
                onSaveLook={handleFilmLookSave}
                onShareLook={handleFilmLookShare}
              />
            </Suspense>
            {filmLookPresetStatus !== null && (
              <UiText
                aria-live="polite"
                className="mt-1.5 rounded border border-editor-border bg-editor-panel px-2 py-1 text-[11px] leading-4 text-text-secondary"
                data-testid="film-look-preset-status"
                variant={TextVariants.small}
              >
                {filmLookPresetStatus}
              </UiText>
            )}
          </div>

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
              lutIntensity={adjustments.lutIntensity || 100}
              onLutSelect={handleLutSelect}
              onIntensityChange={handleLutIntensityChange}
              onClear={handleLutClear}
              onDragStateChange={onDragStateChange}
            />
          </div>

          {adjustmentVisibility['vignette'] !== false && (
            <div className="rounded border border-editor-border bg-editor-panel-well px-1.5 py-1">
              <UiText variant={TextVariants.heading} className={density.sectionHeader.title}>
                {t('adjustments.effects.vignette')}
              </UiText>
              <AdjustmentSlider
                density="compact"
                label={t('adjustments.effects.amount')}
                max={100}
                min={-100}
                onValueChange={(value) => {
                  handleAdjustmentChange(Effect.VignetteAmount, value);
                }}
                step={1}
                value={adjustments.vignetteAmount}
                onDragStateChange={onDragStateChange}
              />
              <AdjustmentSlider
                density="compact"
                defaultValue={50}
                label={t('adjustments.effects.midpoint')}
                max={100}
                min={0}
                onValueChange={(value) => {
                  handleAdjustmentChange(Effect.VignetteMidpoint, value);
                }}
                step={1}
                value={adjustments.vignetteMidpoint}
                onDragStateChange={onDragStateChange}
                fillOrigin="min"
              />
              <AdjustmentSlider
                density="compact"
                label={t('adjustments.effects.roundness')}
                max={100}
                min={-100}
                onValueChange={(value) => {
                  handleAdjustmentChange(Effect.VignetteRoundness, value);
                }}
                step={1}
                value={adjustments.vignetteRoundness}
                onDragStateChange={onDragStateChange}
              />
              <AdjustmentSlider
                density="compact"
                defaultValue={50}
                label={t('adjustments.effects.feather')}
                max={100}
                min={0}
                onValueChange={(value) => {
                  handleAdjustmentChange(Effect.VignetteFeather, value);
                }}
                step={1}
                value={adjustments.vignetteFeather}
                onDragStateChange={onDragStateChange}
                fillOrigin="min"
              />
            </div>
          )}

          {adjustmentVisibility['grain'] !== false && (
            <div
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
                density="compact"
                label={t('adjustments.effects.amount')}
                max={100}
                min={0}
                onValueChange={(value) => {
                  handleAdjustmentChange(Effect.GrainAmount, value);
                }}
                step={1}
                value={adjustments.grainAmount}
                onDragStateChange={onDragStateChange}
              />
              <AdjustmentSlider
                density="compact"
                defaultValue={25}
                label={t('adjustments.effects.size')}
                max={100}
                min={0}
                onValueChange={(value) => {
                  handleAdjustmentChange(Effect.GrainSize, value);
                }}
                step={1}
                value={adjustments.grainSize}
                onDragStateChange={onDragStateChange}
                fillOrigin="min"
              />
              <AdjustmentSlider
                density="compact"
                defaultValue={50}
                label={t('adjustments.effects.roughness')}
                max={100}
                min={0}
                onValueChange={(value) => {
                  handleAdjustmentChange(Effect.GrainRoughness, value);
                }}
                step={1}
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
            </div>
          )}
        </div>
      )}
    </div>
  );
}
