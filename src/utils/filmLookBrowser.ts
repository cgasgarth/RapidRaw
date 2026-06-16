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

export interface FilmLookBrowserItem {
  adjustmentPatch: FilmLookAdjustmentPatch;
  category: FilmLookCategory;
  description: string;
  displayName: string;
  id: string;
  provenance: FilmLookBrowserItemProvenance;
  strengthDefault: number;
}

export interface FilmLookBrowserItemProvenance {
  claimLevel: 'generic_engineered';
  legalNamingStatus: 'generic_safe_name';
  legalNote: string;
  measurementSource: 'generic_engineered_starting_point';
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

const FILM_LOOK_CATEGORY_ORDER: Array<FilmLookCategory> = [
  'color_clean',
  'color_warm',
  'color_cool',
  'color_fade',
  'black_and_white',
  'color_contrast',
];

const FILM_LOOK_CATEGORY_LABELS: Record<FilmLookCategory, string> = {
  black_and_white: 'Black & White',
  color_clean: 'Clean',
  color_contrast: 'Contrast',
  color_cool: 'Cool',
  color_fade: 'Fade',
  color_warm: 'Warm',
};

const GENERIC_FILM_LOOK_PROVENANCE = {
  claimLevel: 'generic_engineered',
  legalNamingStatus: 'generic_safe_name',
  legalNote: 'Generic creative look; not measured from, endorsed by, or claiming to match a film stock.',
  measurementSource: 'generic_engineered_starting_point',
} satisfies FilmLookBrowserItemProvenance;

const makeGenericFilmLook = (look: Omit<FilmLookBrowserItem, 'provenance'>): FilmLookBrowserItem => ({
  ...look,
  provenance: GENERIC_FILM_LOOK_PROVENANCE,
});

export const FILM_LOOK_BROWSER_ITEMS: Array<FilmLookBrowserItem> = [
  makeGenericFilmLook({
    adjustmentPatch: {
      contrast: 12,
      saturation: 4,
    },
    category: 'color_clean',
    description: 'Neutral creative color with modest contrast and restrained saturation.',
    displayName: 'Clean Color',
    id: 'film_look.generic.clean_color.v1',
    strengthDefault: 70,
  }),
  makeGenericFilmLook({
    adjustmentPatch: {
      contrast: 8,
      highlights: -10,
      temperature: 8,
    },
    category: 'color_warm',
    description: 'Warm print-style color with gentle highlight compression.',
    displayName: 'Warm Print',
    id: 'film_look.generic.warm_print.v1',
    strengthDefault: 65,
  }),
  makeGenericFilmLook({
    adjustmentPatch: {
      contrast: 18,
      saturation: -2,
      shadows: -10,
      temperature: -8,
    },
    category: 'color_cool',
    description: 'Cool contrast color with deeper shadows and controlled saturation.',
    displayName: 'Cool Contrast',
    id: 'film_look.generic.cool_contrast.v1',
    strengthDefault: 60,
  }),
  makeGenericFilmLook({
    adjustmentPatch: {
      blacks: 8,
      contrast: -10,
      saturation: -18,
    },
    category: 'color_fade',
    description: 'Low-contrast faded color with lifted blacks and soft saturation.',
    displayName: 'Soft Fade',
    id: 'film_look.generic.soft_fade.v1',
    strengthDefault: 55,
  }),
  makeGenericFilmLook({
    adjustmentPatch: {
      contrast: 12,
      grainAmount: 22,
      grainSize: 42,
      saturation: -100,
    },
    category: 'black_and_white',
    description: 'Monochrome rendering with balanced channel response and gentle texture defaults.',
    displayName: 'Mono Silver',
    id: 'film_look.generic.mono_silver.v1',
    strengthDefault: 75,
  }),
  makeGenericFilmLook({
    adjustmentPatch: {
      blacks: -3,
      contrast: 24,
      glowAmount: 8,
    },
    category: 'color_contrast',
    description: 'Punchy color with stronger curve separation and subtle glow defaults.',
    displayName: 'Punch Color',
    id: 'film_look.generic.punch_color.v1',
    strengthDefault: 60,
  }),
];

export const getFilmLookBrowserGroups = (): Array<FilmLookBrowserGroup> =>
  FILM_LOOK_CATEGORY_ORDER.map((category) => ({
    category,
    displayName: FILM_LOOK_CATEGORY_LABELS[category],
    looks: FILM_LOOK_BROWSER_ITEMS.filter((look) => look.category === category),
  })).filter((group) => group.looks.length > 0);

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
