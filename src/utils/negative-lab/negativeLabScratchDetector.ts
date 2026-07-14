import { buildNegativeLabPlanHash } from './negativeLabPlanIdentity';

export interface NegativeLabScratchAnalysisInput {
  cropIdentity: string;
  height: number;
  pixels: readonly number[];
  processIdentity: string;
  sourceIdentity: string;
  width: number;
}

export interface NegativeLabScratchCandidateGeometry {
  coordinateSpace: 'normalized_frame';
  height: number;
  kind: 'polyline';
  points: Array<{ x: number; y: number }>;
  width: number;
  x: number;
  y: number;
}

export interface NegativeLabScratchCandidate {
  candidateId: string;
  confidence: number;
  detectorVersion: 'native_buffer_ridge_v1';
  geometry: NegativeLabScratchCandidateGeometry;
  kind: 'emulsion_scratch';
  polarity: 'dark' | 'light' | 'mixed';
  status: 'pending';
  supportCount: number;
  warningCodes: string[];
}

const DETECTOR_VERSION = 'native_buffer_ridge_v1' as const;
const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));

const pixelAt = (input: NegativeLabScratchAnalysisInput, x: number, y: number): number =>
  input.pixels[y * input.width + x] ?? 0;

const mean = (values: number[]): number => values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length);

const findLongestRun = (
  scores: number[],
  threshold: number,
): { end: number; start: number; support: number } | null => {
  let best: { end: number; start: number; support: number } | null = null;
  let runStart = -1;
  for (let index = 0; index <= scores.length; index += 1) {
    const active = index < scores.length && (scores[index] ?? 0) >= threshold;
    if (active && runStart < 0) runStart = index;
    if ((!active || index === scores.length) && runStart >= 0) {
      const run = { end: index - 1, start: runStart, support: index - runStart };
      if (best === null || run.support > best.support) best = run;
      runStart = -1;
    }
  }
  return best;
};

export const detectNegativeLabLongScratches = (
  input: NegativeLabScratchAnalysisInput,
): NegativeLabScratchCandidate[] => {
  if (
    input.width < 16 ||
    input.height < 16 ||
    input.pixels.length < input.width * input.height ||
    input.pixels.some((value) => !Number.isFinite(value))
  ) {
    return [];
  }

  const marginX = Math.max(3, Math.round(input.width * 0.04));
  const marginY = Math.max(3, Math.round(input.height * 0.04));
  const columnScores = Array.from({ length: input.width }, (_, x) => {
    if (x < marginX || x >= input.width - marginX) return 0;
    let support = 0;
    for (let y = marginY; y < input.height - marginY; y += 1) {
      const center = pixelAt(input, x, y);
      const neighbor = mean([pixelAt(input, x - 2, y), pixelAt(input, x + 2, y)]);
      const texture = Math.abs(pixelAt(input, x, y - 1) - pixelAt(input, x, y + 1));
      if (Math.abs(center - neighbor) > 0.14 && texture < 0.25) support += 1;
    }
    return support / Math.max(1, input.height - marginY * 2);
  });
  const rowScores = Array.from({ length: input.height }, (_, y) => {
    if (y < marginY || y >= input.height - marginY) return 0;
    let support = 0;
    for (let x = marginX; x < input.width - marginX; x += 1) {
      const center = pixelAt(input, x, y);
      const neighbor = mean([pixelAt(input, x, y - 2), pixelAt(input, x, y + 2)]);
      const texture = Math.abs(pixelAt(input, x - 1, y) - pixelAt(input, x + 1, y));
      if (Math.abs(center - neighbor) > 0.14 && texture < 0.25) support += 1;
    }
    return support / Math.max(1, input.width - marginX * 2);
  });
  const smoothScores = (scores: number[]): number[] =>
    scores.map((_, index) => mean(scores.slice(Math.max(0, index - 1), Math.min(scores.length, index + 2))));
  const verticalRun = findLongestRun(smoothScores(columnScores), 0.28);
  const horizontalRun = findLongestRun(smoothScores(rowScores), 0.28);
  const vertical =
    verticalRun !== null &&
    verticalRun.start > marginX &&
    verticalRun.end < input.width - marginX - 1 &&
    verticalRun.support >= 2;
  const horizontal =
    horizontalRun !== null &&
    horizontalRun.start > marginY &&
    horizontalRun.end < input.height - marginY - 1 &&
    horizontalRun.support >= 2;
  if (!vertical && !horizontal) return [];

  const useVertical = vertical && (!horizontal || (verticalRun?.support ?? 0) >= (horizontalRun?.support ?? 0));
  const run = useVertical ? verticalRun! : horizontalRun!;
  const axisLength = useVertical ? input.height : input.width;
  const crossCenter = (run.start + run.end) / 2;
  const points = Array.from({ length: 9 }, (_, index) => {
    const position = marginY + ((axisLength - marginY * 2 - 1) * index) / 8;
    return useVertical
      ? { x: clamp01(crossCenter / (input.width - 1)), y: clamp01(position / (input.height - 1)) }
      : { x: clamp01(position / (input.width - 1)), y: clamp01(crossCenter / (input.height - 1)) };
  });
  const x = useVertical ? run.start / input.width : marginX / input.width;
  const y = useVertical ? marginY / input.height : run.start / input.height;
  const width = useVertical ? Math.max(1, run.support) / input.width : (axisLength - marginX * 2) / input.width;
  const height = useVertical ? (axisLength - marginY * 2) / input.height : Math.max(1, run.support) / input.height;
  const axisSupport = useVertical
    ? Math.round((input.height - marginY * 2) * Math.max(...columnScores.slice(run.start, run.end + 1)))
    : Math.round((input.width - marginX * 2) * Math.max(...rowScores.slice(run.start, run.end + 1)));
  const confidence = clamp01(0.5 + Math.max(columnScores[run.start] ?? 0, rowScores[run.start] ?? 0) * 0.5);
  const candidateId = `negative_lab_scratch_${buildNegativeLabPlanHash(
    JSON.stringify({
      crop: input.cropIdentity,
      detector: DETECTOR_VERSION,
      process: input.processIdentity,
      source: input.sourceIdentity,
    }),
  ).slice(-12)}`;
  return [
    {
      candidateId,
      confidence,
      detectorVersion: DETECTOR_VERSION,
      geometry: {
        coordinateSpace: 'normalized_frame',
        height: clamp01(height),
        kind: 'polyline',
        points,
        width: clamp01(width),
        x: clamp01(x),
        y: clamp01(y),
      },
      kind: 'emulsion_scratch',
      polarity: 'mixed',
      status: 'pending',
      supportCount: axisSupport,
      warningCodes: ['image_grounded_native_buffer', 'review_before_heal'],
    },
  ];
};
