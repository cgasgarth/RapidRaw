import { INITIAL_ADJUSTMENTS, type Adjustments } from './adjustments';

export type FilmLookCategory =
  | 'black_and_white'
  | 'color_clean'
  | 'color_contrast'
  | 'color_cool'
  | 'color_fade'
  | 'color_warm';

type FilmLookAdjustmentKey =
  | 'blacks'
  | 'contrast'
  | 'glowAmount'
  | 'grainAmount'
  | 'grainSize'
  | 'highlights'
  | 'saturation'
  | 'shadows'
  | 'temperature';

export type FilmLookAdjustmentPatch = Partial<Pick<Adjustments, FilmLookAdjustmentKey>>;
export type FilmLookRuntimeSupportState = 'adjustment_patch_preview_export';

export interface FilmLookBrowserItem {
  adjustmentPatch: FilmLookAdjustmentPatch;
  category: FilmLookCategory;
  description: string;
  displayName: string;
  id: string;
  provenance: FilmLookBrowserItemProvenance;
  runtimeSupport: FilmLookRuntimeSupportState;
  strengthDefault: number;
}

export interface FilmLookBrowserItemProvenance {
  claimLevel: 'generic_engineered' | 'stock_family_reference_metadata';
  legalNamingStatus: 'descriptive_stock_family' | 'generic_safe_name';
  legalNote: string;
  measurementSource: 'generic_engineered_starting_point' | 'research_reference_metadata_only';
}

export interface FilmLookBrowserGroup {
  category: FilmLookCategory;
  displayName: string;
  looks: Array<FilmLookBrowserItem>;
}

export interface FilmLookAdjustmentSummary {
  label: string;
  value: number;
}

export interface FilmLookPresetDraft extends Record<string, unknown> {
  adjustments: FilmLookAdjustmentPatch;
  includeCropTransform: false;
  includeMasks: false;
  name: string;
  presetType: 'style';
}

const MIN_FILM_LOOK_STRENGTH = 0;
const MAX_FILM_LOOK_STRENGTH = 100;

const FILM_LOOK_ADJUSTMENT_KEYS = [
  'temperature',
  'contrast',
  'highlights',
  'shadows',
  'blacks',
  'saturation',
  'glowAmount',
  'grainAmount',
  'grainSize',
] satisfies Array<FilmLookAdjustmentKey>;

const FILM_LOOK_ADJUSTMENT_LABELS: Record<FilmLookAdjustmentKey, string> = {
  blacks: 'Blacks',
  contrast: 'Contrast',
  glowAmount: 'Glow',
  grainAmount: 'Grain',
  grainSize: 'Grain Size',
  highlights: 'Highlights',
  saturation: 'Saturation',
  shadows: 'Shadows',
  temperature: 'Temp',
};

export const getFilmLookAdjustmentSummaries = (look: FilmLookBrowserItem): Array<FilmLookAdjustmentSummary> =>
  FILM_LOOK_ADJUSTMENT_KEYS.flatMap((key) => {
    const value = look.adjustmentPatch[key];

    if (typeof value !== 'number') {
      return [];
    }

    return [
      {
        label: FILM_LOOK_ADJUSTMENT_LABELS[key],
        value,
      },
    ];
  });

export const clampFilmLookStrength = (strength: number): number =>
  Math.min(MAX_FILM_LOOK_STRENGTH, Math.max(MIN_FILM_LOOK_STRENGTH, Math.round(strength)));

export const formatFilmLookStrength = (strength: number) => `${clampFilmLookStrength(strength)}%`;

export const formatFilmLookPresetName = (look: FilmLookBrowserItem, strength: number) =>
  `${look.displayName} ${formatFilmLookStrength(strength)}`;

export const scaleFilmLookAdjustmentPatch = (look: FilmLookBrowserItem, strength: number): FilmLookAdjustmentPatch => {
  const scale = clampFilmLookStrength(strength) / MAX_FILM_LOOK_STRENGTH;
  const scaledPatch: FilmLookAdjustmentPatch = {};

  for (const key of FILM_LOOK_ADJUSTMENT_KEYS) {
    const value = look.adjustmentPatch[key];

    if (typeof value === 'number') {
      scaledPatch[key] = Math.round(value * scale);
    }
  }

  return scaledPatch;
};

export const resetFilmLookControlledAdjustments = (): FilmLookAdjustmentPatch => {
  const resetPatch: FilmLookAdjustmentPatch = {};

  for (const key of FILM_LOOK_ADJUSTMENT_KEYS) {
    resetPatch[key] = INITIAL_ADJUSTMENTS[key];
  }

  return resetPatch;
};

export const getFilmLookControlledAdjustmentKeys = (): Array<FilmLookAdjustmentKey> => [...FILM_LOOK_ADJUSTMENT_KEYS];

export const buildFilmLookAppliedAdjustmentPatch = (
  look: FilmLookBrowserItem,
  strength: number,
): FilmLookAdjustmentPatch => ({
  ...resetFilmLookControlledAdjustments(),
  ...scaleFilmLookAdjustmentPatch(look, strength),
});

export const buildFilmLookPresetDraft = (look: FilmLookBrowserItem, strength: number): FilmLookPresetDraft => ({
  adjustments: scaleFilmLookAdjustmentPatch(look, strength),
  includeCropTransform: false,
  includeMasks: false,
  name: formatFilmLookPresetName(look, strength),
  presetType: 'style',
});
