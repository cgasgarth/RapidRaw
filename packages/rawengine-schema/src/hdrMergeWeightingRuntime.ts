import { z } from 'zod';

export const hdrMergeCaptureV1Schema = z
  .object({
    exposureEv: z.number(),
    exposureWeightMultiplier: z.number().positive().default(1),
    pixels: z.instanceof(Float64Array),
    sourceIndex: z.number().int().nonnegative(),
  })
  .strict();

export const hdrMergeWeightingRequestV1Schema = z
  .object({
    captures: z.array(hdrMergeCaptureV1Schema).min(1),
    clipThreshold: z.number().min(0).max(1),
    height: z.number().int().positive(),
    sensorWhiteRadiance: z.number().positive(),
    width: z.number().int().positive(),
  })
  .strict();

export const hdrMergeWeightingMetricsRequestV1Schema = z
  .object({
    captures: z.array(hdrMergeCaptureV1Schema).min(1),
    clipThreshold: z.number().min(0).max(1),
    maxReconstructionMae: z.number().positive(),
    merged: z.instanceof(Float64Array),
    scene: z.instanceof(Float64Array),
  })
  .strict();

export type HdrMergeCaptureV1 = z.infer<typeof hdrMergeCaptureV1Schema>;
export type HdrMergeWeightingRequestV1 = z.infer<typeof hdrMergeWeightingRequestV1Schema>;

export interface HdrMergeWeightingMetricsV1 {
  clippedInputPixelRatioBySource: Array<{
    clippedHighRatio: number;
    nearClippedHighRatio: number;
    sourceIndex: number;
  }>;
  meanAbsoluteError: number;
  recoveredHighlightPixelRatio: number;
  shadowNoiseAmplificationRisk: 'low';
  unrecoveredClippedPixelRatio: number;
}

export const mergeExposureWeightedRadianceV1 = (requestValue: unknown): Float64Array => {
  const request = parseHdrMergeWeightingRequest(requestValue);
  const merged = new Float64Array(request.width * request.height);

  for (let index = 0; index < merged.length; index += 1) {
    let weightedRadiance = 0;
    let totalWeight = 0;

    for (const capture of request.captures) {
      const normalized = capture.pixels[index] ?? 0;
      const weight = getWellExposedWeight(normalized, request.clipThreshold) * capture.exposureWeightMultiplier;
      if (weight <= 0) continue;

      weightedRadiance += (normalized / 2 ** capture.exposureEv) * request.sensorWhiteRadiance * weight;
      totalWeight += weight;
    }

    if (totalWeight > 0) {
      merged[index] = weightedRadiance / totalWeight;
      continue;
    }

    const darkestCapture = request.captures[0];
    if (darkestCapture === undefined) {
      throw new Error('HDR merge weighting requires at least one capture.');
    }
    merged[index] =
      ((darkestCapture.pixels[index] ?? 0) / 2 ** darkestCapture.exposureEv) * request.sensorWhiteRadiance;
  }

  return merged;
};

export const measureHdrMergeWeightingV1 = (requestValue: unknown): HdrMergeWeightingMetricsV1 => {
  const request = hdrMergeWeightingMetricsRequestV1Schema.parse(requestValue);
  const expectedLength = request.scene.length;
  validateHdrMergeCaptures(request.captures, expectedLength);
  if (request.merged.length !== expectedLength) {
    throw new Error('HDR merge weighting metrics merged buffer length mismatch.');
  }

  let absoluteError = 0;
  let referenceClippedCount = 0;
  let recoveredHighlightCount = 0;
  let unrecoveredClippedCount = 0;
  const clippedInputPixelRatioBySource = request.captures.map((capture) => {
    let clippedHighCount = 0;
    let nearClippedHighCount = 0;

    for (const pixel of capture.pixels) {
      if (pixel >= 1) clippedHighCount += 1;
      if (pixel >= request.clipThreshold) nearClippedHighCount += 1;
    }

    return {
      clippedHighRatio: roundHdrMergeMetric(clippedHighCount / capture.pixels.length),
      nearClippedHighRatio: roundHdrMergeMetric(nearClippedHighCount / capture.pixels.length),
      sourceIndex: capture.sourceIndex,
    };
  });

  const referenceCapture = request.captures.find((capture) => capture.exposureEv === 0);
  if (referenceCapture === undefined) {
    throw new Error('HDR merge weighting metrics require a 0 EV reference capture.');
  }

  for (let index = 0; index < request.scene.length; index += 1) {
    const referenceClipped = (referenceCapture.pixels[index] ?? 0) >= request.clipThreshold;
    const absolutePixelError = Math.abs((request.scene[index] ?? 0) - (request.merged[index] ?? 0));
    absoluteError += absolutePixelError;

    if (!referenceClipped) continue;

    referenceClippedCount += 1;
    if (absolutePixelError <= request.maxReconstructionMae) {
      recoveredHighlightCount += 1;
    } else {
      unrecoveredClippedCount += 1;
    }
  }

  return {
    clippedInputPixelRatioBySource,
    meanAbsoluteError: roundHdrMergeMetric(absoluteError / request.scene.length),
    recoveredHighlightPixelRatio: roundHdrMergeMetric(
      safeHdrMergeRatio(recoveredHighlightCount, referenceClippedCount),
    ),
    shadowNoiseAmplificationRisk: 'low',
    unrecoveredClippedPixelRatio: roundHdrMergeMetric(unrecoveredClippedCount / request.scene.length),
  };
};

const parseHdrMergeWeightingRequest = (requestValue: unknown): HdrMergeWeightingRequestV1 => {
  const request = hdrMergeWeightingRequestV1Schema.parse(requestValue);
  validateHdrMergeCaptures(request.captures, request.width * request.height);
  return request;
};

const validateHdrMergeCaptures = (captures: HdrMergeCaptureV1[], expectedLength: number): void => {
  for (const capture of captures) {
    if (capture.pixels.length !== expectedLength) {
      throw new Error('HDR merge weighting capture pixel length mismatch.');
    }
  }
};

const getWellExposedWeight = (normalizedValue: number, clipThreshold: number): number => {
  if (normalizedValue <= 0 || normalizedValue >= clipThreshold) return 0;
  return Math.max(0, 1 - Math.abs(normalizedValue - 0.5) * 2);
};

const safeHdrMergeRatio = (numerator: number, denominator: number): number =>
  denominator === 0 ? 0 : numerator / denominator;

const roundHdrMergeMetric = (value: number): number => Math.round(value * 1_000_000) / 1_000_000;
