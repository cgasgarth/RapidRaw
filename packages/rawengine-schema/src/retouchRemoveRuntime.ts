export interface RemoveRgbPixel {
  b: number;
  g: number;
  r: number;
}

export interface RemovePoint {
  x: number;
  y: number;
}

export interface RetouchRemoveSourceV1 {
  featherRadiusPx?: number;
  generator: 'local_patch_fill_v1';
  generatorVersion: 1;
  radiusPx?: number;
  resolvedSourcePoint?: RemovePoint;
  searchRadiusMultiplier: number;
  seed: number;
  status?: 'fallback_unchanged' | 'needs_regeneration' | 'ready' | 'stale';
  targetMaskId: string;
}

export interface RemoveSamplingPlan {
  sourcePoint: RemovePoint;
  targetPoint: RemovePoint;
}

const clamp01 = (value: number): number => {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
};

const normalizedPointToPixel = (point: RemovePoint, width: number, height: number): RemovePoint => ({
  x: Math.round(clamp01(point.x) * (width - 1)),
  y: Math.round(clamp01(point.y) * (height - 1)),
});

const pixelToNormalizedPoint = (point: RemovePoint, width: number, height: number): RemovePoint => ({
  x: width <= 1 ? 0 : clamp01(point.x / (width - 1)),
  y: height <= 1 ? 0 : clamp01(point.y / (height - 1)),
});

const pixelDistance = (a: RemoveRgbPixel, b: RemoveRgbPixel): number =>
  Math.abs(a.r - b.r) + Math.abs(a.g - b.g) + Math.abs(a.b - b.b);

const seededRank = (seed: number, rank: number): number => {
  const value = Math.imul(seed ^ Math.imul(rank + 1, 0x9e3779b1), 0x85ebca6b);
  return (value >>> 0) / 0xffffffff;
};

const targetPixelIndexes = (maskAlpha: ReadonlyArray<number>): Array<number> =>
  maskAlpha.flatMap((alpha, index) => (alpha > 0.01 ? [index] : []));

const targetCenter = (indexes: ReadonlyArray<number>, maskAlpha: ReadonlyArray<number>, width: number): RemovePoint => {
  let weight = 0;
  let sumX = 0;
  let sumY = 0;
  for (const index of indexes) {
    const alpha = maskAlpha[index] ?? 0;
    weight += alpha;
    sumX += (index % width) * alpha;
    sumY += Math.floor(index / width) * alpha;
  }
  return weight === 0 ? { x: 0, y: 0 } : { x: sumX / weight, y: sumY / weight };
};

const targetRadius = (indexes: ReadonlyArray<number>, center: RemovePoint, width: number): number =>
  Math.max(1, ...indexes.map((index) => Math.hypot((index % width) - center.x, Math.floor(index / width) - center.y)));

const offsetCandidates = (radius: number, searchRadiusMultiplier: number): Array<RemovePoint> => {
  const maxDistance = Math.max(radius + 1, radius * Math.max(1, searchRadiusMultiplier) * 2);
  const steps = [1, 1.5, 2, 2.5, 3].map((step) => Math.min(maxDistance, Math.ceil(radius * step)));
  const directions = [
    { x: 1, y: 0 },
    { x: -1, y: 0 },
    { x: 0, y: 1 },
    { x: 0, y: -1 },
    { x: 1, y: 1 },
    { x: -1, y: 1 },
    { x: 1, y: -1 },
    { x: -1, y: -1 },
  ];
  const candidates: Array<RemovePoint> = [];
  for (const distance of steps) {
    for (const direction of directions) {
      const diagonalScale = direction.x !== 0 && direction.y !== 0 ? Math.SQRT1_2 : 1;
      candidates.push({
        x: Math.round(direction.x * distance * diagonalScale),
        y: Math.round(direction.y * distance * diagonalScale),
      });
    }
  }
  return candidates;
};

const scoreOffset = (
  pixels: ReadonlyArray<RemoveRgbPixel>,
  maskAlpha: ReadonlyArray<number>,
  indexes: ReadonlyArray<number>,
  width: number,
  height: number,
  offset: RemovePoint,
): number | null => {
  let score = 0;
  let samples = 0;
  for (const index of indexes) {
    const targetX = index % width;
    const targetY = Math.floor(index / width);
    const sourceX = targetX + offset.x;
    const sourceY = targetY + offset.y;
    if (sourceX < 0 || sourceX >= width || sourceY < 0 || sourceY >= height) return null;
    const sourceIndex = sourceY * width + sourceX;
    if ((maskAlpha[sourceIndex] ?? 0) > 0.01) return null;
    const target = pixels[index];
    const source = pixels[sourceIndex];
    if (target === undefined || source === undefined) return null;
    score += pixelDistance(target, source);
    samples += 1;
  }
  return samples === 0 ? null : score / samples;
};

export const resolveRemoveSamplingPlan = (input: {
  height: number;
  maskAlpha: ReadonlyArray<number> | undefined;
  pixels: ReadonlyArray<RemoveRgbPixel>;
  removeSource: RetouchRemoveSourceV1;
  width: number;
}): RemoveSamplingPlan | null => {
  const maskAlpha = input.maskAlpha;
  if (maskAlpha === undefined) return null;
  const indexes = targetPixelIndexes(maskAlpha);
  if (indexes.length === 0) return null;

  const target = targetCenter(indexes, maskAlpha, input.width);
  if (input.removeSource.resolvedSourcePoint !== undefined) {
    return {
      sourcePoint: normalizedPointToPixel(input.removeSource.resolvedSourcePoint, input.width, input.height),
      targetPoint: target,
    };
  }

  const radius = input.removeSource.radiusPx ?? targetRadius(indexes, target, input.width);
  const scoredCandidates = offsetCandidates(radius, input.removeSource.searchRadiusMultiplier)
    .map((offset, index) => ({
      index,
      offset,
      score: scoreOffset(input.pixels, maskAlpha, indexes, input.width, input.height, offset),
    }))
    .filter(
      (candidate): candidate is { index: number; offset: RemovePoint; score: number } => candidate.score !== null,
    )
    .toSorted(
      (a, b) =>
        a.score - b.score || seededRank(input.removeSource.seed, a.index) - seededRank(input.removeSource.seed, b.index),
    );

  const selected =
    scoredCandidates[Math.min(scoredCandidates.length - 1, input.removeSource.seed % Math.min(4, scoredCandidates.length))];
  if (selected === undefined) return null;
  return {
    sourcePoint: {
      x: target.x + selected.offset.x,
      y: target.y + selected.offset.y,
    },
    targetPoint: target,
  };
};

export const removeSourcePointToNormalized = (plan: RemoveSamplingPlan, width: number, height: number): RemovePoint =>
  pixelToNormalizedPoint(plan.sourcePoint, width, height);
