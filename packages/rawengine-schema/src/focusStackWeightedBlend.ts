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

export type FocusStackRuntimeFrameV1 = z.infer<typeof focusStackRuntimeFrameV1Schema>;
export type FocusStackWeightedSharpnessBlendRequestV1 = z.infer<typeof focusStackWeightedSharpnessBlendRequestV1Schema>;

export interface FocusStackWeightedSharpnessBlendResultV1 {
  outputHeight: number;
  outputPixels: Float32Array;
  outputWidth: number;
}

export const applyWeightedSharpnessFocusStackV1 = (requestValue: unknown): FocusStackWeightedSharpnessBlendResultV1 => {
  const request = focusStackWeightedSharpnessBlendRequestV1Schema.parse(requestValue);
  const referenceFrame = request.frames.find((frame) => frame.sourceIndex === request.referenceSourceIndex);
  if (referenceFrame === undefined) {
    throw new Error('Focus stack blend requires a reference source frame.');
  }

  const framesBySourceIndex = new Map(request.frames.map((frame) => [frame.sourceIndex, frame]));
  const outputPixels = new Float32Array(referenceFrame.width * referenceFrame.height);

  for (const frame of request.frames) {
    validateFocusFrameGeometry(frame, referenceFrame);
  }

  for (let y = 0; y < referenceFrame.height; y += 1) {
    for (let x = 0; x < referenceFrame.width; x += 1) {
      const cell = cellForPixel(request.cells, x, y);
      let value = 0;
      for (const { sourceIndex, weight } of weightsForCell(
        cell,
        request.lowConfidenceWeightFloor,
        request.weightPower,
      )) {
        const sourceFrame = framesBySourceIndex.get(sourceIndex);
        if (sourceFrame === undefined) {
          throw new Error(`Focus stack blend cell references missing source ${sourceIndex}.`);
        }
        value += (sampleAligned(sourceFrame, referenceFrame, x, y) ?? 0) * weight;
      }
      outputPixels[y * referenceFrame.width + x] = value;
    }
  }

  return {
    outputHeight: referenceFrame.height,
    outputPixels,
    outputWidth: referenceFrame.width,
  };
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
