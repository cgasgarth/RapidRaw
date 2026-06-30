import {
  NEGATIVE_LAB_SCAN_METRICS_SCHEMA_VERSION,
  type NegativeLabScanMetricsPercentiles,
  type NegativeLabScanMetricsRect,
  type NegativeLabScanMetricsV1,
  type NegativeLabScanMetricsWarningCode,
  negativeLabScanMetricsV1Schema,
} from '../schemas/negative-lab/negativeLabScanMetricsSchemas';

export interface NegativeLabScanMetricPixel {
  b: number;
  g: number;
  r: number;
}

export interface BuildNegativeLabScanMetricsParams {
  analysisCrop?: Partial<NegativeLabScanMetricsRect>;
  imageHeight: number;
  imageWidth: number;
  insetFraction?: number;
  pixels: readonly NegativeLabScanMetricPixel[];
  sampleStride?: number;
}

interface DensitySample {
  blue: number;
  green: number;
  luma: number;
  red: number;
}

const DEFAULT_ANALYSIS_CROP: NegativeLabScanMetricsRect = { height: 1, width: 1, x: 0, y: 0 };
const DEFAULT_INSET_FRACTION = 0.08;
const MIN_SAMPLE_COUNT = 16;
const LOW_DENSITY_P50 = 0.08;
const FLAT_P10_P90_RANGE = 0.025;
const BORDER_DENSITY_DELTA = 0.12;

const clamp = (value: number, minValue: number, maxValue: number) => Math.min(maxValue, Math.max(minValue, value));

const normalizeAnalysisCrop = (analysisCrop: Partial<NegativeLabScanMetricsRect> | undefined) => {
  const candidate = { ...DEFAULT_ANALYSIS_CROP, ...analysisCrop };
  const x = clamp(Number.isFinite(candidate.x) ? candidate.x : 0, 0, 0.999999);
  const y = clamp(Number.isFinite(candidate.y) ? candidate.y : 0, 0, 0.999999);
  const width = clamp(Number.isFinite(candidate.width) ? candidate.width : 1, 0.001, 1 - x);
  const height = clamp(Number.isFinite(candidate.height) ? candidate.height : 1, 0.001, 1 - y);
  return { height, width, x, y };
};

const normalizedRectToPixelRect = (
  rect: NegativeLabScanMetricsRect,
  imageWidth: number,
  imageHeight: number,
): NegativeLabScanMetricsRect => {
  const x = Math.floor(rect.x * imageWidth);
  const y = Math.floor(rect.y * imageHeight);
  const width = Math.max(1, Math.ceil(rect.width * imageWidth));
  const height = Math.max(1, Math.ceil(rect.height * imageHeight));
  return {
    height: Math.max(0, Math.min(height, imageHeight - y)),
    width: Math.max(0, Math.min(width, imageWidth - x)),
    x,
    y,
  };
};

const buildInsetPixelRect = (crop: NegativeLabScanMetricsRect, insetFraction: number): NegativeLabScanMetricsRect => {
  const insetX = Math.floor(crop.width * insetFraction);
  const insetY = Math.floor(crop.height * insetFraction);
  const x = crop.x + insetX;
  const y = crop.y + insetY;
  const width = Math.max(0, crop.width - insetX * 2);
  const height = Math.max(0, crop.height - insetY * 2);
  return { height, width, x, y };
};

const rectContains = (rect: NegativeLabScanMetricsRect, x: number, y: number) =>
  x >= rect.x && y >= rect.y && x < rect.x + rect.width && y < rect.y + rect.height;

const densityFromTransmittance = (value: number) => -Math.log10(value);

const percentile = (sortedValues: readonly number[], fraction: number): number => {
  if (sortedValues.length === 0) return 0;
  const position = (sortedValues.length - 1) * fraction;
  const lowerIndex = Math.floor(position);
  const upperIndex = Math.ceil(position);
  const lowerValue = sortedValues[lowerIndex] ?? 0;
  const upperValue = sortedValues[upperIndex] ?? lowerValue;
  if (lowerIndex === upperIndex) return lowerValue;
  const weight = position - lowerIndex;
  return lowerValue * (1 - weight) + upperValue * weight;
};

const buildPercentiles = (values: readonly number[]): NegativeLabScanMetricsPercentiles => {
  const sortedValues = [...values].sort((left, right) => left - right);
  return {
    p02: percentile(sortedValues, 0.02),
    p10: percentile(sortedValues, 0.1),
    p25: percentile(sortedValues, 0.25),
    p50: percentile(sortedValues, 0.5),
    p75: percentile(sortedValues, 0.75),
    p90: percentile(sortedValues, 0.9),
    p98: percentile(sortedValues, 0.98),
  };
};

const buildChannelMetrics = (channelValues: readonly number[], lumaValues: readonly number[]) => {
  const deviations = channelValues.map((value, index) => value - (lumaValues[index] ?? value));
  const deviationPercentiles = buildPercentiles(deviations);
  return {
    densityPercentiles: buildPercentiles(channelValues),
    deviationBounds: {
      lower: deviationPercentiles.p10,
      upper: deviationPercentiles.p90,
    },
  };
};

export const buildNegativeLabScanMetricsV1 = ({
  analysisCrop,
  imageHeight,
  imageWidth,
  insetFraction = DEFAULT_INSET_FRACTION,
  pixels,
  sampleStride = 1,
}: BuildNegativeLabScanMetricsParams): NegativeLabScanMetricsV1 => {
  const effectiveImageWidth = Math.max(1, Math.floor(imageWidth));
  const effectiveImageHeight = Math.max(1, Math.floor(imageHeight));
  const effectiveStride = Math.max(1, Math.floor(sampleStride));
  const normalizedCrop = normalizeAnalysisCrop(analysisCrop);
  const crop = normalizedRectToPixelRect(normalizedCrop, effectiveImageWidth, effectiveImageHeight);
  const insetCrop = buildInsetPixelRect(crop, clamp(insetFraction, 0, 0.45));
  const samples: DensitySample[] = [];
  const borderLumaDensities: number[] = [];
  let invalidSampleCount = 0;
  let nonpositiveTransmittanceCount = 0;
  let unityOrHigherTransmittanceCount = 0;

  for (let y = crop.y; y < crop.y + crop.height; y += effectiveStride) {
    for (let x = crop.x; x < crop.x + crop.width; x += effectiveStride) {
      const pixel = pixels[y * effectiveImageWidth + x];
      if (pixel === undefined || !Number.isFinite(pixel.r) || !Number.isFinite(pixel.g) || !Number.isFinite(pixel.b)) {
        invalidSampleCount += 1;
        continue;
      }

      const transmittanceValues = [pixel.r, pixel.g, pixel.b];
      nonpositiveTransmittanceCount += transmittanceValues.filter((value) => value <= 0).length;
      unityOrHigherTransmittanceCount += transmittanceValues.filter((value) => value >= 1).length;
      if (transmittanceValues.some((value) => value <= 0)) continue;

      const red = densityFromTransmittance(pixel.r);
      const green = densityFromTransmittance(pixel.g);
      const blue = densityFromTransmittance(pixel.b);
      const luma = red * 0.2126 + green * 0.7152 + blue * 0.0722;
      const sample = { blue, green, luma, red };
      if (rectContains(insetCrop, x, y)) {
        samples.push(sample);
      } else {
        borderLumaDensities.push(luma);
      }
    }
  }

  const lumaValues = samples.map((sample) => sample.luma);
  const redValues = samples.map((sample) => sample.red);
  const greenValues = samples.map((sample) => sample.green);
  const blueValues = samples.map((sample) => sample.blue);
  const lumaDensityPercentiles = buildPercentiles(lumaValues);
  const densityRangeUnclamped = lumaValues.length > 0 ? Math.max(...lumaValues) - Math.min(...lumaValues) : 0;
  const texturalDensityRangeP10P90 = lumaDensityPercentiles.p90 - lumaDensityPercentiles.p10;
  const borderDensityPercentiles = buildPercentiles(borderLumaDensities);
  const borderDensityDeltaFromInsetP50 =
    borderLumaDensities.length > 0 ? Math.abs(borderDensityPercentiles.p50 - lumaDensityPercentiles.p50) : 0;
  const warningCodes: NegativeLabScanMetricsWarningCode[] = [];

  if (samples.length < MIN_SAMPLE_COUNT) warningCodes.push('insufficient_density_samples');
  if (lumaDensityPercentiles.p50 < LOW_DENSITY_P50) warningCodes.push('low_density_frame');
  if (texturalDensityRangeP10P90 < FLAT_P10_P90_RANGE) warningCodes.push('near_flat_density_field');
  if (borderDensityDeltaFromInsetP50 > BORDER_DENSITY_DELTA) warningCodes.push('border_density_contamination');

  return negativeLabScanMetricsV1Schema.parse({
    analysisCrop: crop,
    border: {
      densityDeltaFromInsetP50: borderDensityDeltaFromInsetP50,
      sampleCount: borderLumaDensities.length,
    },
    channels: {
      blue: buildChannelMetrics(blueValues, lumaValues),
      green: buildChannelMetrics(greenValues, lumaValues),
      red: buildChannelMetrics(redValues, lumaValues),
    },
    clippingCounts: {
      invalidSampleCount,
      nonpositiveTransmittanceCount,
      unityOrHigherTransmittanceCount,
    },
    densityRangeUnclamped,
    geometry: {
      imageHeight: effectiveImageHeight,
      imageWidth: effectiveImageWidth,
      insetCrop,
      insetFraction: clamp(insetFraction, 0, 0.45),
      sampleStride: effectiveStride,
    },
    highDensityReference: lumaDensityPercentiles.p90,
    lumaDensityPercentiles,
    p50AnchorDensity: lumaDensityPercentiles.p50,
    sampleCount: samples.length,
    schemaVersion: NEGATIVE_LAB_SCAN_METRICS_SCHEMA_VERSION,
    shadowReference: lumaDensityPercentiles.p10,
    texturalDensityRangeP10P90,
    warningCodes,
  });
};
