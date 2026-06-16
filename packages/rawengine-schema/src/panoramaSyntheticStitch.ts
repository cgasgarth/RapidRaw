import { z } from 'zod';

const BYTES_PER_PIXEL_RGBA = 4;
const MAX_SYNTHETIC_SOURCE_PIXELS = 1_000_000;

export const panoramaSyntheticSourceFrameV1Schema = z
  .object({
    expectedOffsetX: z.number().int().nonnegative().nullable(),
    expectedOffsetY: z.number().int().nullable(),
    height: z.number().int().positive(),
    sourceIndex: z.number().int().nonnegative(),
    width: z.number().int().positive(),
  })
  .strict();

export const panoramaSyntheticStitchRequestV1Schema = z
  .object({
    connectedSourceIndices: z.array(z.number().int().nonnegative()).min(1),
    expectedWarningCodes: z.array(z.string().min(1)),
    fixtureId: z.string().min(1),
    memoryBudgetBytes: z.number().int().positive(),
    seed: z.string().min(1),
    sourceFrames: z.array(panoramaSyntheticSourceFrameV1Schema).min(2),
  })
  .strict();

export type PanoramaSyntheticSourceFrameV1 = z.infer<typeof panoramaSyntheticSourceFrameV1Schema>;

export interface PanoramaSyntheticStitchResultV1 {
  excludedSourceCount: number;
  output: {
    height: number;
    projection: 'rectilinear';
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

  const bounds = calculatePanoramaBounds(connectedFrames);
  const outputPixels = canRenderSyntheticPanorama(connectedFrames)
    ? new Uint8Array(bounds.width * bounds.height * 3)
    : null;

  if (outputPixels !== null) {
    const weights = new Uint8Array(bounds.width * bounds.height);
    for (const sourceFrame of connectedFrames) {
      compositeSourceFrame(
        request.seed,
        sourceFrame,
        bounds.minLeft,
        bounds.minTop,
        outputPixels,
        weights,
        bounds.width,
      );
    }
    fillUncoveredPixels(outputPixels, weights);
  }

  const estimatedOutputBytes = bounds.width * bounds.height * BYTES_PER_PIXEL_RGBA;
  const warningCodes = new Set(request.expectedWarningCodes);
  if (request.sourceFrames.length > connectedFrames.length) warningCodes.add('excluded_sources');
  if (estimatedOutputBytes > request.memoryBudgetBytes) {
    warningCodes.add('memory_budget_exceeded');
    warningCodes.add('tiled_render_required');
  }

  return {
    excludedSourceCount: request.sourceFrames.length - connectedFrames.length,
    output: {
      height: bounds.height,
      projection: 'rectilinear',
      width: bounds.width,
    },
    outputPixels,
    stitchedSourceCount: connectedFrames.length,
    warningCodes: [...warningCodes].sort(),
  };
};

export const encodeSyntheticPanoramaPpmV1 = (pixels: Uint8Array, width: number, height: number): Uint8Array =>
  concatBytes(new TextEncoder().encode(`P6\n${width} ${height}\n255\n`), pixels);

const concatBytes = (left: Uint8Array, right: Uint8Array): Uint8Array => {
  const output = new Uint8Array(left.length + right.length);
  output.set(left, 0);
  output.set(right, left.length);
  return output;
};

const calculatePanoramaBounds = (connectedFrames: PanoramaSyntheticSourceFrameV1[]) => {
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
    width: maxRight - minLeft,
  };
};

const canRenderSyntheticPanorama = (connectedFrames: PanoramaSyntheticSourceFrameV1[]): boolean =>
  connectedFrames.every((sourceFrame) => sourceFrame.width * sourceFrame.height <= MAX_SYNTHETIC_SOURCE_PIXELS);

const compositeSourceFrame = (
  seed: string,
  sourceFrame: PanoramaSyntheticSourceFrameV1,
  minLeft: number,
  minTop: number,
  outputPixels: Uint8Array,
  weights: Uint8Array,
  outputWidth: number,
): void => {
  const offsetX = (sourceFrame.expectedOffsetX ?? 0) - minLeft;
  const offsetY = (sourceFrame.expectedOffsetY ?? 0) - minTop;
  for (let y = 0; y < sourceFrame.height; y += 1) {
    for (let x = 0; x < sourceFrame.width; x += 1) {
      const outputPixelIndex = (y + offsetY) * outputWidth + x + offsetX;
      const outputIndex = outputPixelIndex * 3;
      const oldWeight = weights[outputPixelIndex] ?? 0;
      const newWeight = oldWeight + 1;
      for (let channel = 0; channel < 3; channel += 1) {
        const oldValue = outputPixels[outputIndex + channel] ?? 0;
        const newValue = stablePanoramaByte(seed, sourceFrame, x, y, channel);
        outputPixels[outputIndex + channel] = Math.round((oldValue * oldWeight + newValue) / newWeight);
      }
      weights[outputPixelIndex] = newWeight;
    }
  }
};

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
  const stripe = Math.floor((x + Math.max(sourceFrame.expectedOffsetX ?? 0, 0)) / 20) % 2;
  const input = `${seed}:${sourceFrame.sourceIndex}:${x}:${y}:${channel}:${stripe}`;
  for (let index = 0; index < input.length; index += 1) {
    value ^= input.charCodeAt(index);
    value = Math.imul(value, 16777619) >>> 0;
  }
  return value % 256;
};
