import type { NegativeLabBuiltInUiPresetCatalog } from '../schemas/negativeLabPresetCatalogSchemas';

type NegativeLabBuiltInUiPreset = NegativeLabBuiltInUiPresetCatalog['presets'][number];
type NegativeLabPresetParams = NegativeLabBuiltInUiPreset['params'];

const GENERIC_NEGATIVE_LAB_PRESET_METADATA = {
  claimPolicy: 'generic_starting_point_no_stock_claim',
  legalNote: 'Generic family descriptor only; no manufacturer, stock, or emulation claim.',
  measurementProfileId: null,
  profileStatus: 'generic_unmeasured',
  runtimeStatus: 'runtime_parameter_applied',
} satisfies Pick<
  NegativeLabBuiltInUiPreset,
  'claimPolicy' | 'legalNote' | 'measurementProfileId' | 'profileStatus' | 'runtimeStatus'
>;

const makeNegativeLabPreset = (
  preset: Omit<
    NegativeLabBuiltInUiPreset,
    'claimPolicy' | 'legalNote' | 'measurementProfileId' | 'params' | 'profileStatus' | 'runtimeStatus'
  > & {
    params: Omit<NegativeLabPresetParams, 'base_fog_sample'>;
  },
): NegativeLabBuiltInUiPreset => ({
  ...GENERIC_NEGATIVE_LAB_PRESET_METADATA,
  ...preset,
  params: {
    ...preset.params,
    base_fog_sample: null,
  },
});

export const NEGATIVE_LAB_BUILT_IN_UI_PRESET_CATALOG = {
  defaultPresetId: 'negative_lab.generic.c41.neutral.v1',
  presets: [
    makeNegativeLabPreset({
      displayName: 'C-41 Neutral',
      filmClass: 'color_negative',
      processFamily: 'c41_color_negative',
      intent: 'Balanced starting point for modern color-negative scans with moderate contrast.',
      params: {
        blue_weight: 1,
        base_fog_strength: 1,
        contrast: 1,
        exposure: 0,
        green_weight: 1,
        red_weight: 1,
      },
      presetId: 'negative_lab.generic.c41.neutral.v1',
      processHint: 'C-41 family',
      stockFamilyDescriptor: 'Balanced color negative',
    }),
    makeNegativeLabPreset({
      displayName: 'C-41 Portrait',
      filmClass: 'color_negative',
      processFamily: 'c41_color_negative',
      intent: 'Gentler contrast with a warm red bias for skin-focused color-negative scans.',
      params: {
        blue_weight: 0.98,
        base_fog_strength: 1,
        contrast: 0.95,
        exposure: 0.05,
        green_weight: 1,
        red_weight: 1.03,
      },
      presetId: 'negative_lab.generic.c41.portrait.v1',
      processHint: 'C-41 family',
      stockFamilyDescriptor: 'Soft portrait color negative',
    }),
    makeNegativeLabPreset({
      displayName: 'C-41 High Speed',
      filmClass: 'color_negative',
      processFamily: 'c41_color_negative',
      intent: 'Higher contrast and warmer correction for dense, fast-stock-style scans.',
      params: {
        blue_weight: 0.94,
        base_fog_strength: 1,
        contrast: 1.15,
        exposure: 0.15,
        green_weight: 0.98,
        red_weight: 1.04,
      },
      presetId: 'negative_lab.generic.c41.high_speed.v1',
      processHint: 'C-41 family',
      stockFamilyDescriptor: 'Dense high-speed color negative',
    }),
    makeNegativeLabPreset({
      displayName: 'C-41 Saturated',
      filmClass: 'color_negative',
      processFamily: 'c41_color_negative',
      intent: 'Punchier color timing for saturated color-negative proof scans.',
      params: {
        blue_weight: 1.06,
        base_fog_strength: 1,
        contrast: 1.15,
        exposure: 0,
        green_weight: 1.02,
        red_weight: 1.08,
      },
      presetId: 'negative_lab.generic.c41.saturated.v1',
      processHint: 'C-41 family',
      stockFamilyDescriptor: 'Saturated color negative',
    }),
    makeNegativeLabPreset({
      displayName: 'C-41 Soft Pastel',
      filmClass: 'color_negative',
      processFamily: 'c41_color_negative',
      intent: 'Lower contrast with a gentle cool balance for airy color-negative scans.',
      params: {
        blue_weight: 1.04,
        base_fog_strength: 0.95,
        contrast: 0.9,
        exposure: 0.1,
        green_weight: 1.01,
        red_weight: 0.98,
      },
      presetId: 'negative_lab.generic.c41.soft_pastel.v1',
      processHint: 'C-41 family',
      stockFamilyDescriptor: 'Soft low-contrast color negative',
    }),
    makeNegativeLabPreset({
      displayName: 'C-41 Warm Consumer',
      filmClass: 'color_negative',
      processFamily: 'c41_color_negative',
      intent: 'Warm, approachable proof scan with moderate contrast and red/yellow-friendly balance.',
      params: {
        blue_weight: 0.92,
        base_fog_strength: 1,
        contrast: 1.08,
        exposure: 0.08,
        green_weight: 0.99,
        red_weight: 1.08,
      },
      presetId: 'negative_lab.generic.c41.warm_consumer.v1',
      processHint: 'C-41 family',
      stockFamilyDescriptor: 'Warm consumer color negative',
    }),
    makeNegativeLabPreset({
      displayName: 'C-41 Cool Shadow',
      filmClass: 'color_negative',
      processFamily: 'c41_color_negative',
      intent: 'Cooler shadow-oriented color timing for blue-biased or evening scans.',
      params: {
        blue_weight: 1.12,
        base_fog_strength: 1.05,
        contrast: 1.05,
        exposure: -0.05,
        green_weight: 1.02,
        red_weight: 0.96,
      },
      presetId: 'negative_lab.generic.c41.cool_shadow.v1',
      processHint: 'C-41 family',
      stockFamilyDescriptor: 'Cool shadow color negative',
    }),
    makeNegativeLabPreset({
      displayName: 'Black and White Classic',
      filmClass: 'black_and_white_silver',
      processFamily: 'black_and_white_silver_negative',
      intent: 'Classic silver-negative contrast with mild red-channel lift.',
      params: {
        blue_weight: 0.9,
        base_fog_strength: 1,
        contrast: 1.3,
        exposure: 0.05,
        green_weight: 1.05,
        red_weight: 1.1,
      },
      presetId: 'negative_lab.generic.bw.classic.v1',
      processHint: 'Silver gelatin family',
      stockFamilyDescriptor: 'Classic silver negative',
    }),
    makeNegativeLabPreset({
      displayName: 'Black and White Fine Grain',
      filmClass: 'black_and_white_silver',
      processFamily: 'black_and_white_silver_negative',
      intent: 'Lower contrast, fine-grain-style grayscale starting point.',
      params: {
        blue_weight: 0.95,
        base_fog_strength: 1,
        contrast: 1.05,
        exposure: 0,
        green_weight: 1,
        red_weight: 1,
      },
      presetId: 'negative_lab.generic.bw.fine_grain.v1',
      processHint: 'Silver gelatin family',
      stockFamilyDescriptor: 'Fine-grain silver negative',
    }),
    makeNegativeLabPreset({
      displayName: 'Black and White Ortho',
      filmClass: 'black_and_white_silver',
      processFamily: 'black_and_white_silver_negative',
      intent: 'Orthochromatic-style tonal separation with reduced red response.',
      params: {
        blue_weight: 1.2,
        base_fog_strength: 1,
        contrast: 1.2,
        exposure: -0.05,
        green_weight: 1.05,
        red_weight: 0.75,
      },
      presetId: 'negative_lab.generic.bw.ortho.v1',
      processHint: 'Silver gelatin family',
      stockFamilyDescriptor: 'Ortho-style silver negative',
    }),
    makeNegativeLabPreset({
      displayName: 'Black and White High Acutance',
      filmClass: 'black_and_white_silver',
      processFamily: 'black_and_white_silver_negative',
      intent: 'Crisper silver-negative tonal placement with stronger local separation.',
      params: {
        blue_weight: 0.92,
        base_fog_strength: 1,
        contrast: 1.38,
        exposure: 0,
        green_weight: 1.02,
        red_weight: 1.08,
      },
      presetId: 'negative_lab.generic.bw.high_acutance.v1',
      processHint: 'Silver gelatin family',
      stockFamilyDescriptor: 'High-acutance silver negative',
    }),
    makeNegativeLabPreset({
      displayName: 'Black and White Push Contrast',
      filmClass: 'black_and_white_silver',
      processFamily: 'black_and_white_silver_negative',
      intent: 'Dense, pushed-style silver-negative starting point with lifted exposure and strong contrast.',
      params: {
        blue_weight: 0.88,
        base_fog_strength: 1.08,
        contrast: 1.55,
        exposure: 0.18,
        green_weight: 1,
        red_weight: 1.12,
      },
      presetId: 'negative_lab.generic.bw.push_contrast.v1',
      processHint: 'Silver gelatin family',
      stockFamilyDescriptor: 'Pushed contrast silver negative',
    }),
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
