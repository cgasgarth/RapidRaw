import type { NegativeLabBuiltInUiPresetCatalog } from '../schemas/negativeLabPresetCatalogSchemas';

export const NEGATIVE_LAB_BUILT_IN_UI_PRESET_CATALOG = {
  defaultPresetId: 'negative_lab.generic.c41.neutral.v1',
  presets: [
    {
      displayName: 'C-41 Neutral',
      intent: 'Balanced starting point for modern color-negative scans with moderate contrast.',
      params: {
        blue_weight: 1,
        base_fog_strength: 1,
        base_fog_sample: null,
        contrast: 1,
        exposure: 0,
        green_weight: 1,
        red_weight: 1,
      },
      presetId: 'negative_lab.generic.c41.neutral.v1',
      processHint: 'C-41 family',
    },
    {
      displayName: 'C-41 Portrait',
      intent: 'Gentler contrast with a warm red bias for skin-focused color-negative scans.',
      params: {
        blue_weight: 0.98,
        base_fog_strength: 1,
        base_fog_sample: null,
        contrast: 0.95,
        exposure: 0.05,
        green_weight: 1,
        red_weight: 1.03,
      },
      presetId: 'negative_lab.generic.c41.portrait.v1',
      processHint: 'C-41 family',
    },
    {
      displayName: 'C-41 High Speed',
      intent: 'Higher contrast and warmer correction for dense, fast-stock-style scans.',
      params: {
        blue_weight: 0.94,
        base_fog_strength: 1,
        base_fog_sample: null,
        contrast: 1.15,
        exposure: 0.15,
        green_weight: 0.98,
        red_weight: 1.04,
      },
      presetId: 'negative_lab.generic.c41.high_speed.v1',
      processHint: 'C-41 family',
    },
    {
      displayName: 'C-41 Saturated',
      intent: 'Punchier color timing for saturated color-negative proof scans.',
      params: {
        blue_weight: 1.06,
        base_fog_strength: 1,
        base_fog_sample: null,
        contrast: 1.15,
        exposure: 0,
        green_weight: 1.02,
        red_weight: 1.08,
      },
      presetId: 'negative_lab.generic.c41.saturated.v1',
      processHint: 'C-41 family',
    },
    {
      displayName: 'Black and White Classic',
      intent: 'Classic silver-negative contrast with mild red-channel lift.',
      params: {
        blue_weight: 0.9,
        base_fog_strength: 1,
        base_fog_sample: null,
        contrast: 1.3,
        exposure: 0.05,
        green_weight: 1.05,
        red_weight: 1.1,
      },
      presetId: 'negative_lab.generic.bw.classic.v1',
      processHint: 'Silver gelatin family',
    },
    {
      displayName: 'Black and White Fine Grain',
      intent: 'Lower contrast, fine-grain-style grayscale starting point.',
      params: {
        blue_weight: 0.95,
        base_fog_strength: 1,
        base_fog_sample: null,
        contrast: 1.05,
        exposure: 0,
        green_weight: 1,
        red_weight: 1,
      },
      presetId: 'negative_lab.generic.bw.fine_grain.v1',
      processHint: 'Silver gelatin family',
    },
    {
      displayName: 'Black and White Ortho',
      intent: 'Orthochromatic-style tonal separation with reduced red response.',
      params: {
        blue_weight: 1.2,
        base_fog_strength: 1,
        base_fog_sample: null,
        contrast: 1.2,
        exposure: -0.05,
        green_weight: 1.05,
        red_weight: 0.75,
      },
      presetId: 'negative_lab.generic.bw.ortho.v1',
      processHint: 'Silver gelatin family',
    },
  ],
  version: 1,
} satisfies NegativeLabBuiltInUiPresetCatalog;

const defaultNegativeLabUiPreset = NEGATIVE_LAB_BUILT_IN_UI_PRESET_CATALOG.presets.find(
  (preset) => preset.presetId === NEGATIVE_LAB_BUILT_IN_UI_PRESET_CATALOG.defaultPresetId,
);

if (defaultNegativeLabUiPreset === undefined) {
  throw new Error('Negative Lab UI preset catalog is missing its default preset.');
}

export const DEFAULT_NEGATIVE_LAB_UI_PRESET = defaultNegativeLabUiPreset;
