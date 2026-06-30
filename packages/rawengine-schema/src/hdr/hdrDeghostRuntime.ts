import { z } from 'zod';

export const hdrSyntheticFrameV1Schema = z
  .object({
    height: z.number().int().positive(),
    pixels: z.instanceof(Float64Array),
    sourceIndex: z.number().int().nonnegative(),
    width: z.number().int().positive(),
  })
  .strict();

export const hdrDeghostRequestV1Schema = z
  .object({
    frames: z.array(hdrSyntheticFrameV1Schema).min(2),
    motionThreshold: z.number().nonnegative(),
    referenceSourceIndex: z.number().int().nonnegative(),
  })
  .strict();

export const hdrDeghostMotionMaskV1Schema = z.instanceof(Uint8Array);
export const hdrDeghostConfidenceMapV1Schema = z.instanceof(Float64Array);
export const hdrDeghostPixelBufferV1Schema = z.instanceof(Float64Array);

export type HdrSyntheticFrameV1 = z.infer<typeof hdrSyntheticFrameV1Schema>;
export type HdrDeghostRequestV1 = z.infer<typeof hdrDeghostRequestV1Schema>;

export interface HdrMotionMaskMetricsV1 {
  falseNegative: number;
  falsePositive: number;
  precision: number;
  recall: number;
  truePositive: number;
}

export interface HdrDeghostConfidenceSummaryV1 {
  averageConfidence: number;
  maxConfidence: number;
  motionCoverageRatio: number;
}

export const detectHdrMotionMaskV1 = (requestValue: unknown): Uint8Array => {
  const { referenceFrame, request } = parseHdrDeghostRequest(requestValue);
  const motionMask = new Uint8Array(referenceFrame.pixels.length);

  for (let index = 0; index < referenceFrame.pixels.length; index += 1) {
    const referenceValue = referenceFrame.pixels[index] ?? 0;
    let maxDelta = 0;
    for (const frame of request.frames) {
      maxDelta = Math.max(maxDelta, Math.abs((frame.pixels[index] ?? 0) - referenceValue));
    }
    motionMask[index] = maxDelta >= request.motionThreshold ? 1 : 0;
  }

  return motionMask;
};

export const buildHdrDeghostConfidenceMapV1 = (requestValue: unknown): Float64Array => {
  const { referenceFrame, request } = parseHdrDeghostRequest(requestValue);
  const confidenceMap = new Float64Array(referenceFrame.pixels.length);
  const denominator = Math.max(request.motionThreshold, Number.EPSILON);

  for (let index = 0; index < referenceFrame.pixels.length; index += 1) {
    const referenceValue = referenceFrame.pixels[index] ?? 0;
    let maxDelta = 0;
    for (const frame of request.frames) {
      maxDelta = Math.max(maxDelta, Math.abs((frame.pixels[index] ?? 0) - referenceValue));
    }
    confidenceMap[index] = roundHdrMetric(Math.min(1, maxDelta / denominator));
  }

  return hdrDeghostConfidenceMapV1Schema.parse(confidenceMap);
};

export const summarizeHdrDeghostConfidenceMapV1 = (
  confidenceMapValue: unknown,
  motionMaskValue: unknown,
): HdrDeghostConfidenceSummaryV1 => {
  const confidenceMap = hdrDeghostConfidenceMapV1Schema.parse(confidenceMapValue);
  const motionMask = parseHdrMotionMask(motionMaskValue, confidenceMap.length);
  let total = 0;
  let maxConfidence = 0;

  for (const confidence of confidenceMap) {
    total += confidence;
    maxConfidence = Math.max(maxConfidence, confidence);
  }

  return {
    averageConfidence: roundHdrMetric(safeRatio(total, confidenceMap.length, 0)),
    maxConfidence: roundHdrMetric(maxConfidence),
    motionCoverageRatio: roundHdrMetric(countHdrMotionPixelsV1(motionMask) / motionMask.length),
  };
};

export const mergeHdrWithReferenceInMotionRegionsV1 = (
  requestValue: unknown,
  motionMaskValue: unknown,
): Float64Array => {
  const { referenceFrame, request } = parseHdrDeghostRequest(requestValue);
  const motionMask = parseHdrMotionMask(motionMaskValue, referenceFrame.pixels.length);
  const merged = new Float64Array(referenceFrame.pixels.length);

  for (let index = 0; index < merged.length; index += 1) {
    if (motionMask[index] === 1) {
      merged[index] = referenceFrame.pixels[index] ?? 0;
      continue;
    }

    let total = 0;
    for (const frame of request.frames) {
      total += frame.pixels[index] ?? 0;
    }
    merged[index] = total / request.frames.length;
  }

  return merged;
};

export const measureHdrMotionMaskV1 = (
  expectedMaskValue: unknown,
  detectedMaskValue: unknown,
): HdrMotionMaskMetricsV1 => {
  const expectedMask = hdrDeghostMotionMaskV1Schema.parse(expectedMaskValue);
  const detectedMask = parseHdrMotionMask(detectedMaskValue, expectedMask.length);
  let truePositive = 0;
  let falsePositive = 0;
  let falseNegative = 0;

  for (let index = 0; index < expectedMask.length; index += 1) {
    if (expectedMask[index] === 1 && detectedMask[index] === 1) truePositive += 1;
    if (expectedMask[index] === 0 && detectedMask[index] === 1) falsePositive += 1;
    if (expectedMask[index] === 1 && detectedMask[index] === 0) falseNegative += 1;
  }

  return {
    falseNegative,
    falsePositive,
    precision: roundHdrMetric(safeRatio(truePositive, truePositive + falsePositive, 1)),
    recall: roundHdrMetric(safeRatio(truePositive, truePositive + falseNegative, 1)),
    truePositive,
  };
};

export const measureHdrMotionRegionMaeV1 = (
  referencePixelsValue: unknown,
  candidatePixelsValue: unknown,
  motionMaskValue: unknown,
): number => {
  const referencePixels = hdrDeghostPixelBufferV1Schema.parse(referencePixelsValue);
  const candidatePixels = parseHdrPixelBuffer(candidatePixelsValue, referencePixels.length);
  const motionMask = parseHdrMotionMask(motionMaskValue, referencePixels.length);
  let absoluteError = 0;
  let count = 0;

  for (let index = 0; index < motionMask.length; index += 1) {
    if (motionMask[index] !== 1) continue;
    absoluteError += Math.abs((referencePixels[index] ?? 0) - (candidatePixels[index] ?? 0));
    count += 1;
  }

  if (count === 0) {
    throw new Error('HDR deghosting requires a non-empty motion region.');
  }

  return roundHdrMetric(absoluteError / count);
};

export const countHdrMotionPixelsV1 = (motionMaskValue: unknown): number => {
  const motionMask = hdrDeghostMotionMaskV1Schema.parse(motionMaskValue);
  let count = 0;
  for (const value of motionMask) {
    count += value === 1 ? 1 : 0;
  }
  return count;
};

const parseHdrDeghostRequest = (
  requestValue: unknown,
): {
  referenceFrame: HdrSyntheticFrameV1;
  request: HdrDeghostRequestV1;
} => {
  const request = hdrDeghostRequestV1Schema.parse(requestValue);
  const firstFrame = request.frames[0];
  if (firstFrame === undefined) {
    throw new Error('HDR deghosting requires at least one frame.');
  }

  const expectedPixelCount = firstFrame.width * firstFrame.height;
  for (const frame of request.frames) {
    if (frame.width !== firstFrame.width || frame.height !== firstFrame.height) {
      throw new Error('HDR deghosting requires equal-size frames.');
    }
    if (frame.pixels.length !== expectedPixelCount) {
      throw new Error('HDR deghosting frame pixel length does not match dimensions.');
    }
  }

  const referenceFrame = request.frames.find((frame) => frame.sourceIndex === request.referenceSourceIndex);
  if (referenceFrame === undefined) {
    throw new Error('HDR deghosting reference source index was not found.');
  }

  return { referenceFrame, request };
};

const parseHdrMotionMask = (motionMaskValue: unknown, expectedLength: number): Uint8Array => {
  const motionMask = hdrDeghostMotionMaskV1Schema.parse(motionMaskValue);
  if (motionMask.length !== expectedLength) {
    throw new Error('HDR deghosting motion mask length mismatch.');
  }
  return motionMask;
};

const parseHdrPixelBuffer = (pixelsValue: unknown, expectedLength: number): Float64Array => {
  const pixels = hdrDeghostPixelBufferV1Schema.parse(pixelsValue);
  if (pixels.length !== expectedLength) {
    throw new Error('HDR deghosting pixel buffer length mismatch.');
  }
  return pixels;
};

const safeRatio = (numerator: number, denominator: number, fallback: number): number =>
  denominator === 0 ? fallback : numerator / denominator;

const roundHdrMetric = (value: number): number => Math.round(value * 1_000_000) / 1_000_000;
