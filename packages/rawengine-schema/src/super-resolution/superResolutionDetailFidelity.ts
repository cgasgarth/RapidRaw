import { z } from 'zod';

import type { SuperResolutionRuntimeFrameV1 } from './superResolutionRuntimePlan.js';

export const superResolutionDetailReviewRegionV1Schema = z
  .object({
    baselineSharpnessScore: z.number().min(0),
    improvementRatio: z.number().min(0),
    label: z.string().trim().min(1),
    reconstructedSharpnessScore: z.number().min(0),
    regionId: z.string().trim().min(1),
    reviewStatus: z.enum(['accepted', 'needs_review', 'rejected']),
  })
  .strict();

export const superResolutionMeasuredReviewMetricsV1Schema = z
  .object({
    detailGainRatio: z.number().positive(),
    detailReviewRegions: z.array(superResolutionDetailReviewRegionV1Schema).length(3),
    downscaleReconstructionError: z.number().min(0),
    falseDetailRisk: z.enum(['low', 'medium', 'high']),
    falseDetailRiskScore: z.number().min(0).max(1),
  })
  .strict();

export type SuperResolutionMeasuredReviewMetricsV1 = z.infer<typeof superResolutionMeasuredReviewMetricsV1Schema>;

const REVIEW_REGIONS = [
  { label: 'center microcontrast', regionId: 'center-microcontrast', x0: 0.25, x1: 0.75, y0: 0.25, y1: 0.75 },
  { label: 'fine edge texture', regionId: 'fine-edge-texture', x0: 0.58, x1: 0.94, y0: 0.08, y1: 0.44 },
  { label: 'low-contrast detail', regionId: 'low-contrast-detail', x0: 0.08, x1: 0.44, y0: 0.56, y1: 0.92 },
] as const;

export const measureSuperResolutionDetailFidelityV1 = ({
  frames,
  outputHeight,
  outputPixels,
  outputScale,
  outputWidth,
  registrationResidualPx,
  weakSupportRatio,
}: {
  frames: SuperResolutionRuntimeFrameV1[];
  outputHeight: number;
  outputPixels: Float32Array;
  outputScale: number;
  outputWidth: number;
  registrationResidualPx: number;
  weakSupportRatio: number;
}): SuperResolutionMeasuredReviewMetricsV1 => {
  const referenceFrame = frames[0];
  if (referenceFrame === undefined) {
    throw new Error('Super-resolution detail fidelity requires at least one reference frame.');
  }
  const nearestBaseline = createNearestNeighborBaseline(
    referenceFrame.pixels,
    referenceFrame.width,
    referenceFrame.height,
    outputScale,
  );
  const outputGradientEnergy = measureGradientEnergy(outputPixels, outputWidth, outputHeight);
  const baselineGradientEnergy = measureGradientEnergy(nearestBaseline, outputWidth, outputHeight);
  const detailGainRatio = roundMetric(outputGradientEnergy / Math.max(1e-6, baselineGradientEnergy));
  const downscaleReconstructionError = roundMetric(
    measureDownscaleReconstructionError(frames, outputPixels, outputWidth, outputHeight, outputScale),
  );
  const falseDetailRiskScore = roundMetric(
    Math.max(
      normalizeRange(detailGainRatio, 1.35, 2.25) * 0.55 +
        normalizeRange(downscaleReconstructionError, 0.01, 0.06) * 0.25 +
        normalizeRange(registrationResidualPx, 0.1, 0.75) * 0.1 +
        normalizeRange(weakSupportRatio, 0.18, 0.45) * 0.1,
      registrationResidualPx > 0.75 ? 1 : 0,
    ),
  );
  const falseDetailRisk =
    falseDetailRiskScore >= 0.8 ||
    detailGainRatio >= 2.25 ||
    downscaleReconstructionError >= 0.06 ||
    weakSupportRatio >= 0.45
      ? 'high'
      : falseDetailRiskScore >= 0.45 ||
          detailGainRatio >= 1.75 ||
          downscaleReconstructionError >= 0.03 ||
          registrationResidualPx >= 0.4 ||
          weakSupportRatio >= 0.28
        ? 'medium'
        : 'low';

  return superResolutionMeasuredReviewMetricsV1Schema.parse({
    detailGainRatio,
    detailReviewRegions: REVIEW_REGIONS.map((region) => {
      const baselineCrop = cropRegion(nearestBaseline, outputWidth, outputHeight, region);
      const outputCrop = cropRegion(outputPixels, outputWidth, outputHeight, region);
      const baselineSharpnessScore = roundMetric(
        measureGradientEnergy(baselineCrop, cropWidth(outputWidth, region), cropHeight(outputHeight, region)),
      );
      const reconstructedSharpnessScore = roundMetric(
        measureGradientEnergy(outputCrop, cropWidth(outputWidth, region), cropHeight(outputHeight, region)),
      );
      const improvementRatio = roundMetric(reconstructedSharpnessScore / Math.max(1e-6, baselineSharpnessScore));
      const reviewStatus =
        falseDetailRisk === 'high' && (improvementRatio >= 1.7 || downscaleReconstructionError >= 0.04)
          ? 'rejected'
          : falseDetailRisk !== 'low' || improvementRatio < 1.04
            ? 'needs_review'
            : 'accepted';
      return {
        baselineSharpnessScore,
        improvementRatio,
        label: region.label,
        reconstructedSharpnessScore,
        regionId: region.regionId,
        reviewStatus,
      };
    }),
    downscaleReconstructionError,
    falseDetailRisk,
    falseDetailRiskScore,
  });
};

const createNearestNeighborBaseline = (
  sourcePixels: Float32Array,
  width: number,
  height: number,
  scale: number,
): Float32Array => {
  const output = new Float32Array(width * height * scale * scale);
  const outputWidth = width * scale;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const value = sourcePixels[y * width + x] ?? 0;
      for (let dy = 0; dy < scale; dy += 1) {
        for (let dx = 0; dx < scale; dx += 1) {
          output[(y * scale + dy) * outputWidth + x * scale + dx] = value;
        }
      }
    }
  }
  return output;
};

const measureGradientEnergy = (pixels: Float32Array, width: number, height: number): number => {
  let total = 0;
  let samples = 0;
  for (let y = 0; y < height - 1; y += 1) {
    for (let x = 0; x < width - 1; x += 1) {
      const index = y * width + x;
      const dx = Math.abs((pixels[index + 1] ?? 0) - (pixels[index] ?? 0));
      const dy = Math.abs((pixels[index + width] ?? 0) - (pixels[index] ?? 0));
      total += dx + dy;
      samples += 2;
    }
  }
  return total / Math.max(1, samples);
};

const measureDownscaleReconstructionError = (
  frames: SuperResolutionRuntimeFrameV1[],
  outputPixels: Float32Array,
  outputWidth: number,
  outputHeight: number,
  outputScale: number,
): number => {
  const downscaled = new Float32Array((outputWidth / outputScale) * (outputHeight / outputScale));
  const downscaledWidth = outputWidth / outputScale;
  const downscaledHeight = outputHeight / outputScale;
  for (let y = 0; y < downscaledHeight; y += 1) {
    for (let x = 0; x < downscaledWidth; x += 1) {
      let total = 0;
      for (let dy = 0; dy < outputScale; dy += 1) {
        for (let dx = 0; dx < outputScale; dx += 1) {
          total += outputPixels[(y * outputScale + dy) * outputWidth + x * outputScale + dx] ?? 0;
        }
      }
      downscaled[y * downscaledWidth + x] = total / (outputScale * outputScale);
    }
  }

  let totalError = 0;
  for (let index = 0; index < downscaled.length; index += 1) {
    const sourceMean = frames.reduce((sum, frame) => sum + (frame.pixels[index] ?? 0), 0) / Math.max(1, frames.length);
    totalError += Math.abs((downscaled[index] ?? 0) - sourceMean);
  }
  return totalError / Math.max(1, downscaled.length);
};

const cropRegion = (
  pixels: Float32Array,
  width: number,
  height: number,
  region: (typeof REVIEW_REGIONS)[number],
): Float32Array => {
  const x0 = Math.max(0, Math.floor(width * region.x0));
  const x1 = Math.min(width, Math.ceil(width * region.x1));
  const y0 = Math.max(0, Math.floor(height * region.y0));
  const y1 = Math.min(height, Math.ceil(height * region.y1));
  const cropped = new Float32Array(Math.max(1, x1 - x0) * Math.max(1, y1 - y0));
  let offset = 0;
  for (let y = y0; y < y1; y += 1) {
    for (let x = x0; x < x1; x += 1) {
      cropped[offset] = pixels[y * width + x] ?? 0;
      offset += 1;
    }
  }
  return cropped;
};

const cropWidth = (width: number, region: (typeof REVIEW_REGIONS)[number]): number =>
  Math.max(1, Math.min(width, Math.ceil(width * region.x1)) - Math.max(0, Math.floor(width * region.x0)));

const cropHeight = (height: number, region: (typeof REVIEW_REGIONS)[number]): number =>
  Math.max(1, Math.min(height, Math.ceil(height * region.y1)) - Math.max(0, Math.floor(height * region.y0)));

const normalizeRange = (value: number, low: number, high: number): number =>
  Math.max(0, Math.min(1, (value - low) / Math.max(1e-6, high - low)));

const roundMetric = (value: number): number => Math.round(value * 1_000_000) / 1_000_000;
