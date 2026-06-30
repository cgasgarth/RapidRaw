import {
  type MaskRefinementParameters,
  maskRefinementParametersSchema,
} from '../../schemas/masks/maskParameterSchemas';

const clamp = (value: number, min: number, max: number, fallback: number) => {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, value));
};

const clamp01 = (value: number) => clamp(value, 0, 1, 0);

const smoothstep = (value: number) => {
  const t = clamp01(value);
  return t * t * (3 - 2 * t);
};

export function normalizeMaskRefinementParameters(
  parameters: Partial<MaskRefinementParameters> = {},
): MaskRefinementParameters {
  return maskRefinementParametersSchema.parse({
    density: clamp(parameters.density ?? 1, 0, 1, 1),
    edgeContrast: clamp(parameters.edgeContrast ?? 0, 0, 1, 0),
    edgeShiftPx: clamp(parameters.edgeShiftPx ?? 0, -512, 512, 0),
    featherPx: clamp(parameters.featherPx ?? 0, 0, 4096, 0),
    hairDetail: clamp(parameters.hairDetail ?? 0, 0, 1, 0),
    smoothness: clamp(parameters.smoothness ?? 0, 0, 1, 0),
  });
}

export function evaluateMaskRefinementWeight(
  baseWeight: number,
  edgeDistancePx: number,
  parameters: MaskRefinementParameters,
): number {
  const parsed = maskRefinementParametersSchema.parse(parameters);
  const shiftedDistance = edgeDistancePx + parsed.edgeShiftPx;
  const featherWeight =
    parsed.featherPx === 0
      ? shiftedDistance >= 0
        ? 1
        : 0
      : clamp01((shiftedDistance + parsed.featherPx) / (2 * parsed.featherPx));
  const smoothedWeight =
    parsed.smoothness === 0
      ? featherWeight
      : featherWeight * (1 - parsed.smoothness) + smoothstep(featherWeight) * parsed.smoothness;
  const contrastedWeight =
    parsed.edgeContrast === 0 ? smoothedWeight : clamp01((smoothedWeight - 0.5) * (1 + parsed.edgeContrast * 3) + 0.5);

  return clamp01(baseWeight) * parsed.density * contrastedWeight;
}
