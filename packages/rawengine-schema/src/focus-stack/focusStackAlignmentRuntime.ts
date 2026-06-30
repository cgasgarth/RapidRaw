import { z } from 'zod';

const FOCUS_STACK_ALIGNMENT_ENGINE_ID = 'rawengine_focus_stack_alignment_v1';
const FOCUS_STACK_ALIGNMENT_ENGINE_VERSION = '0.1.0';

export const focusStackAlignmentWarningCodeV1Schema = z.enum([
  'alignment_high_residual',
  'alignment_insufficient_coverage',
  'alignment_low_confidence',
]);
export const focusStackAlignmentFrameStatusV1Schema = z.enum(['accepted', 'blocked']);

export const focusStackAlignmentFrameV1Schema = z
  .object({
    height: z.number().int().positive(),
    pixels: z.instanceof(Float32Array),
    sourceIndex: z.number().int().nonnegative(),
    width: z.number().int().positive(),
  })
  .strict();

export const focusStackAlignmentRequestV1Schema = z
  .object({
    confidenceResidualFloor: z.number().positive().default(0.0001),
    frames: z.array(focusStackAlignmentFrameV1Schema).min(2),
    maxResidual: z.number().nonnegative().default(0.004),
    minConfidence: z.number().min(0).max(1).default(0.85),
    minCoverageRatio: z.number().min(0).max(1).default(0.9),
    referenceSourceIndex: z.number().int().nonnegative().optional(),
    searchRadiusPx: z.number().int().nonnegative().default(6),
  })
  .strict();

export const focusStackTranslationV1Schema = z.object({ dx: z.number().int(), dy: z.number().int() }).strict();

export const focusStackAlignmentFrameDiagnosticV1Schema = z
  .object({
    blockCodes: z.array(focusStackAlignmentWarningCodeV1Schema),
    confidence: z.number().min(0).max(1),
    coverageRatio: z.number().min(0).max(1),
    residual: z.number().nonnegative(),
    role: z.enum(['reference', 'aligned']),
    sourceIndex: z.number().int().nonnegative(),
    status: focusStackAlignmentFrameStatusV1Schema,
    translation: focusStackTranslationV1Schema,
    translationX: z.number().int(),
    translationY: z.number().int(),
    warningCodes: z.array(focusStackAlignmentWarningCodeV1Schema),
  })
  .strict();

export const focusStackAlignmentResultV1Schema = z
  .object({
    blocked: z.boolean(),
    blockCodes: z.array(focusStackAlignmentWarningCodeV1Schema),
    diagnostics: z.array(focusStackAlignmentFrameDiagnosticV1Schema).min(2),
    engineId: z.literal(FOCUS_STACK_ALIGNMENT_ENGINE_ID),
    engineVersion: z.literal(FOCUS_STACK_ALIGNMENT_ENGINE_VERSION),
    referenceSource: z
      .object({
        reason: z.enum(['first_frame', 'requested_source_index']),
        sourceIndex: z.number().int().nonnegative(),
      })
      .strict(),
    searchRadiusPx: z.number().int().nonnegative(),
    warningCodes: z.array(focusStackAlignmentWarningCodeV1Schema),
  })
  .strict();

export type FocusStackAlignmentFrameV1 = z.infer<typeof focusStackAlignmentFrameV1Schema>;
export type FocusStackAlignmentRequestV1 = z.input<typeof focusStackAlignmentRequestV1Schema>;
export type FocusStackAlignmentResultV1 = z.infer<typeof focusStackAlignmentResultV1Schema>;
export type FocusStackAlignmentWarningCodeV1 = z.infer<typeof focusStackAlignmentWarningCodeV1Schema>;

type ParsedFocusStackAlignmentRequestV1 = z.infer<typeof focusStackAlignmentRequestV1Schema>;
type FocusStackTranslationV1 = z.infer<typeof focusStackTranslationV1Schema>;

interface ScoredTranslation {
  coverageRatio: number;
  residual: number;
  translation: FocusStackTranslationV1;
}

export const estimateFocusStackAlignmentV1 = (requestValue: unknown): FocusStackAlignmentResultV1 => {
  const request = parseFocusStackAlignmentRequest(requestValue);
  const referenceFrame = getReferenceFrame(request);
  const diagnostics = request.frames.map((frame) =>
    frame.sourceIndex === referenceFrame.sourceIndex
      ? buildReferenceDiagnostic(frame)
      : estimateFrameAlignment(referenceFrame, frame, request),
  );
  const warningCodes = sortedAlignmentCodes(diagnostics.flatMap((diagnostic) => diagnostic.warningCodes));
  const blockCodes = sortedAlignmentCodes(diagnostics.flatMap((diagnostic) => diagnostic.blockCodes));

  return focusStackAlignmentResultV1Schema.parse({
    blocked: blockCodes.length > 0,
    blockCodes,
    diagnostics,
    engineId: FOCUS_STACK_ALIGNMENT_ENGINE_ID,
    engineVersion: FOCUS_STACK_ALIGNMENT_ENGINE_VERSION,
    referenceSource: {
      reason: request.referenceSourceIndex === undefined ? 'first_frame' : 'requested_source_index',
      sourceIndex: referenceFrame.sourceIndex,
    },
    searchRadiusPx: request.searchRadiusPx,
    warningCodes,
  });
};

const parseFocusStackAlignmentRequest = (requestValue: unknown): ParsedFocusStackAlignmentRequestV1 => {
  const request = focusStackAlignmentRequestV1Schema.parse(requestValue);
  const firstFrame = request.frames[0];
  if (firstFrame === undefined) throw new Error('Focus stack alignment requires at least one frame.');

  const sourceIndexes = new Set<number>();
  for (const frame of request.frames) {
    if (sourceIndexes.has(frame.sourceIndex)) {
      throw new Error(`Focus stack alignment received duplicate source index ${frame.sourceIndex}.`);
    }
    sourceIndexes.add(frame.sourceIndex);
    if (frame.width !== firstFrame.width || frame.height !== firstFrame.height) {
      throw new Error('Focus stack alignment currently requires same-size frames.');
    }
    if (frame.pixels.length !== frame.width * frame.height) {
      throw new Error(`Focus stack alignment frame ${frame.sourceIndex} pixel length does not match dimensions.`);
    }
  }

  return request;
};

const getReferenceFrame = (request: ParsedFocusStackAlignmentRequestV1): FocusStackAlignmentFrameV1 => {
  const referenceFrame =
    request.referenceSourceIndex === undefined
      ? request.frames[0]
      : request.frames.find((frame) => frame.sourceIndex === request.referenceSourceIndex);
  if (referenceFrame === undefined) throw new Error('Focus stack alignment reference source index was not found.');
  return referenceFrame;
};

const buildReferenceDiagnostic = (
  frame: FocusStackAlignmentFrameV1,
): z.infer<typeof focusStackAlignmentFrameDiagnosticV1Schema> =>
  focusStackAlignmentFrameDiagnosticV1Schema.parse({
    blockCodes: [],
    confidence: 1,
    coverageRatio: 1,
    residual: 0,
    role: 'reference',
    sourceIndex: frame.sourceIndex,
    status: 'accepted',
    translation: { dx: 0, dy: 0 },
    translationX: 0,
    translationY: 0,
    warningCodes: [],
  });

const estimateFrameAlignment = (
  referenceFrame: FocusStackAlignmentFrameV1,
  frame: FocusStackAlignmentFrameV1,
  request: ParsedFocusStackAlignmentRequestV1,
): z.infer<typeof focusStackAlignmentFrameDiagnosticV1Schema> => {
  const scoredTranslations = scoreTranslations(referenceFrame, frame, request.searchRadiusPx);
  scoredTranslations.sort((left, right) => left.residual - right.residual);
  const best = scoredTranslations[0];
  const secondBest = scoredTranslations[1];
  if (best === undefined || secondBest === undefined) {
    throw new Error(`Focus stack alignment could not score source ${frame.sourceIndex}.`);
  }

  const confidence = Math.min(
    1,
    Math.max(0, secondBest.residual - best.residual) / Math.max(best.residual, request.confidenceResidualFloor),
  );
  const warningCodes: FocusStackAlignmentWarningCodeV1[] = [];
  if (best.coverageRatio < request.minCoverageRatio) warningCodes.push('alignment_insufficient_coverage');
  if (best.residual > request.maxResidual) warningCodes.push('alignment_high_residual');
  if (confidence < request.minConfidence) warningCodes.push('alignment_low_confidence');

  return focusStackAlignmentFrameDiagnosticV1Schema.parse({
    blockCodes: [...warningCodes],
    confidence: roundFocusAlignmentMetric(confidence),
    coverageRatio: roundFocusAlignmentMetric(best.coverageRatio),
    residual: roundFocusAlignmentMetric(best.residual),
    role: 'aligned',
    sourceIndex: frame.sourceIndex,
    status: warningCodes.length > 0 ? 'blocked' : 'accepted',
    translation: best.translation,
    translationX: best.translation.dx,
    translationY: best.translation.dy,
    warningCodes,
  });
};

const scoreTranslations = (
  referenceFrame: FocusStackAlignmentFrameV1,
  frame: FocusStackAlignmentFrameV1,
  searchRadiusPx: number,
): ScoredTranslation[] => {
  const scoredTranslations: ScoredTranslation[] = [];
  for (let dy = -searchRadiusPx; dy <= searchRadiusPx; dy += 1) {
    for (let dx = -searchRadiusPx; dx <= searchRadiusPx; dx += 1) {
      const translation = focusStackTranslationV1Schema.parse({ dx, dy });
      scoredTranslations.push(scoreTranslation(referenceFrame, frame, translation, searchRadiusPx));
    }
  }
  return scoredTranslations;
};

const scoreTranslation = (
  referenceFrame: FocusStackAlignmentFrameV1,
  frame: FocusStackAlignmentFrameV1,
  translation: FocusStackTranslationV1,
  searchRadiusPx: number,
): ScoredTranslation => {
  let absoluteError = 0;
  let comparedPixels = 0;

  for (let y = searchRadiusPx; y < referenceFrame.height - searchRadiusPx; y += 1) {
    for (let x = searchRadiusPx; x < referenceFrame.width - searchRadiusPx; x += 1) {
      const candidateX = x - translation.dx;
      const candidateY = y - translation.dy;
      if (!isInsideFrame(candidateX, candidateY, frame.width, frame.height)) continue;

      const referenceValue = referenceFrame.pixels[y * referenceFrame.width + x] ?? 0;
      const candidateValue = frame.pixels[candidateY * frame.width + candidateX] ?? 0;
      absoluteError += Math.abs(referenceValue - candidateValue);
      comparedPixels += 1;
    }
  }

  const innerPixelCount = Math.max(
    1,
    (referenceFrame.width - searchRadiusPx * 2) * (referenceFrame.height - searchRadiusPx * 2),
  );
  return {
    coverageRatio: comparedPixels / innerPixelCount,
    residual: absoluteError / Math.max(1, comparedPixels),
    translation,
  };
};

const sortedAlignmentCodes = (codes: FocusStackAlignmentWarningCodeV1[]): FocusStackAlignmentWarningCodeV1[] =>
  [...new Set(codes)].sort();

const isInsideFrame = (x: number, y: number, width: number, height: number): boolean =>
  Number.isInteger(x) && Number.isInteger(y) && x >= 0 && x < width && y >= 0 && y < height;

const roundFocusAlignmentMetric = (value: number): number => Math.round(value * 1_000_000) / 1_000_000;
