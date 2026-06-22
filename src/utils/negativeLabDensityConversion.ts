import type { NegativeLabPresetParams } from '../schemas/negativeLabPresetCatalogSchemas';

export type NegativeLabRgbTriplet = readonly [number, number, number];

export interface NegativeLabDensityConversionInput {
  baseFogRgb: NegativeLabRgbTriplet;
  densityBounds?: NegativeLabDensityBounds;
  negativeRgb: NegativeLabRgbTriplet;
  params: NegativeLabPresetParams;
}

export interface NegativeLabDensityConversionResult {
  densitySignalRgb: NegativeLabRgbTriplet;
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

const LOG_EPSILON = 0.000001;
const MIN_DENSITY_RANGE = 0.0001;
const DISPLAY_GAMMA_INV = 1 / 2.2;
const MIN_ENDPOINT_SEPARATION = 0.05;

export const clampNegativeLabUnitValue = (value: number): number => Math.min(1, Math.max(0, value));

const applyPositiveEndpoints = (value: number, params: NegativeLabPresetParams): number => {
  const blackPoint = clampNegativeLabUnitValue(params.black_point);
  const whitePoint = clampNegativeLabUnitValue(Math.max(blackPoint + MIN_ENDPOINT_SEPARATION, params.white_point));
  return clampNegativeLabUnitValue((value - blackPoint) / (whitePoint - blackPoint));
};

const toDensity = (value: number): number => -Math.log10(Math.max(LOG_EPSILON, clampNegativeLabUnitValue(value)));

const buildChannelBounds = (sampleDensities: readonly number[], baseFogDensity: number): NegativeLabChannelBounds => {
  const min = Math.min(...sampleDensities);
  const max = Math.max(...sampleDensities, baseFogDensity);

  return {
    max: max <= min + MIN_DENSITY_RANGE ? min + 1 : max,
    min,
  };
};

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
    positive: Math.pow(applyPositiveEndpoints(normalized, params), DISPLAY_GAMMA_INV),
  };
};

export const convertNegativeLabDensitySample = ({
  baseFogRgb,
  densityBounds,
  negativeRgb,
  params,
}: NegativeLabDensityConversionInput): NegativeLabDensityConversionResult => {
  const bounds = densityBounds ?? buildNegativeLabDensityBounds([negativeRgb], baseFogRgb);
  const densityRgb: NegativeLabRgbTriplet = [
    toDensity(negativeRgb[0]),
    toDensity(negativeRgb[1]),
    toDensity(negativeRgb[2]),
  ];
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
    densitySignalRgb,
    positiveRgb,
  };
};

export const convertNegativeLabDensitySamples = (
  negativeRgb: readonly NegativeLabRgbTriplet[],
  baseFogRgb: NegativeLabRgbTriplet,
  params: NegativeLabPresetParams,
): NegativeLabRgbTriplet[] => {
  const densityBounds = buildNegativeLabDensityBounds(negativeRgb, baseFogRgb);

  return negativeRgb.map(
    (sample) =>
      convertNegativeLabDensitySample({
        baseFogRgb,
        densityBounds,
        negativeRgb: sample,
        params,
      }).positiveRgb,
  );
};
