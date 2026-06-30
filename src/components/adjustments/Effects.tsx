import { invoke } from '@tauri-apps/api/core';
import { save as saveDialog } from '@tauri-apps/plugin-dialog';
import { lazy, Suspense, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Invokes } from '../../tauri/commands';
import { TextVariants } from '../../types/typography';
import { type Adjustments, CreativeAdjustment, Effect } from '../../utils/adjustments';
import {
  buildFilmLookAppliedAdjustmentPatch,
  buildFilmLookPresetDraft,
  type FilmLookBrowserItem,
  formatFilmLookPresetName,
} from '../../utils/film-look/filmLookBrowser';
import { buildFilmGrainPresetAdjustmentPatch, FILM_GRAIN_UI_PRESETS } from '../../utils/filmGrainControls';
import type { AppSettings, Preset } from '../ui/AppProperties';
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
}

type AdjustmentUpdate = Partial<Adjustments> | ((prev: Adjustments) => Adjustments);

type PresetExportItem = { preset: Preset };

const FILM_LOOK_PRESET_FILE_EXTENSION = 'rrpreset';
const FILM_LOOK_PRESET_FILE_TYPE = 'RapidRaw Preset';
const FILM_LOOK_SAVE_FAILED = 'Film look preset save failed.';
const FILM_LOOK_SHARE_FAILED = 'Film look preset export failed.';
const formatFilmLookSavedStatus = (look: FilmLookBrowserItem, strength: number) =>
  `Saved ${formatFilmLookPresetName(look, strength)}`;
const formatFilmLookSharedStatus = (look: FilmLookBrowserItem, strength: number) =>
  `Exported ${formatFilmLookPresetName(look, strength)}`;
const sanitizeFilmLookPresetFileName = (look: FilmLookBrowserItem, strength: number) =>
  `${formatFilmLookPresetName(look, strength)}.rrpreset`.replace(/[<>:"/\\|?*]/g, '_');
const createFilmLookPreset = (look: FilmLookBrowserItem, strength: number): Preset => ({
  ...buildFilmLookPresetDraft(look, strength),
  id: crypto.randomUUID(),
});

export default function EffectsPanel({
  adjustments,
  setAdjustments,
  isForMask,
  handleLutSelect,
  appSettings,
  onDragStateChange,
}: EffectsPanelProps) {
  const { t } = useTranslation();
  const [filmLookPresetStatus, setFilmLookPresetStatus] = useState<string | null>(null);

  const handleAdjustmentChange = (key: string, value: number) => {
    setAdjustments((prev: Adjustments) => ({ ...prev, [key]: Math.trunc(value) }));
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

  const handleFilmLookApply = (look: FilmLookBrowserItem, strength: number) => {
    setAdjustments((prev: Adjustments) => ({
      ...prev,
      ...buildFilmLookAppliedAdjustmentPatch(look, strength),
      filmLookId: look.id,
      filmLookStrength: strength,
    }));
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

  return (
    <div className="space-y-4">
      <div className="p-2 bg-bg-tertiary rounded-md">
        <UiText variant={TextVariants.heading} className="mb-2">
          {t('adjustments.effects.creative')}
        </UiText>

        <AdjustmentSlider
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
        <div className="space-y-4">
          <div className="p-2 bg-bg-tertiary rounded-md">
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
                className="mt-2 rounded-md border border-surface bg-bg-secondary px-3 py-2 text-text-secondary"
                data-testid="film-look-preset-status"
                variant={TextVariants.small}
              >
                {filmLookPresetStatus}
              </UiText>
            )}
          </div>

          <div className="p-2 bg-bg-tertiary rounded-md">
            <UiText variant={TextVariants.heading} className="mb-2">
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
            <div className="p-2 bg-bg-tertiary rounded-md">
              <UiText variant={TextVariants.heading} className="mb-2">
                {t('adjustments.effects.vignette')}
              </UiText>
              <AdjustmentSlider
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
            <div className="p-2 bg-bg-tertiary rounded-md" data-testid="film-grain-ui-controls">
              <div className="mb-2 flex items-center justify-between gap-2">
                <UiText variant={TextVariants.heading}>{t('adjustments.effects.grain')}</UiText>
                <span
                  className="rounded border border-surface bg-bg-secondary px-2 py-1 text-[11px] text-text-secondary"
                  data-testid="film-grain-renderer-status"
                >
                  {t('adjustments.effects.grainRendererStatus')}
                </span>
              </div>
              <div className="mb-3 grid grid-cols-3 gap-2" data-testid="film-grain-preset-shortcuts">
                {FILM_GRAIN_UI_PRESETS.map((preset) => (
                  <button
                    className="rounded border border-surface bg-bg-secondary px-2 py-1.5 text-xs text-text-primary transition-colors hover:border-accent focus:outline-none focus:ring-2 focus:ring-accent"
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
                className="mt-3 rounded border border-surface bg-bg-secondary px-3 py-2 text-xs text-text-secondary"
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
