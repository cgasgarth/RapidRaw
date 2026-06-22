import { z } from 'zod';

const BYTES_PER_PIXEL_RGBA = 4;
const MAX_SYNTHETIC_SOURCE_PIXELS = 1_000_000;
const MAX_EXPOSURE_GAIN = 4;
const MIN_EXPOSURE_GAIN = 0.25;
const MIN_EXPOSURE_OVERLAP_SAMPLES = 16;

export const panoramaSyntheticSourceFrameV1Schema = z
  .object({
    expectedOffsetX: z.number().int().nonnegative().nullable(),
    expectedOffsetY: z.number().int().nullable(),
    exposureEv: z.number().default(0),
    height: z.number().int().positive(),
    sourceIndex: z.number().int().nonnegative(),
    width: z.number().int().positive(),
  })
  .strict();

export const panoramaSyntheticStitchRequestV1Schema = z
  .object({
    connectedSourceIndices: z.array(z.number().int().nonnegative()).min(1),
    exposureNormalization: z.enum(['none', 'auto', 'gain_compensation']).default('none'),
    expectedWarningCodes: z.array(z.string().min(1)),
    fixtureId: z.string().min(1),
    memoryBudgetBytes: z.number().int().positive(),
    projection: z.enum(['rectilinear', 'cylindrical']).default('rectilinear'),
    seed: z.string().min(1),
    seamExposureCompensationPercent: z.number().int().min(0).max(100).default(100),
    sourceFrames: z.array(panoramaSyntheticSourceFrameV1Schema).min(2),
  })
  .strict();

export type PanoramaSyntheticSourceFrameV1 = z.infer<typeof panoramaSyntheticSourceFrameV1Schema>;

export interface PanoramaSyntheticExposureNormalizationV1 {
  appliedGainCount?: number;
  appliedLuminanceGains?: Array<{
    gain: number;
    sourceIndex: number;
  }>;
  compensationStrengthPercent?: number;
  mode: 'none' | 'scalar_overlap_luminance_gain_v1';
  overlapMetrics?: {
    medianLogLuminanceDeltaAfter?: number;
    medianLogLuminanceDeltaBefore?: number;
  };
  skippedReason?: 'insufficient_overlap' | 'not_requested';
  support: 'implemented_current_engine';
}

interface ExposureDeltaSample {
  after: number;
  before: number;
}

interface EstimatedExposureGain {
  gain: number;
  sampleCount: number;
  samples: ExposureDeltaSample[];
}

export interface PanoramaSyntheticStitchResultV1 {
  exposureNormalization: PanoramaSyntheticExposureNormalizationV1;
  excludedSourceCount: number;
  output: {
    height: number;
    projection: 'rectilinear' | 'cylindrical';
    width: number;
  };
  outputPixels: Uint8Array | null;
  stitchedSourceCount: number;
  warningCodes: string[];
}

export const renderSyntheticPanoramaStitchV1 = (requestValue: unknown): PanoramaSyntheticStitchResultV1 => {
  const request = panoramaSyntheticStitchRequestV1Schema.parse(requestValue);
  const connected = new Set(request.connectedSourceIndices);
  const connectedFrames = request.sourceFrames.filter((sourceFrame) => connected.has(sourceFrame.sourceIndex));
  if (connectedFrames.length === 0) {
    throw new Error('Synthetic panorama stitch requires at least one connected source.');
  }

  const bounds = calculatePanoramaBounds(connectedFrames, request.projection);
  const outputPixels = canRenderSyntheticPanorama(connectedFrames)
    ? new Uint8Array(bounds.outputWidth * bounds.height * 3)
    : null;

  if (outputPixels !== null) {
    const weights = new Uint8Array(bounds.outputWidth * bounds.height);
    const exposureSamples: ExposureDeltaSample[] = [];
    const appliedLuminanceGains: Array<{ gain: number; sourceIndex: number }> = [];
    for (const sourceFrame of connectedFrames) {
      const exposureGain =
        request.exposureNormalization === 'none'
          ? ({ gain: 1, sampleCount: 0, samples: [] } satisfies EstimatedExposureGain)
          : estimateSourceExposureGain(
              request.seed,
              sourceFrame,
              bounds.minLeft,
              bounds.minTop,
              outputPixels,
              weights,
              bounds,
              request.projection,
              request.seamExposureCompensationPercent,
            );
      compositeSourceFrame(
        request.seed,
        sourceFrame,
        bounds.minLeft,
        bounds.minTop,
        outputPixels,
        weights,
        bounds,
        exposureGain.gain,
        request.projection,
      );
      if (exposureGain.sampleCount >= MIN_EXPOSURE_OVERLAP_SAMPLES) {
        appliedLuminanceGains.push({ gain: roundMetric(exposureGain.gain), sourceIndex: sourceFrame.sourceIndex });
        exposureSamples.push(...exposureGain.samples);
      }
    }
    fillUncoveredPixels(outputPixels, weights);
    return buildSyntheticStitchResult({
      appliedLuminanceGains,
      bounds,
      connectedFrames,
      exposureSamples,
      outputPixels,
      request,
    });
  }

  return buildSyntheticStitchResult({
    appliedLuminanceGains: [],
    bounds,
    connectedFrames,
    exposureSamples: [],
    outputPixels,
    request,
  });
};

export const encodeSyntheticPanoramaPpmV1 = (pixels: Uint8Array, width: number, height: number): Uint8Array =>
  concatBytes(new TextEncoder().encode(`P6\n${width} ${height}\n255\n`), pixels);

const buildSyntheticStitchResult = ({
  appliedLuminanceGains,
  bounds,
  connectedFrames,
  exposureSamples,
  outputPixels,
  request,
}: {
  appliedLuminanceGains: Array<{ gain: number; sourceIndex: number }>;
  bounds: ReturnType<typeof calculatePanoramaBounds>;
  connectedFrames: PanoramaSyntheticSourceFrameV1[];
  exposureSamples: ExposureDeltaSample[];
  outputPixels: Uint8Array | null;
  request: z.infer<typeof panoramaSyntheticStitchRequestV1Schema>;
}): PanoramaSyntheticStitchResultV1 => {
  const estimatedOutputBytes = bounds.outputWidth * bounds.height * BYTES_PER_PIXEL_RGBA;
  const warningCodes = new Set(request.expectedWarningCodes);
  if (request.sourceFrames.length > connectedFrames.length) warningCodes.add('excluded_sources');
  if (estimatedOutputBytes > request.memoryBudgetBytes) {
    warningCodes.add('memory_budget_exceeded');
    warningCodes.add('tiled_render_required');
  }

  return {
    exposureNormalization: buildExposureNormalizationResult(
      request.exposureNormalization,
      appliedLuminanceGains,
      exposureSamples,
      request.seamExposureCompensationPercent,
    ),
    excludedSourceCount: request.sourceFrames.length - connectedFrames.length,
    output: {
      height: bounds.height,
      projection: request.projection,
      width: bounds.outputWidth,
    },
    outputPixels,
    stitchedSourceCount: connectedFrames.length,
    warningCodes: [...warningCodes].sort(),
  };
};

const concatBytes = (left: Uint8Array, right: Uint8Array): Uint8Array => {
  const output = new Uint8Array(left.length + right.length);
  output.set(left, 0);
  output.set(right, left.length);
  return output;
};

const calculatePanoramaBounds = (
  connectedFrames: PanoramaSyntheticSourceFrameV1[],
  projection: z.infer<typeof panoramaSyntheticStitchRequestV1Schema>['projection'],
) => {
  const maxRight = Math.max(
    ...connectedFrames.map((sourceFrame) => (sourceFrame.expectedOffsetX ?? 0) + sourceFrame.width),
  );
  const minLeft = Math.min(...connectedFrames.map((sourceFrame) => sourceFrame.expectedOffsetX ?? 0));
  const maxBottom = Math.max(
    ...connectedFrames.map((sourceFrame) => (sourceFrame.expectedOffsetY ?? 0) + sourceFrame.height),
  );
  const minTop = Math.min(...connectedFrames.map((sourceFrame) => sourceFrame.expectedOffsetY ?? 0));
  return {
    height: maxBottom - minTop,
    minLeft,
    minTop,
    outputWidth:
      projection === 'cylindrical' ? Math.max(1, Math.round((maxRight - minLeft) * 0.94)) : maxRight - minLeft,
    width: maxRight - minLeft,
  };
};

const canRenderSyntheticPanorama = (connectedFrames: PanoramaSyntheticSourceFrameV1[]): boolean =>
  connectedFrames.every((sourceFrame) => sourceFrame.width * sourceFrame.height <= MAX_SYNTHETIC_SOURCE_PIXELS);

const mapPanoramaProjectionX = (
  rectilinearX: number,
  bounds: ReturnType<typeof calculatePanoramaBounds>,
  projection: z.infer<typeof panoramaSyntheticStitchRequestV1Schema>['projection'],
): number => {
  if (projection === 'rectilinear' || bounds.width <= 1) return rectilinearX;
  const normalized = (rectilinearX / (bounds.width - 1)) * 2 - 1;
  const halfFovRadians = 0.75;
  const cylindrical = Math.atan(normalized * Math.tan(halfFovRadians)) / halfFovRadians;
  return Math.round(((cylindrical + 1) / 2) * (bounds.outputWidth - 1));
};

const compositeSourceFrame = (
  seed: string,
  sourceFrame: PanoramaSyntheticSourceFrameV1,
  minLeft: number,
  minTop: number,
  outputPixels: Uint8Array,
  weights: Uint8Array,
  bounds: ReturnType<typeof calculatePanoramaBounds>,
  exposureGain: number,
  projection: z.infer<typeof panoramaSyntheticStitchRequestV1Schema>['projection'],
): void => {
  const offsetX = (sourceFrame.expectedOffsetX ?? 0) - minLeft;
  const offsetY = (sourceFrame.expectedOffsetY ?? 0) - minTop;
  for (let y = 0; y < sourceFrame.height; y += 1) {
    for (let x = 0; x < sourceFrame.width; x += 1) {
      const mappedX = mapPanoramaProjectionX(x + offsetX, bounds, projection);
      if (mappedX < 0 || mappedX >= bounds.outputWidth) continue;
      const outputPixelIndex = (y + offsetY) * bounds.outputWidth + mappedX;
      const outputIndex = outputPixelIndex * 3;
      const oldWeight = weights[outputPixelIndex] ?? 0;
      const newWeight = oldWeight + 1;
      for (let channel = 0; channel < 3; channel += 1) {
        const oldValue = outputPixels[outputIndex + channel] ?? 0;
        const newValue = exposureAdjustedPanoramaByte(seed, sourceFrame, x, y, channel, exposureGain);
        outputPixels[outputIndex + channel] = Math.round((oldValue * oldWeight + newValue) / newWeight);
      }
      weights[outputPixelIndex] = newWeight;
    }
  }
};

const estimateSourceExposureGain = (
  seed: string,
  sourceFrame: PanoramaSyntheticSourceFrameV1,
  minLeft: number,
  minTop: number,
  outputPixels: Uint8Array,
  weights: Uint8Array,
  bounds: ReturnType<typeof calculatePanoramaBounds>,
  projection: z.infer<typeof panoramaSyntheticStitchRequestV1Schema>['projection'],
  compensationStrengthPercent: number,
): EstimatedExposureGain => {
  const offsetX = (sourceFrame.expectedOffsetX ?? 0) - minLeft;
  const offsetY = (sourceFrame.expectedOffsetY ?? 0) - minTop;
  const ratios: number[] = [];
  for (let y = 0; y < sourceFrame.height; y += 1) {
    for (let x = 0; x < sourceFrame.width; x += 1) {
      const mappedX = mapPanoramaProjectionX(x + offsetX, bounds, projection);
      if (mappedX < 0 || mappedX >= bounds.outputWidth) continue;
      const outputPixelIndex = (y + offsetY) * bounds.outputWidth + mappedX;
      if ((weights[outputPixelIndex] ?? 0) === 0) continue;
      const outputIndex = outputPixelIndex * 3;
      const targetLuminance = rgbLuminance(
        outputPixels[outputIndex] ?? 0,
        outputPixels[outputIndex + 1] ?? 0,
        outputPixels[outputIndex + 2] ?? 0,
      );
      const sourceLuminance = rgbLuminance(
        exposureAdjustedPanoramaByte(seed, sourceFrame, x, y, 0, 1),
        exposureAdjustedPanoramaByte(seed, sourceFrame, x, y, 1, 1),
        exposureAdjustedPanoramaByte(seed, sourceFrame, x, y, 2, 1),
      );
      if (targetLuminance <= 0 || sourceLuminance <= 0) continue;
      ratios.push(targetLuminance / sourceLuminance);
    }
  }

  if (ratios.length < MIN_EXPOSURE_OVERLAP_SAMPLES) return { gain: 1, sampleCount: ratios.length, samples: [] };
  const rawGain = clamp(median(ratios), MIN_EXPOSURE_GAIN, MAX_EXPOSURE_GAIN);
  const gain = 1 + (rawGain - 1) * (compensationStrengthPercent / 100);
  return {
    gain,
    sampleCount: ratios.length,
    samples: ratios.map((ratio) => ({
      after: Math.abs(Math.log2(ratio / gain)),
      before: Math.abs(Math.log2(ratio)),
    })),
  };
};

const buildExposureNormalizationResult = (
  requestedMode: z.infer<typeof panoramaSyntheticStitchRequestV1Schema>['exposureNormalization'],
  appliedLuminanceGains: Array<{ gain: number; sourceIndex: number }>,
  exposureSamples: ExposureDeltaSample[],
  compensationStrengthPercent: number,
): PanoramaSyntheticExposureNormalizationV1 => {
  if (requestedMode === 'none') {
    return {
      mode: 'none',
      skippedReason: 'not_requested',
      support: 'implemented_current_engine',
    };
  }
  if (appliedLuminanceGains.length === 0) {
    return {
      mode: 'none',
      skippedReason: 'insufficient_overlap',
      support: 'implemented_current_engine',
    };
  }
  return {
    appliedGainCount: appliedLuminanceGains.length,
    appliedLuminanceGains,
    compensationStrengthPercent,
    mode: 'scalar_overlap_luminance_gain_v1',
    overlapMetrics: {
      medianLogLuminanceDeltaAfter: roundMetric(median(exposureSamples.map((sample) => sample.after))),
      medianLogLuminanceDeltaBefore: roundMetric(median(exposureSamples.map((sample) => sample.before))),
    },
    support: 'implemented_current_engine',
  };
};

const exposureAdjustedPanoramaByte = (
  seed: string,
  sourceFrame: PanoramaSyntheticSourceFrameV1,
  x: number,
  y: number,
  channel: number,
  exposureGain: number,
): number =>
  clampByte(
    Math.round(stablePanoramaByte(seed, sourceFrame, x, y, channel) * sourceExposureGain(sourceFrame) * exposureGain),
  );

const fillUncoveredPixels = (outputPixels: Uint8Array, weights: Uint8Array): void => {
  for (let pixelIndex = 0; pixelIndex < weights.length; pixelIndex += 1) {
    if ((weights[pixelIndex] ?? 0) > 0) continue;
    const outputIndex = pixelIndex * 3;
    outputPixels[outputIndex] = 16;
    outputPixels[outputIndex + 1] = 16;
    outputPixels[outputIndex + 2] = 16;
  }
};

const stablePanoramaByte = (
  seed: string,
  sourceFrame: PanoramaSyntheticSourceFrameV1,
  x: number,
  y: number,
  channel: number,
): number => {
  let value = 2166136261;
  const worldX = x + (sourceFrame.expectedOffsetX ?? 0);
  const worldY = y + (sourceFrame.expectedOffsetY ?? 0);
  const stripe = Math.floor(Math.max(worldX, 0) / 20) % 2;
  const input = `${seed}:${worldX}:${worldY}:${channel}:${stripe}`;
  for (let index = 0; index < input.length; index += 1) {
    value ^= input.charCodeAt(index);
    value = Math.imul(value, 16777619) >>> 0;
  }
  return value % 256;
};

const rgbLuminance = (red: number, green: number, blue: number): number =>
  0.2126 * red + 0.7152 * green + 0.0722 * blue;

const sourceExposureGain = (sourceFrame: PanoramaSyntheticSourceFrameV1): number => 2 ** sourceFrame.exposureEv;

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

const clampByte = (value: number): number => clamp(value, 0, 255);

const median = (values: number[]): number => {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const midpoint = Math.floor(sorted.length / 2);
  const value =
    sorted.length % 2 === 0 ? ((sorted[midpoint - 1] ?? 0) + (sorted[midpoint] ?? 0)) / 2 : sorted[midpoint];
  return value ?? 0;
};

const roundMetric = (value: number): number => Number(value.toFixed(6));
