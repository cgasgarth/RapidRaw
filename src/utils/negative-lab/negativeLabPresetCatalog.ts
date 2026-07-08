import type { NegativeLabBuiltInUiPresetCatalog } from '../../schemas/negative-lab/negativeLabPresetCatalogSchemas';

type NegativeLabBuiltInUiPreset = NegativeLabBuiltInUiPresetCatalog['presets'][number];
type NegativeLabPresetParams = NegativeLabBuiltInUiPreset['params'];

const GENERIC_NEGATIVE_LAB_PRESET_METADATA = {
  claimLevel: 'generic_starting_point_only',
  claimPolicy: 'generic_starting_point_no_stock_claim',
  legalNote: 'Generic family descriptor only; no manufacturer, stock, or emulation claim.',
  measurementProfileId: null,
  measurementSource: 'generic_engineered_starting_point',
  profileStatus: 'generic_unmeasured',
  provenanceSummary: 'Engineered starter settings; not measured from a named stock or manufacturer profile.',
  runtimeStatus: 'runtime_parameter_applied',
} satisfies Pick<
  NegativeLabBuiltInUiPreset,
  | 'claimLevel'
  | 'claimPolicy'
  | 'legalNote'
  | 'measurementProfileId'
  | 'measurementSource'
  | 'profileStatus'
  | 'provenanceSummary'
  | 'runtimeStatus'
>;

const makeNegativeLabPreset = (
  preset: Omit<
    NegativeLabBuiltInUiPreset,
    | 'claimLevel'
    | 'claimPolicy'
    | 'legalNote'
    | 'measurementProfileId'
    | 'measurementSource'
    | 'params'
    | 'profileStatus'
    | 'provenanceSummary'
    | 'runtimeStatus'
  > & {
    params: Omit<
      NegativeLabPresetParams,
      | 'base_fog_sample'
      | 'black_point'
      | 'conversion_model'
      | 'print_curve_algorithm'
      | 'print_curve_output_tag'
      | 'print_curve_v2'
      | 'white_point'
    >;
  },
): NegativeLabBuiltInUiPreset => ({
  ...GENERIC_NEGATIVE_LAB_PRESET_METADATA,
  ...preset,
  params: {
    ...preset.params,
    black_point: 0,
    base_fog_sample: null,
    conversion_model: 'density_rgb_v1',
    print_curve_algorithm: 'density_rgb_v1',
    print_curve_output_tag: 'preview_display',
    print_curve_v2: null,
    white_point: 1,
  },
});

export const NEGATIVE_LAB_BUILT_IN_UI_PRESET_CATALOG = {
  defaultPresetId: 'negative_lab.generic.c41.neutral.v1',
  presets: [
    makeNegativeLabPreset({
      displayName: 'C-41 Neutral',
      filmClass: 'color_negative',
      processFamily: 'c41_color_negative',
      colorResponseNotes: 'Neutral channel weighting for balanced proof scans after orange-mask compensation.',
      contrastCurveDescriptor: 'Medium S-curve',
      grainModelDescriptor: 'Moderate chroma grain placeholder',
      intent: 'Balanced starting point for modern color-negative scans with moderate contrast.',
      nominalSpeedClass: 'Medium speed family',
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
      colorResponseNotes: 'Warm red-biased balance with restrained blue correction for skin-focused scans.',
      contrastCurveDescriptor: 'Soft shoulder curve',
      grainModelDescriptor: 'Fine to moderate chroma grain placeholder',
      intent: 'Gentler contrast with a warm red bias for skin-focused color-negative scans.',
      nominalSpeedClass: 'Medium speed family',
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
      colorResponseNotes: 'Warm dense-negative correction with slightly restrained blue response.',
      contrastCurveDescriptor: 'Firm midtone contrast',
      grainModelDescriptor: 'Coarse chroma grain placeholder',
      intent: 'Higher contrast and warmer correction for dense, fast-stock-style scans.',
      nominalSpeedClass: 'High speed family',
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
      colorResponseNotes: 'Lifted red and blue weights for punchier generic color separation.',
      contrastCurveDescriptor: 'Punchy S-curve',
      grainModelDescriptor: 'Moderate chroma grain placeholder',
      intent: 'Punchier color timing for saturated color-negative proof scans.',
      nominalSpeedClass: 'Medium speed family',
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
      colorResponseNotes: 'Cooler gentle balance with reduced base/fog strength for airy scans.',
      contrastCurveDescriptor: 'Low contrast soft curve',
      grainModelDescriptor: 'Fine chroma grain placeholder',
      intent: 'Lower contrast with a gentle cool balance for airy color-negative scans.',
      nominalSpeedClass: 'Low to medium speed family',
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
      colorResponseNotes: 'Warm red/yellow-friendly channel balance for casual proof scans.',
      contrastCurveDescriptor: 'Medium warm contrast',
      grainModelDescriptor: 'Moderate chroma grain placeholder',
      intent: 'Warm, approachable proof scan with moderate contrast and red/yellow-friendly balance.',
      nominalSpeedClass: 'Medium speed family',
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
      colorResponseNotes: 'Cool blue-biased correction for shadow-heavy or evening scans.',
      contrastCurveDescriptor: 'Shadow-weighted medium curve',
      grainModelDescriptor: 'Moderate chroma grain placeholder',
      intent: 'Cooler shadow-oriented color timing for blue-biased or evening scans.',
      nominalSpeedClass: 'Medium speed family',
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
      colorResponseNotes: 'Mild red-channel lift for classic panchromatic-style tonal separation.',
      contrastCurveDescriptor: 'Classic silver medium-high curve',
      grainModelDescriptor: 'Moderate silver grain placeholder',
      intent: 'Classic silver-negative contrast with mild red-channel lift.',
      nominalSpeedClass: 'Medium speed family',
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
      colorResponseNotes: 'Even channel weighting for clean grayscale placement.',
      contrastCurveDescriptor: 'Low contrast fine-detail curve',
      grainModelDescriptor: 'Fine silver grain placeholder',
      intent: 'Lower contrast, fine-grain-style grayscale starting point.',
      nominalSpeedClass: 'Low to medium speed family',
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
      colorResponseNotes: 'Reduced red response and stronger blue weighting for ortho-style separation.',
      contrastCurveDescriptor: 'Medium separation curve',
      grainModelDescriptor: 'Moderate silver grain placeholder',
      intent: 'Orthochromatic-style tonal separation with reduced red response.',
      nominalSpeedClass: 'Low to medium speed family',
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
      colorResponseNotes: 'Slight red lift with crisp tonal placement for edge-emphasized proof scans.',
      contrastCurveDescriptor: 'High acutance curve',
      grainModelDescriptor: 'Crisp silver grain placeholder',
      intent: 'Crisper silver-negative tonal placement with stronger local separation.',
      nominalSpeedClass: 'Medium speed family',
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
      colorResponseNotes: 'Dense tonal placement with lifted exposure and strong red-biased correction.',
      contrastCurveDescriptor: 'High contrast push curve',
      grainModelDescriptor: 'Coarse silver grain placeholder',
      intent: 'Dense, pushed-style silver-negative starting point with lifted exposure and strong contrast.',
      nominalSpeedClass: 'High speed or pushed family',
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
