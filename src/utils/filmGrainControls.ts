import type { Adjustments } from './adjustments';

export interface FilmGrainUiPreset {
  amount: number;
  id: string;
  labelKey: string;
  roughness: number;
  size: number;
}

export const FILM_GRAIN_UI_PRESETS = [
  {
    amount: 12,
    id: 'film_grain.ui_preset.iso_100_fine.v1',
    labelKey: 'adjustments.effects.grainPresets.fine100',
    roughness: 35,
    size: 18,
  },
  {
    amount: 28,
    id: 'film_grain.ui_preset.iso_400_classic.v1',
    labelKey: 'adjustments.effects.grainPresets.classic400',
    roughness: 50,
    size: 34,
  },
  {
    amount: 48,
    id: 'film_grain.ui_preset.iso_1600_push.v1',
    labelKey: 'adjustments.effects.grainPresets.push1600',
    roughness: 72,
    size: 62,
  },
] as const satisfies ReadonlyArray<FilmGrainUiPreset>;

export type FilmGrainUiPresetId = (typeof FILM_GRAIN_UI_PRESETS)[number]['id'];

export const buildFilmGrainPresetAdjustmentPatch = (
  preset: FilmGrainUiPreset,
): Pick<Adjustments, 'grainAmount' | 'grainRoughness' | 'grainSize'> => ({
  grainAmount: preset.amount,
  grainRoughness: preset.roughness,
  grainSize: preset.size,
});
