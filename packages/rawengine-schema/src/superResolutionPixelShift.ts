import { z } from 'zod';

import {
  buildSuperResolutionReconstructionDiagnosticsV1,
  type SuperResolutionReconstructionDiagnosticsV1,
} from './superResolutionReconstructionDiagnostics.js';

export const superResolutionPixelShiftFrameV1Schema = z
  .object({
    pixels: z.instanceof(Float32Array),
    shiftX: z.number().int().nonnegative(),
    shiftY: z.number().int().nonnegative(),
  })
  .strict();

export const superResolutionPixelShiftRequestV1Schema = z
  .object({
    frames: z.array(superResolutionPixelShiftFrameV1Schema).min(2),
    height: z.number().int().positive(),
    scale: z.number().int().min(2).max(4),
    width: z.number().int().positive(),
  })
  .strict();

export type SuperResolutionPixelShiftFrameV1 = z.infer<typeof superResolutionPixelShiftFrameV1Schema>;
export type SuperResolutionPixelShiftRequestV1 = z.infer<typeof superResolutionPixelShiftRequestV1Schema>;

export interface SuperResolutionPixelShiftResultV1 {
  changedPixelRatioAgainstNearest: number;
  outputHeight: number;
  outputPixels: Float32Array;
  outputScale: number;
  outputWidth: number;
  reconstructionDiagnostics: SuperResolutionReconstructionDiagnosticsV1;
}

export const applyPixelShiftSuperResolutionV1 = (requestValue: unknown): SuperResolutionPixelShiftResultV1 => {
  const request = superResolutionPixelShiftRequestV1Schema.parse(requestValue);
  const outputWidth = request.width * request.scale;
  const outputHeight = request.height * request.scale;
  const outputPixels = new Float32Array(outputWidth * outputHeight);
  const weights = new Uint8Array(outputWidth * outputHeight);

  for (const frame of request.frames) {
    validateFrame(request, frame);
    for (let y = 0; y < request.height; y += 1) {
      for (let x = 0; x < request.width; x += 1) {
        const outputX = x * request.scale + frame.shiftX;
        const outputY = y * request.scale + frame.shiftY;
        const outputIndex = outputY * outputWidth + outputX;
        const sourceValue = frame.pixels[y * request.width + x] ?? 0;
        const outputValue = outputPixels[outputIndex] ?? 0;
        const outputWeight = weights[outputIndex] ?? 0;
        outputPixels[outputIndex] = outputValue + sourceValue;
        weights[outputIndex] = outputWeight + 1;
      }
    }
  }

  for (let index = 0; index < outputPixels.length; index += 1) {
    const weight = weights[index] ?? 0;
    if (weight === 0) {
      throw new Error(`Pixel-shift super-resolution left output pixel ${index} unfilled.`);
    }
    outputPixels[index] = (outputPixels[index] ?? 0) / weight;
  }
  const referenceFrame = request.frames[0];
  if (referenceFrame === undefined) {
    throw new Error('Pixel-shift super-resolution requires at least one reference frame.');
  }

  return {
    changedPixelRatioAgainstNearest: calculateChangedPixelRatio(
      outputPixels,
      createNearestNeighborBaselineV1(referenceFrame.pixels, request.width, request.height, request.scale),
    ),
    outputHeight,
    outputPixels,
    outputScale: request.scale,
    outputWidth,
    reconstructionDiagnostics: buildSuperResolutionReconstructionDiagnosticsV1({
      outputPixelCount: outputPixels.length,
      outputPixels,
      outputScale: request.scale,
      sampleCounts: weights,
    }),
  };
};

export const createNearestNeighborBaselineV1 = (
  pixels: Float32Array,
  width: number,
  height: number,
  scale: number,
): Float32Array => {
  const baseline = new Float32Array(width * scale * height * scale);
  const outputWidth = width * scale;

  for (let y = 0; y < height * scale; y += 1) {
    for (let x = 0; x < width * scale; x += 1) {
      baseline[y * outputWidth + x] = pixels[Math.floor(y / scale) * width + Math.floor(x / scale)] ?? 0;
    }
  }

  return baseline;
};

export const calculateMeanAbsoluteErrorV1 = (left: Float32Array, right: Float32Array): number => {
  if (left.length !== right.length) {
    throw new Error('Mean absolute error requires equal-length pixel buffers.');
  }

  let total = 0;
  for (let index = 0; index < left.length; index += 1) {
    total += Math.abs((left[index] ?? 0) - (right[index] ?? 0));
  }
  return total / left.length;
};

const calculateChangedPixelRatio = (left: Float32Array, right: Float32Array): number => {
  if (left.length !== right.length) {
    throw new Error('Changed-pixel ratio requires equal-length pixel buffers.');
  }

  let changed = 0;
  for (let index = 0; index < left.length; index += 1) {
    if (Math.abs((left[index] ?? 0) - (right[index] ?? 0)) > 0.001) changed += 1;
  }
  return changed / left.length;
};

const validateFrame = (request: SuperResolutionPixelShiftRequestV1, frame: SuperResolutionPixelShiftFrameV1): void => {
  if (frame.pixels.length !== request.width * request.height) {
    throw new Error('Pixel-shift frame dimensions do not match source geometry.');
  }
  if (frame.shiftX >= request.scale || frame.shiftY >= request.scale) {
    throw new Error('Pixel-shift frame shifts must be smaller than output scale.');
  }
};
