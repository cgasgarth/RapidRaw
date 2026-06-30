import {
  type LuminanceRangeMaskParameters,
  luminanceRangeMaskParametersSchema,
} from '../../schemas/masks/maskParameterSchemas';

function clamp01(value: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(0, Math.min(1, value));
}

export function normalizeLuminanceRangeParameters(
  parameters: LuminanceRangeMaskParameters,
): LuminanceRangeMaskParameters {
  let minLuma = clamp01(parameters.minLuma, 0);
  let maxLuma = clamp01(parameters.maxLuma, 1);

  if (minLuma >= maxLuma) {
    const midpoint = clamp01((minLuma + maxLuma) / 2, 0.5);
    minLuma = Math.max(0, midpoint - 0.01);
    maxLuma = Math.min(1, midpoint + 0.01);
  }

  return luminanceRangeMaskParametersSchema.parse({
    maxLuma,
    minLuma,
    softness: clamp01(parameters.softness, 0.1),
  });
}

export function parseLuminanceRangeParameters(parameters: unknown): LuminanceRangeMaskParameters {
  return luminanceRangeMaskParametersSchema.parse(parameters);
}

export function evaluateLuminanceRangeWeight(luma: number, parameters: LuminanceRangeMaskParameters): number {
  const { maxLuma, minLuma, softness } = normalizeLuminanceRangeParameters(parameters);
  const clampedLuma = clamp01(luma, 0);

  if (clampedLuma < minLuma || clampedLuma > maxLuma) {
    return 0;
  }

  const fade = Math.max((maxLuma - minLuma) * softness, 0.0001);
  const lowerWeight = Math.min(1, (clampedLuma - minLuma) / fade);
  const upperWeight = Math.min(1, (maxLuma - clampedLuma) / fade);
  return Math.max(0, Math.min(1, lowerWeight, upperWeight));
}
