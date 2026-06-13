import { type Adjustments } from './adjustments';

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
  strengthDefault: number;
}

export interface FilmLookBrowserGroup {
  category: FilmLookCategory;
  displayName: string;
  looks: Array<FilmLookBrowserItem>;
}

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

export const FILM_LOOK_BROWSER_ITEMS: Array<FilmLookBrowserItem> = [
  {
    adjustmentPatch: {
      contrast: 12,
      saturation: 4,
    },
    category: 'color_clean',
    description: 'Neutral creative color with modest contrast and restrained saturation.',
    displayName: 'Clean Color',
    id: 'film_look.generic.clean_color.v1',
    strengthDefault: 70,
  },
  {
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
  },
  {
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
  },
  {
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
  },
  {
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
  },
  {
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
  },
];

export const getFilmLookBrowserGroups = (): Array<FilmLookBrowserGroup> =>
  FILM_LOOK_CATEGORY_ORDER.map((category) => ({
    category,
    displayName: FILM_LOOK_CATEGORY_LABELS[category],
    looks: FILM_LOOK_BROWSER_ITEMS.filter((look) => look.category === category),
  })).filter((group) => group.looks.length > 0);
