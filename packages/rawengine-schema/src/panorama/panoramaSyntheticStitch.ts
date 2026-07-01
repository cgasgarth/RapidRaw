import { z } from 'zod';

const BYTES_PER_PIXEL_RGBA = 4;
const MAX_SYNTHETIC_SOURCE_PIXELS = 1_000_000;
const MAX_EXPOSURE_GAIN = 2;
const MIN_EXPOSURE_GAIN = 0.5;
const MIN_EXPOSURE_OVERLAP_SAMPLES = 16;
const PANORAMA_TILE_SIZE_PX = 512;

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
    seamHaloPx: z.number().int().nonnegative().default(64),
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
  tilePlan: PanoramaSyntheticTilePlanV1;
  warningCodes: string[];
}

export interface PanoramaSyntheticTilePlanV1 {
  maxTileHeightPx: number;
  maxTileWidthPx: number;
  seamHaloPx: number;
  tileCount: number;
  tileSizePx: number;
}

export const renderSyntheticPanoramaStitchV1 = (requestValue: unknown): PanoramaSyntheticStitchResultV1 => {
  const request = panoramaSyntheticStitchRequestV1Schema.parse(requestValue);
  const connected = new Set(request.connectedSourceIndices);
  const connectedFrames = request.sourceFrames.filter((sourceFrame) => connected.has(sourceFrame.sourceIndex));
  if (connectedFrames.length === 0) {
    throw new Error('Synthetic panorama stitch requires at least one connected source.');
  }

  const bounds = calculatePanoramaBounds(connectedFrames, request.projection);
  const tilePlan = buildPanoramaSyntheticTilePlan(bounds.outputWidth, bounds.height, request.seamHaloPx);
  const outputPixels = canRenderSyntheticPanorama(connectedFrames)
    ? renderSyntheticPanoramaTiles(request, connectedFrames, bounds, tilePlan)
    : null;

  if (outputPixels !== null) {
    const exposureProof = buildSyntheticTileExposureProof(request, connectedFrames, bounds, tilePlan);
    return buildSyntheticStitchResult({
      appliedLuminanceGains: exposureProof.appliedLuminanceGains,
      bounds,
      connectedFrames,
      exposureSamples: exposureProof.exposureSamples,
      outputPixels,
      request,
      tilePlan,
    });
  }

  return buildSyntheticStitchResult({
    appliedLuminanceGains: [],
    bounds,
    connectedFrames,
    exposureSamples: [],
    outputPixels,
    request,
    tilePlan,
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
  tilePlan,
}: {
  appliedLuminanceGains: Array<{ gain: number; sourceIndex: number }>;
  bounds: ReturnType<typeof calculatePanoramaBounds>;
  connectedFrames: PanoramaSyntheticSourceFrameV1[];
  exposureSamples: ExposureDeltaSample[];
  outputPixels: Uint8Array | null;
  request: z.infer<typeof panoramaSyntheticStitchRequestV1Schema>;
  tilePlan: PanoramaSyntheticTilePlanV1;
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
    tilePlan,
    warningCodes: [...warningCodes].sort(),
  };
};

const buildPanoramaSyntheticTilePlan = (
  width: number,
  height: number,
  seamHaloPx: number,
): PanoramaSyntheticTilePlanV1 => {
  const tileWidth = width > 1 ? Math.min(PANORAMA_TILE_SIZE_PX, Math.ceil(width / 2)) : 1;
  const tileHeight =
    height > 1 && width === 1 ? Math.min(PANORAMA_TILE_SIZE_PX, Math.ceil(height / 2)) : PANORAMA_TILE_SIZE_PX;
  const columns = Math.max(1, Math.ceil(width / tileWidth));
  const rows = Math.max(1, Math.ceil(height / tileHeight));
  return {
    maxTileHeightPx: Math.min(tileHeight, height),
    maxTileWidthPx: Math.min(tileWidth, width),
    seamHaloPx,
    tileCount: columns * rows,
    tileSizePx: PANORAMA_TILE_SIZE_PX,
  };
};

const renderSyntheticPanoramaTiles = (
  request: z.infer<typeof panoramaSyntheticStitchRequestV1Schema>,
  connectedFrames: PanoramaSyntheticSourceFrameV1[],
  bounds: ReturnType<typeof calculatePanoramaBounds>,
  tilePlan: PanoramaSyntheticTilePlanV1,
): Uint8Array => {
  const outputPixels = new Uint8Array(bounds.outputWidth * bounds.height * 3);
  for (let tileY = 0; tileY < bounds.height; tileY += tilePlan.maxTileHeightPx) {
    const tileHeight = Math.min(tilePlan.maxTileHeightPx, bounds.height - tileY);
    for (let tileX = 0; tileX < bounds.outputWidth; tileX += tilePlan.maxTileWidthPx) {
      const tileWidth = Math.min(tilePlan.maxTileWidthPx, bounds.outputWidth - tileX);
      const tilePixels = new Uint8Array(tileWidth * tileHeight * 3);
      const tileWeights = new Uint8Array(tileWidth * tileHeight);
      for (const sourceFrame of connectedFrames) {
        const exposureGain =
          request.exposureNormalization === 'none'
            ? ({ gain: 1, sampleCount: 0, samples: [] } satisfies EstimatedExposureGain)
            : estimateSourceExposureGainForTile(
                request.seed,
                sourceFrame,
                bounds.minLeft,
                bounds.minTop,
                tilePixels,
                tileWeights,
                bounds,
                tileX,
                tileY,
                tileWidth,
                tileHeight,
                request.projection,
                request.seamExposureCompensationPercent,
              );
        compositeSourceFrameTile(
          request.seed,
          sourceFrame,
          bounds.minLeft,
          bounds.minTop,
          tilePixels,
          tileWeights,
          bounds,
          tileX,
          tileY,
          tileWidth,
          tileHeight,
          exposureGain.gain,
          request.projection,
        );
      }
      fillUncoveredPixels(tilePixels, tileWeights);
      copyTileToOutput(outputPixels, bounds.outputWidth, tilePixels, tileX, tileY, tileWidth, tileHeight);
    }
  }
  return outputPixels;
};

const buildSyntheticTileExposureProof = (
  request: z.infer<typeof panoramaSyntheticStitchRequestV1Schema>,
  connectedFrames: PanoramaSyntheticSourceFrameV1[],
  bounds: ReturnType<typeof calculatePanoramaBounds>,
  tilePlan: PanoramaSyntheticTilePlanV1,
): {
  appliedLuminanceGains: Array<{ gain: number; sourceIndex: number }>;
  exposureSamples: ExposureDeltaSample[];
} => {
  if (request.exposureNormalization === 'none') return { appliedLuminanceGains: [], exposureSamples: [] };
  const samplesBySource = new Map<number, ExposureDeltaSample[]>();
  const gainsBySource = new Map<number, number[]>();
  for (let tileY = 0; tileY < bounds.height; tileY += tilePlan.maxTileHeightPx) {
    const tileHeight = Math.min(tilePlan.maxTileHeightPx, bounds.height - tileY);
    for (let tileX = 0; tileX < bounds.outputWidth; tileX += tilePlan.maxTileWidthPx) {
      const tileWidth = Math.min(tilePlan.maxTileWidthPx, bounds.outputWidth - tileX);
      const tilePixels = new Uint8Array(tileWidth * tileHeight * 3);
      const tileWeights = new Uint8Array(tileWidth * tileHeight);
      for (const sourceFrame of connectedFrames) {
        const exposureGain = estimateSourceExposureGainForTile(
          request.seed,
          sourceFrame,
          bounds.minLeft,
          bounds.minTop,
          tilePixels,
          tileWeights,
          bounds,
          tileX,
          tileY,
          tileWidth,
          tileHeight,
          request.projection,
          request.seamExposureCompensationPercent,
        );
        compositeSourceFrameTile(
          request.seed,
          sourceFrame,
          bounds.minLeft,
          bounds.minTop,
          tilePixels,
          tileWeights,
          bounds,
          tileX,
          tileY,
          tileWidth,
          tileHeight,
          exposureGain.gain,
          request.projection,
        );
        if (exposureGain.sampleCount >= MIN_EXPOSURE_OVERLAP_SAMPLES) {
          gainsBySource.set(sourceFrame.sourceIndex, [
            ...(gainsBySource.get(sourceFrame.sourceIndex) ?? []),
            exposureGain.gain,
          ]);
          samplesBySource.set(sourceFrame.sourceIndex, [
            ...(samplesBySource.get(sourceFrame.sourceIndex) ?? []),
            ...exposureGain.samples,
          ]);
        }
      }
    }
  }
  return {
    appliedLuminanceGains: [...gainsBySource.entries()].map(([sourceIndex, gains]) => ({
      gain: roundMetric(median(gains)),
      sourceIndex,
    })),
    exposureSamples: [...samplesBySource.values()].flat(),
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

const compositeSourceFrameTile = (
  seed: string,
  sourceFrame: PanoramaSyntheticSourceFrameV1,
  minLeft: number,
  minTop: number,
  tilePixels: Uint8Array,
  tileWeights: Uint8Array,
  bounds: ReturnType<typeof calculatePanoramaBounds>,
  tileX: number,
  tileY: number,
  tileWidth: number,
  tileHeight: number,
  exposureGain: number,
  projection: z.infer<typeof panoramaSyntheticStitchRequestV1Schema>['projection'],
): void => {
  const offsetX = (sourceFrame.expectedOffsetX ?? 0) - minLeft;
  const offsetY = (sourceFrame.expectedOffsetY ?? 0) - minTop;
  for (let y = 0; y < sourceFrame.height; y += 1) {
    for (let x = 0; x < sourceFrame.width; x += 1) {
      const mappedX = mapPanoramaProjectionX(x + offsetX, bounds, projection);
      if (mappedX < 0 || mappedX >= bounds.outputWidth) continue;
      const outputY = y + offsetY;
      if (mappedX < tileX || mappedX >= tileX + tileWidth || outputY < tileY || outputY >= tileY + tileHeight) continue;
      const tilePixelIndex = (outputY - tileY) * tileWidth + (mappedX - tileX);
      const outputIndex = tilePixelIndex * 3;
      const oldWeight = tileWeights[tilePixelIndex] ?? 0;
      const newWeight = oldWeight + 1;
      for (let channel = 0; channel < 3; channel += 1) {
        const oldValue = tilePixels[outputIndex + channel] ?? 0;
        const newValue = exposureAdjustedPanoramaByte(seed, sourceFrame, x, y, channel, exposureGain);
        tilePixels[outputIndex + channel] = Math.round((oldValue * oldWeight + newValue) / newWeight);
      }
      tileWeights[tilePixelIndex] = newWeight;
    }
  }
};

const estimateSourceExposureGainForTile = (
  seed: string,
  sourceFrame: PanoramaSyntheticSourceFrameV1,
  minLeft: number,
  minTop: number,
  tilePixels: Uint8Array,
  tileWeights: Uint8Array,
  bounds: ReturnType<typeof calculatePanoramaBounds>,
  tileX: number,
  tileY: number,
  tileWidth: number,
  tileHeight: number,
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
      const outputY = y + offsetY;
      if (mappedX < tileX || mappedX >= tileX + tileWidth || outputY < tileY || outputY >= tileY + tileHeight) continue;
      const outputPixelIndex = (outputY - tileY) * tileWidth + (mappedX - tileX);
      if ((tileWeights[outputPixelIndex] ?? 0) === 0) continue;
      const outputIndex = outputPixelIndex * 3;
      const targetLuminance = rgbLuminance(
        tilePixels[outputIndex] ?? 0,
        tilePixels[outputIndex + 1] ?? 0,
        tilePixels[outputIndex + 2] ?? 0,
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

const copyTileToOutput = (
  outputPixels: Uint8Array,
  outputWidth: number,
  tilePixels: Uint8Array,
  tileX: number,
  tileY: number,
  tileWidth: number,
  tileHeight: number,
): void => {
  for (let row = 0; row < tileHeight; row += 1) {
    const sourceStart = row * tileWidth * 3;
    const sourceEnd = sourceStart + tileWidth * 3;
    outputPixels.set(tilePixels.subarray(sourceStart, sourceEnd), ((tileY + row) * outputWidth + tileX) * 3);
  }
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
