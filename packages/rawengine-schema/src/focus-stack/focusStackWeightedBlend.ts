import { z } from 'zod';

export const focusStackRuntimeFrameV1Schema = z
  .object({
    height: z.number().int().positive(),
    pixels: z.instanceof(Float32Array),
    sourceIndex: z.number().int().nonnegative(),
    translationX: z.number().int(),
    translationY: z.number().int(),
    width: z.number().int().positive(),
  })
  .strict();

export const focusStackRuntimeCellScoreV1Schema = z
  .object({
    relativeConfidence: z.number().min(0).max(1),
    sourceIndex: z.number().int().nonnegative(),
  })
  .loose();

export const focusStackRuntimeSharpnessCellV1Schema = z
  .object({
    height: z.number().int().positive(),
    lowConfidence: z.boolean(),
    sourceScores: z.array(focusStackRuntimeCellScoreV1Schema).min(1),
    width: z.number().int().positive(),
    x: z.number().int().nonnegative(),
    y: z.number().int().nonnegative(),
  })
  .loose();

export const focusStackWeightedSharpnessBlendRequestV1Schema = z
  .object({
    cells: z.array(focusStackRuntimeSharpnessCellV1Schema).min(1),
    frames: z.array(focusStackRuntimeFrameV1Schema).min(2),
    lowConfidenceWeightFloor: z.number().min(0).max(1),
    referenceSourceIndex: z.number().int().nonnegative(),
    weightPower: z.number().positive(),
  })
  .strict();

const focusStackWeightedBlendDiagnosticV1Schema = z
  .object({
    code: z.enum([
      'duplicate_frame_source',
      'duplicate_cell_source_score',
      'invalid_contributor_set',
      'missing_source_frame',
      'nonfinite_source_pixel',
      'out_of_bounds_contributor',
      'reference_fallback',
    ]),
    count: z.number().int().positive(),
    sourceIndex: z.number().int().nonnegative().optional(),
    x: z.number().int().nonnegative().optional(),
    y: z.number().int().nonnegative().optional(),
  })
  .strict();

const focusStackWeightedBlendReferenceSourceV1Schema = z
  .object({
    fallbackPolicy: z.literal('low_confidence_or_invalid_contributors'),
    sourceIndex: z.number().int().nonnegative(),
  })
  .strict();

export type FocusStackRuntimeFrameV1 = z.infer<typeof focusStackRuntimeFrameV1Schema>;
export type FocusStackWeightedSharpnessBlendRequestV1 = z.infer<typeof focusStackWeightedSharpnessBlendRequestV1Schema>;
export type FocusStackWeightedBlendDiagnosticV1 = z.infer<typeof focusStackWeightedBlendDiagnosticV1Schema>;
export type FocusStackWeightedBlendReferenceSourceV1 = z.infer<typeof focusStackWeightedBlendReferenceSourceV1Schema>;

export interface FocusStackWeightedSharpnessBlendResultV1 {
  diagnostics: FocusStackWeightedBlendDiagnosticV1[];
  outputHeight: number;
  outputPixels: Float32Array;
  outputWidth: number;
  referenceSource: FocusStackWeightedBlendReferenceSourceV1;
}

const MAX_BLEND_DIAGNOSTICS = 12;

export const applyWeightedSharpnessFocusStackV1 = (requestValue: unknown): FocusStackWeightedSharpnessBlendResultV1 => {
  const request = focusStackWeightedSharpnessBlendRequestV1Schema.parse(requestValue);
  const referenceFrame = request.frames.find((frame) => frame.sourceIndex === request.referenceSourceIndex);
  if (referenceFrame === undefined) {
    throw new Error('Focus stack blend requires a reference source frame.');
  }

  const diagnostics = createBlendDiagnosticsCollector();
  const framesBySourceIndex = buildFramesBySourceIndex(request.frames);
  const outputPixels = new Float32Array(referenceFrame.width * referenceFrame.height);

  for (const frame of request.frames) {
    validateFocusFrameGeometry(frame, referenceFrame);
  }
  validateCellCoverage(request.cells, referenceFrame.width, referenceFrame.height);

  for (let y = 0; y < referenceFrame.height; y += 1) {
    for (let x = 0; x < referenceFrame.width; x += 1) {
      const cell = cellForPixel(request.cells, x, y);
      const outputIndex = y * referenceFrame.width + x;
      const pixel = blendPixel({
        cell,
        diagnostics,
        framesBySourceIndex,
        lowConfidenceWeightFloor: request.lowConfidenceWeightFloor,
        referenceFrame,
        weightPower: request.weightPower,
        x,
        y,
      });
      outputPixels[outputIndex] = pixel;
    }
  }

  return {
    diagnostics: diagnostics.toArray(),
    outputHeight: referenceFrame.height,
    outputPixels,
    outputWidth: referenceFrame.width,
    referenceSource: focusStackWeightedBlendReferenceSourceV1Schema.parse({
      fallbackPolicy: 'low_confidence_or_invalid_contributors',
      sourceIndex: referenceFrame.sourceIndex,
    }),
  };
};

const buildFramesBySourceIndex = (frames: FocusStackRuntimeFrameV1[]): Map<number, FocusStackRuntimeFrameV1> => {
  const framesBySourceIndex = new Map<number, FocusStackRuntimeFrameV1>();
  const duplicateIndexes = new Set<number>();
  for (const frame of frames) {
    if (framesBySourceIndex.has(frame.sourceIndex)) {
      duplicateIndexes.add(frame.sourceIndex);
      continue;
    }
    framesBySourceIndex.set(frame.sourceIndex, frame);
  }
  if (duplicateIndexes.size > 0) {
    throw new Error(
      `Focus stack blend requires unique frame source indexes; duplicates=${[...duplicateIndexes]
        .sort((a, b) => a - b)
        .slice(0, MAX_BLEND_DIAGNOSTICS)
        .join(',')}.`,
    );
  }
  return framesBySourceIndex;
};

const validateFocusFrameGeometry = (
  frame: FocusStackRuntimeFrameV1,
  referenceFrame: FocusStackRuntimeFrameV1,
): void => {
  if (frame.width !== referenceFrame.width || frame.height !== referenceFrame.height) {
    throw new Error('Focus stack blend currently requires same-size translated frames.');
  }
  if (frame.pixels.length !== frame.width * frame.height) {
    throw new Error('Focus stack blend frame dimensions do not match pixel buffer length.');
  }
};

const validateCellCoverage = (
  cells: FocusStackWeightedSharpnessBlendRequestV1['cells'],
  outputWidth: number,
  outputHeight: number,
): void => {
  const coverage = new Uint16Array(outputWidth * outputHeight);
  const outOfBoundsCells: string[] = [];
  for (const cell of cells) {
    if (cell.x + cell.width > outputWidth || cell.y + cell.height > outputHeight) {
      outOfBoundsCells.push(`${cell.x},${cell.y},${cell.width}x${cell.height}`);
      continue;
    }
    for (let y = cell.y; y < cell.y + cell.height; y += 1) {
      for (let x = cell.x; x < cell.x + cell.width; x += 1) {
        const index = y * outputWidth + x;
        coverage[index] = (coverage[index] ?? 0) + 1;
      }
    }
  }

  const gapPixels: string[] = [];
  const overlapPixels: string[] = [];
  for (let y = 0; y < outputHeight; y += 1) {
    for (let x = 0; x < outputWidth; x += 1) {
      const count = coverage[y * outputWidth + x] ?? 0;
      if (count === 0 && gapPixels.length < MAX_BLEND_DIAGNOSTICS) gapPixels.push(`${x},${y}`);
      if (count > 1 && overlapPixels.length < MAX_BLEND_DIAGNOSTICS) overlapPixels.push(`${x},${y}`);
    }
  }

  const failures: string[] = [];
  if (outOfBoundsCells.length > 0) failures.push(`outOfBoundsCells=${outOfBoundsCells.slice(0, 4).join(';')}`);
  if (gapPixels.length > 0) failures.push(`gapPixels=${gapPixels.join(';')}`);
  if (overlapPixels.length > 0) failures.push(`overlapPixels=${overlapPixels.join(';')}`);
  if (failures.length > 0) {
    throw new Error(
      `Focus stack blend sharpness cells must cover each output pixel exactly once: ${failures.join(' ')}`,
    );
  }
};

const sampleAligned = (
  frame: FocusStackRuntimeFrameV1,
  referenceFrame: FocusStackRuntimeFrameV1,
  x: number,
  y: number,
): number | undefined => {
  const dx = referenceFrame.translationX - frame.translationX;
  const dy = referenceFrame.translationY - frame.translationY;
  const sourceX = x - dx;
  const sourceY = y - dy;
  if (sourceX < 0 || sourceX >= frame.width || sourceY < 0 || sourceY >= frame.height) {
    return undefined;
  }
  return frame.pixels[sourceY * frame.width + sourceX];
};

const blendPixel = ({
  cell,
  diagnostics,
  framesBySourceIndex,
  lowConfidenceWeightFloor,
  referenceFrame,
  weightPower,
  x,
  y,
}: {
  cell: FocusStackWeightedSharpnessBlendRequestV1['cells'][number];
  diagnostics: BlendDiagnosticsCollector;
  framesBySourceIndex: Map<number, FocusStackRuntimeFrameV1>;
  lowConfidenceWeightFloor: number;
  referenceFrame: FocusStackRuntimeFrameV1;
  weightPower: number;
  x: number;
  y: number;
}): number => {
  const scoreDuplicateSourceIndex = findDuplicateSourceIndex(cell.sourceScores);
  if (cell.lowConfidence || scoreDuplicateSourceIndex !== undefined) {
    if (scoreDuplicateSourceIndex !== undefined) {
      diagnostics.add({ code: 'duplicate_cell_source_score', sourceIndex: scoreDuplicateSourceIndex, x, y });
    }
    return sampleReferenceFallback(referenceFrame, diagnostics, x, y);
  }

  const rawWeights = weightsForCell(cell, lowConfidenceWeightFloor, weightPower);
  let weightedValue = 0;
  let totalWeight = 0;

  for (const { sourceIndex, weight } of rawWeights) {
    const sourceFrame = framesBySourceIndex.get(sourceIndex);
    if (sourceFrame === undefined) {
      diagnostics.add({ code: 'missing_source_frame', sourceIndex, x, y });
      continue;
    }
    const sample = sampleAligned(sourceFrame, referenceFrame, x, y);
    if (sample === undefined) {
      diagnostics.add({ code: 'out_of_bounds_contributor', sourceIndex, x, y });
      continue;
    }
    if (!Number.isFinite(sample)) {
      diagnostics.add({ code: 'nonfinite_source_pixel', sourceIndex, x, y });
      continue;
    }
    weightedValue += sample * weight;
    totalWeight += weight;
  }

  if (totalWeight <= Number.EPSILON) {
    diagnostics.add({ code: 'invalid_contributor_set', x, y });
    return sampleReferenceFallback(referenceFrame, diagnostics, x, y);
  }

  return weightedValue / totalWeight;
};

const sampleReferenceFallback = (
  referenceFrame: FocusStackRuntimeFrameV1,
  diagnostics: BlendDiagnosticsCollector,
  x: number,
  y: number,
): number => {
  const referencePixel = referenceFrame.pixels[y * referenceFrame.width + x] ?? Number.NaN;
  if (!Number.isFinite(referencePixel)) {
    diagnostics.add({ code: 'nonfinite_source_pixel', sourceIndex: referenceFrame.sourceIndex, x, y });
    throw new Error(
      `Focus stack blend reference source ${referenceFrame.sourceIndex} has nonfinite pixel at ${x},${y}.`,
    );
  }
  diagnostics.add({ code: 'reference_fallback', sourceIndex: referenceFrame.sourceIndex, x, y });
  return referencePixel;
};

const findDuplicateSourceIndex = (
  sourceScores: FocusStackWeightedSharpnessBlendRequestV1['cells'][number]['sourceScores'],
): number | undefined => {
  const seen = new Set<number>();
  for (const score of sourceScores) {
    if (seen.has(score.sourceIndex)) return score.sourceIndex;
    seen.add(score.sourceIndex);
  }
  return undefined;
};

const cellForPixel = (
  cells: FocusStackWeightedSharpnessBlendRequestV1['cells'],
  x: number,
  y: number,
): FocusStackWeightedSharpnessBlendRequestV1['cells'][number] => {
  const cell = cells.find(
    (candidate) =>
      x >= candidate.x && x < candidate.x + candidate.width && y >= candidate.y && y < candidate.y + candidate.height,
  );
  if (cell === undefined) {
    throw new Error(`Focus stack blend missing sharpness cell for pixel ${x},${y}.`);
  }
  return cell;
};

const weightsForCell = (
  cell: FocusStackWeightedSharpnessBlendRequestV1['cells'][number],
  lowConfidenceWeightFloor: number,
  weightPower: number,
): Array<{ sourceIndex: number; weight: number }> => {
  const rawWeights = cell.sourceScores.map((score) => ({
    sourceIndex: score.sourceIndex,
    weight: Math.max(score.relativeConfidence, cell.lowConfidence ? lowConfidenceWeightFloor : 0) ** weightPower,
  }));
  const total = rawWeights.reduce((sum, item) => sum + item.weight, 0);
  return rawWeights.map((item) => ({
    sourceIndex: item.sourceIndex,
    weight: item.weight / Math.max(total, Number.EPSILON),
  }));
};

interface BlendDiagnosticInput {
  code: FocusStackWeightedBlendDiagnosticV1['code'];
  sourceIndex?: number;
  x?: number;
  y?: number;
}

interface BlendDiagnosticsCollector {
  add(input: BlendDiagnosticInput): void;
  toArray(): FocusStackWeightedBlendDiagnosticV1[];
}

const createBlendDiagnosticsCollector = (): BlendDiagnosticsCollector => {
  const entries = new Map<string, BlendDiagnosticInput & { count: number }>();
  return {
    add(input: BlendDiagnosticInput) {
      const key = `${input.code}:${input.sourceIndex ?? ''}`;
      const existing = entries.get(key);
      if (existing !== undefined) {
        existing.count += 1;
        return;
      }
      if (entries.size >= MAX_BLEND_DIAGNOSTICS) return;
      entries.set(key, { ...input, count: 1 });
    },
    toArray() {
      return [...entries.values()].map((entry) => focusStackWeightedBlendDiagnosticV1Schema.parse(entry));
    },
  };
};
