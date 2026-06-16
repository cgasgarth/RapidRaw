import type { NegativeLabBuiltInUiPresetCatalog } from '../schemas/negativeLabPresetCatalogSchemas';

export const NEGATIVE_LAB_BUILT_IN_UI_PRESET_CATALOG = {
  defaultPresetId: 'negative_lab.generic.c41.neutral.v1',
  presets: [
    {
      displayName: 'C-41 Neutral',
      params: { blue_weight: 1, contrast: 1, exposure: 0, green_weight: 1, red_weight: 1 },
      presetId: 'negative_lab.generic.c41.neutral.v1',
    },
    {
      displayName: 'C-41 Portrait',
      params: { blue_weight: 0.98, contrast: 0.95, exposure: 0.05, green_weight: 1, red_weight: 1.03 },
      presetId: 'negative_lab.generic.c41.portrait.v1',
    },
    {
      displayName: 'C-41 High Speed',
      params: { blue_weight: 0.94, contrast: 1.15, exposure: 0.15, green_weight: 0.98, red_weight: 1.04 },
      presetId: 'negative_lab.generic.c41.high_speed.v1',
    },
    {
      displayName: 'C-41 Saturated',
      params: { blue_weight: 1.06, contrast: 1.15, exposure: 0, green_weight: 1.02, red_weight: 1.08 },
      presetId: 'negative_lab.generic.c41.saturated.v1',
    },
    {
      displayName: 'Black and White Classic',
      params: { blue_weight: 0.9, contrast: 1.3, exposure: 0.05, green_weight: 1.05, red_weight: 1.1 },
      presetId: 'negative_lab.generic.bw.classic.v1',
    },
    {
      displayName: 'Black and White Fine Grain',
      params: { blue_weight: 0.95, contrast: 1.05, exposure: 0, green_weight: 1, red_weight: 1 },
      presetId: 'negative_lab.generic.bw.fine_grain.v1',
    },
    {
      displayName: 'Black and White Ortho',
      params: { blue_weight: 1.2, contrast: 1.2, exposure: -0.05, green_weight: 1.05, red_weight: 0.75 },
      presetId: 'negative_lab.generic.bw.ortho.v1',
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
