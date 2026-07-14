import type { NegativeLabPresetParams } from '../../schemas/negative-lab/negativeLabPresetCatalogSchemas';
import type { NegativeLabScanMetricsV1 } from '../../schemas/negative-lab/negativeLabScanMetricsSchemas';

export type NegativeLabRgbTriplet = readonly [number, number, number];

export interface NegativeLabDensityConversionInput {
  baseFogRgb: NegativeLabRgbTriplet;
  densityBounds?: NegativeLabDensityBounds | undefined;
  negativeRgb: NegativeLabRgbTriplet;
  params: NegativeLabPresetParams;
  scanMetrics?: NegativeLabScanMetricsV1 | undefined;
}

export interface NegativeLabDensityPrintV2Input {
  densityBounds?: NegativeLabDensityBounds | undefined;
  densityRgb: NegativeLabRgbTriplet;
  params: NegativeLabPresetParams;
  scanMetrics?: NegativeLabScanMetricsV1 | undefined;
}

export interface NegativeLabDensityConversionResult {
  algorithmId: NegativeLabPresetParams['print_curve_algorithm'];
  densitySignalRgb: NegativeLabRgbTriplet;
  outputTag: NegativeLabPresetParams['print_curve_output_tag'];
  positiveRgb: NegativeLabRgbTriplet;
}

interface NegativeLabChannelBounds {
  max: number;
  min: number;
}

export type NegativeLabDensityBounds = readonly [
  NegativeLabChannelBounds,
  NegativeLabChannelBounds,
  NegativeLabChannelBounds,
];

export const NEGATIVE_LAB_DENSITY_ALGORITHM_ID = 'density_rgb_v1';
export const NEGATIVE_LAB_DENSITY_PRINT_V2_ALGORITHM_ID = 'negative_density_print_v2';

const LOG_EPSILON = 0.000001;
const MIN_DENSITY_RANGE = 0.0001;
const DISPLAY_GAMMA_INV = 1 / 2.2;
const MIN_ENDPOINT_SEPARATION = 0.05;
const DEFAULT_DENSITY_PRINT_V2_PARAMS: NonNullable<NegativeLabPresetParams['print_curve_v2']> = {
  algorithm_version: 1,
  anchor_density: 0.5,
  contrast_grade: 1,
  density_offset: 0,
  d_max: 1.65,
  d_min: 0.04,
  iso_r_grade: 1,
  midtone_shape: 0,
  schema_version: 2,
  shoulder_strength: 0.25,
  shoulder_width: 0.25,
  target_black_density: 1.65,
  target_white_density: 0.04,
  toe_strength: 0.25,
  toe_width: 0.25,
  output_domain: 'scene_linear_print',
};

export const clampNegativeLabUnitValue = (value: number): number => Math.min(1, Math.max(0, value));

const applyPositiveEndpoints = (value: number, params: NegativeLabPresetParams): number => {
  const blackPoint = clampNegativeLabUnitValue(params.black_point + params.black_point_offset);
  const whitePoint = clampNegativeLabUnitValue(
    Math.max(blackPoint + MIN_ENDPOINT_SEPARATION, params.white_point + params.white_point_offset),
  );
  return clampNegativeLabUnitValue((value - blackPoint) / (whitePoint - blackPoint));
};

const toDensity = (value: number): number => -Math.log10(Math.max(LOG_EPSILON, clampNegativeLabUnitValue(value)));

const isFiniteUnitValue = (value: number): boolean => Number.isFinite(value) && value >= 0 && value <= 1;

const buildChannelBounds = (sampleDensities: readonly number[], baseFogDensity: number): NegativeLabChannelBounds => {
  const min = Math.min(...sampleDensities);
  const max = Math.max(...sampleDensities, baseFogDensity);

  return {
    max: max <= min + MIN_DENSITY_RANGE ? min + 1 : max,
    min,
  };
};

export const buildNegativeLabDensityBoundsFromScanMetrics = (
  scanMetrics: NegativeLabScanMetricsV1,
): NegativeLabDensityBounds => {
  const lumaBounds = scanMetrics.lumaDensityPercentiles;
  const buildBoundsFromAxis = (
    deviationBounds: { lower: number; upper: number },
    fallbackPercentiles: NegativeLabScanMetricsV1['channels']['red']['densityPercentiles'],
  ) => {
    const min = lumaBounds.p02 + deviationBounds.lower;
    const max = lumaBounds.p98 + deviationBounds.upper;
    return {
      max: max <= min + MIN_DENSITY_RANGE ? fallbackPercentiles.p98 : max,
      min,
    } satisfies NegativeLabChannelBounds;
  };

  return [
    buildBoundsFromAxis(scanMetrics.channels.red.deviationBounds, scanMetrics.channels.red.densityPercentiles),
    buildBoundsFromAxis(scanMetrics.channels.green.deviationBounds, scanMetrics.channels.green.densityPercentiles),
    buildBoundsFromAxis(scanMetrics.channels.blue.deviationBounds, scanMetrics.channels.blue.densityPercentiles),
  ];
};

const buildNegativeLabDensityBoundsFromDensitySample = (
  densityRgb: NegativeLabRgbTriplet,
): NegativeLabDensityBounds => [
  { max: Math.max(1, densityRgb[0]), min: 0 },
  { max: Math.max(1, densityRgb[1]), min: 0 },
  { max: Math.max(1, densityRgb[2]), min: 0 },
];

export const buildNegativeLabDensityBounds = (
  negativeRgb: readonly NegativeLabRgbTriplet[],
  baseFogRgb: NegativeLabRgbTriplet,
): NegativeLabDensityBounds => {
  const densitySamples: NegativeLabRgbTriplet[] = negativeRgb.map((sample) => [
    toDensity(sample[0]),
    toDensity(sample[1]),
    toDensity(sample[2]),
  ]);
  const baseFogDensity: NegativeLabRgbTriplet = [
    toDensity(baseFogRgb[0]),
    toDensity(baseFogRgb[1]),
    toDensity(baseFogRgb[2]),
  ];

  return [
    buildChannelBounds(
      densitySamples.map((sample) => sample[0]),
      baseFogDensity[0],
    ),
    buildChannelBounds(
      densitySamples.map((sample) => sample[1]),
      baseFogDensity[1],
    ),
    buildChannelBounds(
      densitySamples.map((sample) => sample[2]),
      baseFogDensity[2],
    ),
  ];
};

const buildPositiveChannel = ({
  bounds,
  channelWeight,
  density,
  params,
}: {
  bounds: NegativeLabChannelBounds;
  channelWeight: number;
  density: number;
  params: NegativeLabPresetParams;
}): { densitySignal: number; positive: number } => {
  const baseDensity = bounds.min * params.base_fog_strength;
  const densitySignal = Math.max(0, (density - baseDensity) / Math.max(MIN_DENSITY_RANGE, bounds.max - baseDensity));
  const weightedDensity = densitySignal * channelWeight;
  const curveStrength = 4 * params.contrast;
  const curveCenter = 0.6 - params.exposure * 0.25;
  const y0 = 1 / (1 + Math.exp(curveStrength * curveCenter));
  const y1 = 1 / (1 + Math.exp(-curveStrength * (1 - curveCenter)));
  const scale = 1 / (y1 - y0);
  const sigmoid = 1 / (1 + Math.exp(-curveStrength * (weightedDensity - curveCenter)));
  const normalized = clampNegativeLabUnitValue((sigmoid - y0) * scale);

  return {
    densitySignal,
    positive: applyPositiveEndpoints(normalized, params) ** DISPLAY_GAMMA_INV,
  };
};

const normalizeDensityWithBounds = (density: number, bounds: NegativeLabChannelBounds): number =>
  clampNegativeLabUnitValue((density - bounds.min) / Math.max(MIN_DENSITY_RANGE, bounds.max - bounds.min));

const shapeDensityForPrint = ({
  densitySignal,
  params,
  scanMetrics,
}: {
  densitySignal: number;
  params: NegativeLabPresetParams;
  scanMetrics?: NegativeLabScanMetricsV1 | undefined;
}): number => {
  const rawV2Params = params.print_curve_v2 ?? DEFAULT_DENSITY_PRINT_V2_PARAMS;
  const v2Params =
    rawV2Params.schema_version === 1
      ? {
          ...rawV2Params,
          d_max: rawV2Params.target_black_density,
          d_min: rawV2Params.target_white_density,
          iso_r_grade: rawV2Params.contrast_grade,
        }
      : rawV2Params;
  const metricsCompression =
    scanMetrics === undefined
      ? 1
      : clampNegativeLabUnitValue(
          scanMetrics.texturalDensityRangeP10P90 / Math.max(MIN_DENSITY_RANGE, scanMetrics.densityRangeUnclamped),
        );
  const scanAwareContrast = v2Params.iso_r_grade * (0.8 + metricsCompression * 0.4);
  const exposed = clampNegativeLabUnitValue(
    (densitySignal - v2Params.anchor_density + v2Params.density_offset) * scanAwareContrast + v2Params.anchor_density,
  );
  const midpointBias = v2Params.midtone_shape * exposed * (1 - exposed) * 0.45;
  const midpointShaped = clampNegativeLabUnitValue(exposed + midpointBias);
  const toePower = 1 + v2Params.toe_strength * 1.5;
  const shoulderPower = 1 + v2Params.shoulder_strength * 1.5;
  const toe = midpointShaped / v2Params.toe_width;
  const toeShaped =
    midpointShaped + (clampNegativeLabUnitValue(toe) ** toePower - clampNegativeLabUnitValue(toe)) * v2Params.toe_width;
  const shoulder = (1 - midpointShaped) / v2Params.shoulder_width;
  const shoulderShaped = 1 - clampNegativeLabUnitValue(shoulder) ** shoulderPower * v2Params.shoulder_width;
  const blend = midpointShaped;

  return clampNegativeLabUnitValue(toeShaped * (1 - blend) + shoulderShaped * blend);
};

const renderPrintDensity = (tone: number, params: NegativeLabPresetParams): number => {
  const rawV2Params = params.print_curve_v2 ?? DEFAULT_DENSITY_PRINT_V2_PARAMS;
  const v2Params =
    rawV2Params.schema_version === 1
      ? {
          ...rawV2Params,
          d_max: rawV2Params.target_black_density,
          d_min: rawV2Params.target_white_density,
        }
      : rawV2Params;
  const densitySpan = v2Params.d_max - v2Params.d_min;
  const targetDensity = v2Params.d_max - tone * densitySpan;
  const linearPositive = clampNegativeLabUnitValue(10 ** -targetDensity);

  return params.print_curve_output_tag === 'export_linear' ? linearPositive : linearPositive ** DISPLAY_GAMMA_INV;
};

const buildDensityPrintV2Channel = ({
  bounds,
  density,
  params,
  scanMetrics,
  weight,
}: {
  bounds: NegativeLabChannelBounds;
  density: number;
  params: NegativeLabPresetParams;
  scanMetrics?: NegativeLabScanMetricsV1 | undefined;
  weight: number;
}): { densitySignal: number; positive: number } => {
  const densitySignal = clampNegativeLabUnitValue(normalizeDensityWithBounds(density, bounds) * weight);
  const tone = shapeDensityForPrint({ densitySignal, params, scanMetrics });

  return {
    densitySignal,
    positive: renderPrintDensity(applyPositiveEndpoints(tone, params), params),
  };
};

export const convertNegativeLabDensityPrintV2Sample = ({
  densityBounds,
  densityRgb,
  params,
  scanMetrics,
}: NegativeLabDensityPrintV2Input): NegativeLabDensityConversionResult => {
  const bounds =
    densityBounds ??
    (scanMetrics === undefined
      ? buildNegativeLabDensityBoundsFromDensitySample(densityRgb)
      : buildNegativeLabDensityBoundsFromScanMetrics(scanMetrics));
  const red = buildDensityPrintV2Channel({
    bounds: bounds[0],
    density: densityRgb[0],
    params,
    scanMetrics,
    weight: params.red_weight,
  });
  const green = buildDensityPrintV2Channel({
    bounds: bounds[1],
    density: densityRgb[1],
    params,
    scanMetrics,
    weight: params.green_weight,
  });
  const blue = buildDensityPrintV2Channel({
    bounds: bounds[2],
    density: densityRgb[2],
    params,
    scanMetrics,
    weight: params.blue_weight,
  });
  const densitySignalRgb: NegativeLabRgbTriplet = [red.densitySignal, green.densitySignal, blue.densitySignal];
  const positiveRgb: NegativeLabRgbTriplet = [red.positive, green.positive, blue.positive];

  if (!positiveRgb.every(isFiniteUnitValue) || !densitySignalRgb.every(isFiniteUnitValue)) {
    throw new Error('Negative Lab density print v2 produced a non-finite or out-of-range sample.');
  }

  return {
    algorithmId: NEGATIVE_LAB_DENSITY_PRINT_V2_ALGORITHM_ID,
    densitySignalRgb,
    outputTag: params.print_curve_output_tag,
    positiveRgb,
  };
};

export const convertNegativeLabDensitySample = ({
  baseFogRgb,
  densityBounds,
  negativeRgb,
  params,
  scanMetrics,
}: NegativeLabDensityConversionInput): NegativeLabDensityConversionResult => {
  const densityRgb: NegativeLabRgbTriplet = [
    toDensity(negativeRgb[0]),
    toDensity(negativeRgb[1]),
    toDensity(negativeRgb[2]),
  ];

  if (params.print_curve_algorithm === NEGATIVE_LAB_DENSITY_PRINT_V2_ALGORITHM_ID) {
    return convertNegativeLabDensityPrintV2Sample({
      densityBounds:
        densityBounds ??
        (scanMetrics === undefined ? undefined : buildNegativeLabDensityBoundsFromScanMetrics(scanMetrics)),
      densityRgb,
      params,
      scanMetrics,
    });
  }

  const bounds = densityBounds ?? buildNegativeLabDensityBounds([negativeRgb], baseFogRgb);
  const red = buildPositiveChannel({
    bounds: bounds[0],
    channelWeight: params.red_weight,
    density: densityRgb[0],
    params,
  });
  const green = buildPositiveChannel({
    bounds: bounds[1],
    channelWeight: params.green_weight,
    density: densityRgb[1],
    params,
  });
  const blue = buildPositiveChannel({
    bounds: bounds[2],
    channelWeight: params.blue_weight,
    density: densityRgb[2],
    params,
  });
  const densitySignalRgb: NegativeLabRgbTriplet = [red.densitySignal, green.densitySignal, blue.densitySignal];
  const positiveRgb: NegativeLabRgbTriplet = [red.positive, green.positive, blue.positive];

  return {
    algorithmId: NEGATIVE_LAB_DENSITY_ALGORITHM_ID,
    densitySignalRgb,
    outputTag: params.print_curve_output_tag,
    positiveRgb,
  };
};

export const convertNegativeLabDensitySamples = (
  negativeRgb: readonly NegativeLabRgbTriplet[],
  baseFogRgb: NegativeLabRgbTriplet,
  params: NegativeLabPresetParams,
  scanMetrics?: NegativeLabScanMetricsV1,
): NegativeLabRgbTriplet[] => {
  const densityBounds =
    params.print_curve_algorithm === NEGATIVE_LAB_DENSITY_PRINT_V2_ALGORITHM_ID && scanMetrics !== undefined
      ? buildNegativeLabDensityBoundsFromScanMetrics(scanMetrics)
      : buildNegativeLabDensityBounds(negativeRgb, baseFogRgb);

  return negativeRgb.map(
    (sample) =>
      convertNegativeLabDensitySample({
        baseFogRgb,
        densityBounds,
        negativeRgb: sample,
        params,
        scanMetrics,
      }).positiveRgb,
  );
};
