import { z } from 'zod';

export const hdrAlignmentFrameV1Schema = z
  .object({
    height: z.number().int().positive(),
    pixels: z.instanceof(Float64Array),
    sourceIndex: z.number().int().nonnegative(),
    width: z.number().int().positive(),
  })
  .strict();

export const hdrAlignmentRequestV1Schema = z
  .object({
    frames: z.array(hdrAlignmentFrameV1Schema).min(2),
    referenceSourceIndex: z.number().int().nonnegative(),
    searchRadiusPx: z.number().int().nonnegative(),
  })
  .strict();

export const hdrTranslationPointV1Schema = z
  .object({
    x: z.number().int(),
    y: z.number().int(),
  })
  .strict();

export type HdrAlignmentFrameV1 = z.infer<typeof hdrAlignmentFrameV1Schema>;
export type HdrAlignmentRequestV1 = z.infer<typeof hdrAlignmentRequestV1Schema>;

export interface HdrAlignmentTransformV1 {
  confidence: number;
  overlapRatio: number;
  rmsError: number;
  sourceIndex: number;
  transformType: 'identity' | 'translation';
  translationPx: z.infer<typeof hdrTranslationPointV1Schema>;
}

export interface HdrAlignmentResultV1 {
  alignmentConfidence: number;
  referenceSourceIndex: number;
  searchRadiusPx: number;
  transforms: HdrAlignmentTransformV1[];
}

export const estimateHdrAlignmentTransformsV1 = (requestValue: unknown): HdrAlignmentResultV1 => {
  const { referenceFrame, request } = parseHdrAlignmentRequest(requestValue);
  const transforms = request.frames.map((frame) => {
    const estimate = estimateTranslation(
      referenceFrame.pixels,
      frame.pixels,
      frame.width,
      frame.height,
      request.searchRadiusPx,
    );
    const transformType: HdrAlignmentTransformV1['transformType'] =
      estimate.translation.x === 0 && estimate.translation.y === 0 ? 'identity' : 'translation';
    return {
      confidence: roundHdrAlignmentMetric(Math.max(0, Math.min(1, 1 - estimate.rmsError))),
      overlapRatio: roundHdrAlignmentMetric(estimate.overlapRatio),
      rmsError: roundHdrAlignmentMetric(estimate.rmsError),
      sourceIndex: frame.sourceIndex,
      transformType,
      translationPx: estimate.translation,
    };
  });

  return {
    alignmentConfidence: Math.min(...transforms.map((transform) => transform.confidence)),
    referenceSourceIndex: referenceFrame.sourceIndex,
    searchRadiusPx: request.searchRadiusPx,
    transforms,
  };
};

const parseHdrAlignmentRequest = (
  requestValue: unknown,
): {
  referenceFrame: HdrAlignmentFrameV1;
  request: HdrAlignmentRequestV1;
} => {
  const request = hdrAlignmentRequestV1Schema.parse(requestValue);
  const firstFrame = request.frames[0];
  if (firstFrame === undefined) {
    throw new Error('HDR alignment requires at least one frame.');
  }

  for (const frame of request.frames) {
    if (frame.width !== firstFrame.width || frame.height !== firstFrame.height) {
      throw new Error('HDR alignment requires equal-size frames.');
    }
    if (frame.pixels.length !== frame.width * frame.height) {
      throw new Error('HDR alignment frame pixel length does not match dimensions.');
    }
  }

  const referenceFrame = request.frames.find((frame) => frame.sourceIndex === request.referenceSourceIndex);
  if (referenceFrame === undefined) {
    throw new Error('HDR alignment reference source index was not found.');
  }

  return { referenceFrame, request };
};

const estimateTranslation = (
  reference: Float64Array,
  candidate: Float64Array,
  width: number,
  height: number,
  searchRadius: number,
): {
  overlapRatio: number;
  rmsError: number;
  translation: z.infer<typeof hdrTranslationPointV1Schema>;
} => {
  let bestEstimate:
    | {
        overlapRatio: number;
        rmsError: number;
        translation: z.infer<typeof hdrTranslationPointV1Schema>;
      }
    | undefined;

  for (let y = -searchRadius; y <= searchRadius; y += 1) {
    for (let x = -searchRadius; x <= searchRadius; x += 1) {
      const estimate = scoreTranslation(reference, candidate, width, height, x, y);
      if (bestEstimate === undefined || estimate.rmsError < bestEstimate.rmsError) {
        bestEstimate = estimate;
      }
    }
  }

  if (bestEstimate === undefined) {
    throw new Error('HDR alignment could not evaluate any translation candidates.');
  }

  return bestEstimate;
};

const scoreTranslation = (
  reference: Float64Array,
  candidate: Float64Array,
  width: number,
  height: number,
  translationX: number,
  translationY: number,
): {
  overlapRatio: number;
  rmsError: number;
  translation: z.infer<typeof hdrTranslationPointV1Schema>;
} => {
  let squaredError = 0;
  let overlapCount = 0;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const candidateX = x - translationX;
      const candidateY = y - translationY;
      if (!isInsideImage(candidateX, candidateY, width, height)) continue;

      const referenceValue = reference[getPixelIndex(x, y, width)] ?? 0;
      const candidateValue = candidate[getPixelIndex(candidateX, candidateY, width)] ?? 0;
      const delta = referenceValue - candidateValue;
      squaredError += delta * delta;
      overlapCount += 1;
    }
  }

  const translation = hdrTranslationPointV1Schema.parse({ x: translationX, y: translationY });
  if (overlapCount === 0) {
    return {
      overlapRatio: 0,
      rmsError: Number.POSITIVE_INFINITY,
      translation,
    };
  }

  return {
    overlapRatio: overlapCount / (width * height),
    rmsError: Math.sqrt(squaredError / overlapCount),
    translation,
  };
};

const isInsideImage = (x: number, y: number, width: number, height: number): boolean =>
  Number.isInteger(x) && Number.isInteger(y) && x >= 0 && x < width && y >= 0 && y < height;

const getPixelIndex = (x: number, y: number, width: number): number => y * width + x;

const roundHdrAlignmentMetric = (value: number): number => Math.round(value * 1_000_000) / 1_000_000;
