import { invoke } from '@tauri-apps/api/core';
import { save as saveDialog } from '@tauri-apps/plugin-dialog';
import { type ChangeEvent } from 'react';
import { useTranslation } from 'react-i18next';

import FilmLookBrowser from './FilmLookBrowser';
import { TextVariants } from '../../types/typography';
import { Adjustments, Effect, CreativeAdjustment } from '../../utils/adjustments';
import { scaleFilmLookAdjustmentPatch, type FilmLookBrowserItem } from '../../utils/filmLookBrowser';
import { AppSettings, Invokes, type Preset } from '../ui/AppProperties';
import LUTControl from '../ui/LUTControl';
import Slider from '../ui/Slider';
import UiText from '../ui/Text';

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

type SliderChangeEvent =
  | ChangeEvent<HTMLInputElement>
  | {
      target: {
        value: number | string;
      };
    };

const FILM_LOOK_PRESET_FILE_EXTENSION = 'rrpreset';
const FILM_LOOK_PRESET_FILE_TYPE = 'RapidRaw Preset';
const formatFilmLookStrength = (strength: number) => `${strength}%`;
const formatFilmLookPresetName = (look: FilmLookBrowserItem, strength: number) =>
  `${look.displayName} ${formatFilmLookStrength(strength)}`;
const sanitizeFilmLookPresetFileName = (look: FilmLookBrowserItem, strength: number) =>
  `${formatFilmLookPresetName(look, strength)}.rrpreset`.replace(/[<>:"/\\|?*]/g, '_');
const createFilmLookPreset = (look: FilmLookBrowserItem, strength: number): Preset => ({
  adjustments: scaleFilmLookAdjustmentPatch(look, strength),
  id: crypto.randomUUID(),
  includeCropTransform: false,
  includeMasks: false,
  name: formatFilmLookPresetName(look, strength),
  presetType: 'style',
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

  const handleAdjustmentChange = (key: string, value: number | string) => {
    const numericValue = parseInt(String(value), 10);
    setAdjustments((prev: Adjustments) => ({ ...prev, [key]: numericValue }));
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
      ...scaleFilmLookAdjustmentPatch(look, strength),
    }));
  };

  const saveFilmLookPreset = async (look: FilmLookBrowserItem, strength: number) => {
    await invoke(Invokes.SaveCommunityPreset, {
      adjustments: scaleFilmLookAdjustmentPatch(look, strength),
      includeCropTransform: false,
      includeMasks: false,
      name: formatFilmLookPresetName(look, strength),
      presetType: 'style',
    });
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
    await invoke(Invokes.HandleExportPresetsToFile, { presetsToExport, filePath });
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

        <Slider
          label={t('adjustments.effects.glow')}
          max={100}
          min={0}
          onChange={(e: SliderChangeEvent) => {
            handleAdjustmentChange(CreativeAdjustment.GlowAmount, e.target.value);
          }}
          step={1}
          value={adjustments.glowAmount}
          onDragStateChange={onDragStateChange}
        />

        <Slider
          label={t('adjustments.effects.halation')}
          max={100}
          min={0}
          onChange={(e: SliderChangeEvent) => {
            handleAdjustmentChange(CreativeAdjustment.HalationAmount, e.target.value);
          }}
          step={1}
          value={adjustments.halationAmount}
          onDragStateChange={onDragStateChange}
        />

        {!isForMask && (
          <Slider
            label={t('adjustments.effects.lightFlares')}
            max={100}
            min={0}
            onChange={(e: SliderChangeEvent) => {
              handleAdjustmentChange(CreativeAdjustment.FlareAmount, e.target.value);
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
            <FilmLookBrowser
              onApplyLook={handleFilmLookApply}
              onSaveLook={handleFilmLookSave}
              onShareLook={handleFilmLookShare}
            />
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
              <Slider
                label={t('adjustments.effects.amount')}
                max={100}
                min={-100}
                onChange={(e: SliderChangeEvent) => {
                  handleAdjustmentChange(Effect.VignetteAmount, e.target.value);
                }}
                step={1}
                value={adjustments.vignetteAmount}
                onDragStateChange={onDragStateChange}
              />
              <Slider
                defaultValue={50}
                label={t('adjustments.effects.midpoint')}
                max={100}
                min={0}
                onChange={(e: SliderChangeEvent) => {
                  handleAdjustmentChange(Effect.VignetteMidpoint, e.target.value);
                }}
                step={1}
                value={adjustments.vignetteMidpoint}
                onDragStateChange={onDragStateChange}
                fillOrigin="min"
              />
              <Slider
                label={t('adjustments.effects.roundness')}
                max={100}
                min={-100}
                onChange={(e: SliderChangeEvent) => {
                  handleAdjustmentChange(Effect.VignetteRoundness, e.target.value);
                }}
                step={1}
                value={adjustments.vignetteRoundness}
                onDragStateChange={onDragStateChange}
              />
              <Slider
                defaultValue={50}
                label={t('adjustments.effects.feather')}
                max={100}
                min={0}
                onChange={(e: SliderChangeEvent) => {
                  handleAdjustmentChange(Effect.VignetteFeather, e.target.value);
                }}
                step={1}
                value={adjustments.vignetteFeather}
                onDragStateChange={onDragStateChange}
                fillOrigin="min"
              />
            </div>
          )}

          {adjustmentVisibility['grain'] !== false && (
            <div className="p-2 bg-bg-tertiary rounded-md">
              <UiText variant={TextVariants.heading} className="mb-2">
                {t('adjustments.effects.grain')}
              </UiText>
              <Slider
                label={t('adjustments.effects.amount')}
                max={100}
                min={0}
                onChange={(e: SliderChangeEvent) => {
                  handleAdjustmentChange(Effect.GrainAmount, e.target.value);
                }}
                step={1}
                value={adjustments.grainAmount}
                onDragStateChange={onDragStateChange}
              />
              <Slider
                defaultValue={25}
                label={t('adjustments.effects.size')}
                max={100}
                min={0}
                onChange={(e: SliderChangeEvent) => {
                  handleAdjustmentChange(Effect.GrainSize, e.target.value);
                }}
                step={1}
                value={adjustments.grainSize}
                onDragStateChange={onDragStateChange}
                fillOrigin="min"
              />
              <Slider
                defaultValue={50}
                label={t('adjustments.effects.roughness')}
                max={100}
                min={0}
                onChange={(e: SliderChangeEvent) => {
                  handleAdjustmentChange(Effect.GrainRoughness, e.target.value);
                }}
                step={1}
                value={adjustments.grainRoughness}
                onDragStateChange={onDragStateChange}
                fillOrigin="min"
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
