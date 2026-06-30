import type { ColorGradingPresetCatalog } from '../schemas/color/colorGradingPresetSchemas';

export const COLOR_GRADING_PRESET_CATALOG = {
  version: 1,
  presets: [
    {
      version: 1,
      id: 'color_grading.cinematic.teal_warm.v1',
      name: 'Teal Warm',
      category: 'cinematic',
      shadows: { hue: 210, saturation: 10, luminance: -2 },
      midtones: { hue: 34, saturation: 5, luminance: 0 },
      highlights: { hue: 42, saturation: 8, luminance: 1 },
      global: { hue: 34, saturation: 2, luminance: 0 },
      balance: 8,
      blending: 55,
    },
    {
      version: 1,
      id: 'color_grading.portrait.clean_warmth.v1',
      name: 'Clean Warmth',
      category: 'portrait',
      shadows: { hue: 225, saturation: 2, luminance: 0 },
      midtones: { hue: 32, saturation: 7, luminance: 1 },
      highlights: { hue: 45, saturation: 5, luminance: 0 },
      global: { hue: 35, saturation: 2, luminance: 0 },
      balance: 18,
      blending: 62,
    },
    {
      version: 1,
      id: 'color_grading.landscape.cool_depth.v1',
      name: 'Cool Depth',
      category: 'landscape',
      shadows: { hue: 218, saturation: 8, luminance: -3 },
      midtones: { hue: 185, saturation: 3, luminance: 0 },
      highlights: { hue: 55, saturation: 4, luminance: 1 },
      global: { hue: 210, saturation: 1, luminance: 0 },
      balance: -12,
      blending: 48,
    },
  ],
} satisfies ColorGradingPresetCatalog;

export const COLOR_GRADING_PRESETS = COLOR_GRADING_PRESET_CATALOG.presets;
