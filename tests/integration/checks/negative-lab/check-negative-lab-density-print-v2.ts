#!/usr/bin/env bun

import { negativeLabPresetParamsSchema } from '../../../../src/schemas/negative-lab/negativeLabPresetCatalogSchemas.ts';
import type { NegativeLabScanMetricsV1 } from '../../../../src/schemas/negative-lab/negativeLabScanMetricsSchemas.ts';
import {
  buildNegativeLabDensityBoundsFromScanMetrics,
  convertNegativeLabDensityPrintV2Sample,
  convertNegativeLabDensitySample,
  NEGATIVE_LAB_DENSITY_PRINT_V2_ALGORITHM_ID,
  type NegativeLabDensityBounds,
  type NegativeLabRgbTriplet,
} from '../../../../src/utils/negativeLabDensityConversion.ts';

const EPSILON = 0.0000000001;

const assert = (condition: boolean, message: string): void => {
  if (!condition) throw new Error(message);
};

const near = (left: number, right: number, epsilon = EPSILON): boolean => Math.abs(left - right) <= epsilon;

const baseV2Params = negativeLabPresetParamsSchema.parse({
  base_fog_sample: null,
  base_fog_strength: 1,
  black_point: 0,
  blue_weight: 1,
  contrast: 1,
  exposure: 0,
  green_weight: 1,
  print_curve_algorithm: NEGATIVE_LAB_DENSITY_PRINT_V2_ALGORITHM_ID,
  print_curve_output_tag: 'preview_display',
  print_curve_v2: {
    contrast_grade: 1,
    density_offset: 0,
    midtone_shape: 0,
    schema_version: 1,
    shoulder_strength: 0.25,
    target_black_density: 1.65,
    target_white_density: 0.04,
    toe_strength: 0.25,
  },
  red_weight: 1,
  white_point: 1,
});

const legacyParams = negativeLabPresetParamsSchema.parse({
  base_fog_sample: null,
  base_fog_strength: 1,
  blue_weight: 1,
  contrast: 1,
  exposure: 0,
  green_weight: 1,
  red_weight: 1,
});

assert(legacyParams.print_curve_algorithm === 'density_rgb_v1', 'Legacy params must default to density_rgb_v1.');
assert(legacyParams.print_curve_v2 === null, 'Legacy params must not receive v2 curve params.');

const densityBounds: NegativeLabDensityBounds = [
  { max: 2, min: 0 },
  { max: 2, min: 0 },
  { max: 2, min: 0 },
];

const scanMetrics: NegativeLabScanMetricsV1 = {
  analysisCrop: { height: 1, width: 1, x: 0, y: 0 },
  border: { densityDeltaFromInsetP50: 0.04, sampleCount: 16 },
  channels: {
    blue: {
      densityPercentiles: { p02: 0, p10: 0.2, p25: 0.5, p50: 1, p75: 1.5, p90: 1.8, p98: 2 },
      deviationBounds: { lower: -0.02, upper: 0.02 },
    },
    green: {
      densityPercentiles: { p02: 0, p10: 0.2, p25: 0.5, p50: 1, p75: 1.5, p90: 1.8, p98: 2 },
      deviationBounds: { lower: -0.02, upper: 0.02 },
    },
    red: {
      densityPercentiles: { p02: 0, p10: 0.2, p25: 0.5, p50: 1, p75: 1.5, p90: 1.8, p98: 2 },
      deviationBounds: { lower: -0.02, upper: 0.02 },
    },
  },
  clippingCounts: { invalidSampleCount: 0, nonpositiveTransmittanceCount: 0, unityOrHigherTransmittanceCount: 0 },
  densityRangeUnclamped: 2,
  geometry: {
    imageHeight: 8,
    imageWidth: 8,
    insetCrop: { height: 0.8, width: 0.8, x: 0.1, y: 0.1 },
    insetFraction: 0.1,
    sampleStride: 1,
  },
  highDensityReference: 2,
  lumaDensityPercentiles: { p02: 0, p10: 0.2, p25: 0.5, p50: 1, p75: 1.5, p90: 1.8, p98: 2 },
  p50AnchorDensity: 1,
  sampleCount: 64,
  schemaVersion: 1,
  shadowReference: 0,
  texturalDensityRangeP10P90: 1.6,
  warningCodes: [],
};

const convertGray = (density: number, params = baseV2Params) =>
  convertNegativeLabDensityPrintV2Sample({
    densityBounds,
    densityRgb: [density, density, density],
    params,
    scanMetrics,
  });

const ramp = Array.from({ length: 17 }, (_, index) => convertGray((index / 16) * 2));

assert(
  ramp.every((sample) => sample.algorithmId === NEGATIVE_LAB_DENSITY_PRINT_V2_ALGORITHM_ID),
  'V2 samples must report the v2 algorithm.',
);
assert(
  ramp.every((sample) => sample.outputTag === 'preview_display'),
  'V2 samples must report preview/display output by default.',
);
assert(
  ramp.every((sample) =>
    [...sample.positiveRgb, ...sample.densitySignalRgb].every(
      (value) => Number.isFinite(value) && value >= 0 && value <= 1,
    ),
  ),
  'V2 samples must not produce NaN, Inf, or out-of-range values.',
);

for (let index = 1; index < ramp.length; index += 1) {
  assert(
    ramp[index].positiveRgb[0] + EPSILON >= ramp[index - 1].positiveRgb[0],
    'V2 positive output must be monotonic over a generated density ramp.',
  );
}

assert(near(ramp[0].positiveRgb[0], 0), 'V2 lower endpoint should map to target black.');
assert(near(ramp[ramp.length - 1].positiveRgb[0], 1), 'V2 upper endpoint should map to target white.');

const gray = convertGray(1.1);
assert(
  near(gray.positiveRgb[0], gray.positiveRgb[1]) && near(gray.positiveRgb[1], gray.positiveRgb[2]),
  'V2 neutral params must preserve gray balance.',
);

const deterministicA = convertGray(1.13);
const deterministicB = convertGray(1.13);
assert(JSON.stringify(deterministicA) === JSON.stringify(deterministicB), 'V2 conversion must be deterministic.');

const withV2Params = (overrides: Partial<NonNullable<typeof baseV2Params.print_curve_v2>>) =>
  negativeLabPresetParamsSchema.parse({
    ...baseV2Params,
    print_curve_v2: {
      ...baseV2Params.print_curve_v2,
      ...overrides,
    },
  });

assert(
  convertGray(1, withV2Params({ density_offset: 0.12 })).positiveRgb[0] > convertGray(1).positiveRgb[0],
  'Positive density offset should lift the midpoint.',
);
assert(
  convertGray(1.5, withV2Params({ contrast_grade: 1.35 })).positiveRgb[0] >
    convertGray(1.5, withV2Params({ contrast_grade: 0.75 })).positiveRgb[0],
  'Higher contrast grade should lift high-density tones.',
);
assert(
  convertGray(0.5, withV2Params({ toe_strength: 0.85 })).positiveRgb[0] <
    convertGray(0.5, withV2Params({ toe_strength: 0 })).positiveRgb[0],
  'Stronger toe should hold low-density tones down.',
);
assert(
  convertGray(1.5, withV2Params({ shoulder_strength: 0.85 })).positiveRgb[0] >
    convertGray(1.5, withV2Params({ shoulder_strength: 0 })).positiveRgb[0],
  'Stronger shoulder should lift high-density tones toward target white.',
);
assert(
  convertGray(1, withV2Params({ midtone_shape: 0.8 })).positiveRgb[0] >
    convertGray(1, withV2Params({ midtone_shape: -0.8 })).positiveRgb[0],
  'Positive midtone shaping should lift the midpoint relative to negative shaping.',
);

const exportLinear = convertGray(
  1.1,
  negativeLabPresetParamsSchema.parse({
    ...baseV2Params,
    print_curve_output_tag: 'export_linear',
  }),
);
assert(exportLinear.outputTag === 'export_linear', 'Export-linear output must carry an explicit output tag.');
assert(exportLinear.positiveRgb[0] < gray.positiveRgb[0], 'Export-linear output should not receive preview gamma.');

const metricBounds = buildNegativeLabDensityBoundsFromScanMetrics(scanMetrics);
assert(
  JSON.stringify(metricBounds) === JSON.stringify(densityBounds),
  'Scan metrics must produce deterministic density bounds.',
);

const negativeRgb: NegativeLabRgbTriplet = [10 ** -1, 10 ** -1, 10 ** -1];
const v2ViaLegacyEntry = convertNegativeLabDensitySample({
  baseFogRgb: [1, 1, 1],
  densityBounds,
  negativeRgb,
  params: baseV2Params,
  scanMetrics,
});
assert(
  v2ViaLegacyEntry.algorithmId === NEGATIVE_LAB_DENSITY_PRINT_V2_ALGORITHM_ID,
  'RGB entry point must dispatch to v2 when selected.',
);

const v1ViaLegacyEntry = convertNegativeLabDensitySample({
  baseFogRgb: [1, 1, 1],
  densityBounds,
  negativeRgb,
  params: legacyParams,
});
assert(v1ViaLegacyEntry.algorithmId === 'density_rgb_v1', 'RGB entry point must preserve v1 fallback.');

console.log(`negative lab density print v2 ok (${ramp.length} generated ramp samples)`);
