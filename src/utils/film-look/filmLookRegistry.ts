import type {
  FilmLookAdjustmentPatch,
  FilmLookBrowserGroup,
  FilmLookBrowserItem,
  FilmLookBrowserItemProvenance,
  FilmLookCategory,
  FilmLookRuntimeSupportState,
} from './filmLookBrowser';

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

const GENERIC_FILM_LOOK_RUNTIME_SUPPORT = 'adjustment_patch_preview_export' satisfies FilmLookRuntimeSupportState;

const makeGenericFilmLook = (
  look: Omit<FilmLookBrowserItem, 'provenance' | 'runtimeSupport'>,
): FilmLookBrowserItem => ({
  ...look,
  provenance: GENERIC_FILM_LOOK_PROVENANCE,
  runtimeSupport: GENERIC_FILM_LOOK_RUNTIME_SUPPORT,
});

type GenericFilmLookDefinition = readonly [
  id: string,
  displayName: string,
  category: FilmLookCategory,
  description: string,
  strengthDefault: number,
  adjustmentPatch: FilmLookAdjustmentPatch,
];

const EXTRA_GENERIC_FILM_LOOK_DEFINITIONS: Array<GenericFilmLookDefinition> = [
  [
    'film_look.generic.soft_portrait_color.v1',
    'Soft Portrait Color',
    'color_warm',
    'Warm restrained color with gentle contrast for people-focused edits.',
    70,
    { contrast: 8, highlights: -8, saturation: 6, temperature: 4 },
  ],
  [
    'film_look.generic.sunlit_warmth.v1',
    'Sunlit Warmth',
    'color_warm',
    'Sunny warm color with lifted blacks and soft highlight rolloff.',
    68,
    { blacks: 4, contrast: -4, highlights: -6, saturation: 10, temperature: 9 },
  ],
  [
    'film_look.generic.deep_chroma.v1',
    'Deep Chroma',
    'color_contrast',
    'Dense saturated color with stronger separation for scenic contrast.',
    58,
    { blacks: -6, contrast: 26, highlights: -4, saturation: 28 },
  ],
  [
    'film_look.generic.bold_mono_grain.v1',
    'Bold Mono Grain',
    'black_and_white',
    'High-contrast monochrome with visible synthetic texture.',
    72,
    { blacks: -8, contrast: 30, grainAmount: 32, grainRoughness: 68, grainSize: 48, saturation: -100 },
  ],
];

const makeGenericFilmLookFromDefinition = ([
  id,
  displayName,
  category,
  description,
  strengthDefault,
  adjustmentPatch,
]: GenericFilmLookDefinition): FilmLookBrowserItem =>
  makeGenericFilmLook({
    adjustmentPatch,
    category,
    description,
    displayName,
    id,
    strengthDefault,
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
      grainRoughness: 64,
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
      halationAmount: 18,
    },
    category: 'color_contrast',
    description: 'Punchy color with stronger curve separation and subtle glow defaults.',
    displayName: 'Punch Color',
    id: 'film_look.generic.punch_color.v1',
    strengthDefault: 60,
  }),
  ...EXTRA_GENERIC_FILM_LOOK_DEFINITIONS.map(makeGenericFilmLookFromDefinition),
];

export const getFilmLookBrowserGroups = (): Array<FilmLookBrowserGroup> =>
  FILM_LOOK_CATEGORY_ORDER.map((category) => ({
    category,
    displayName: FILM_LOOK_CATEGORY_LABELS[category],
    looks: FILM_LOOK_BROWSER_ITEMS.filter((look) => look.category === category),
  })).filter((group) => group.looks.length > 0);
