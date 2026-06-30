import {
  type LinearGradientMaskParameters,
  linearGradientMaskParametersSchema,
  type RadialGradientMaskParameters,
  radialGradientMaskParametersSchema,
} from '../schemas/masks/maskParameterSchemas';

function clamp(value: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, value));
}

export function normalizeLinearGradientParameters(
  parameters: LinearGradientMaskParameters,
): LinearGradientMaskParameters {
  return linearGradientMaskParametersSchema.parse({
    endX: parameters.endX,
    endY: parameters.endY,
    range: clamp(parameters.range, 0, 4096, 50),
    startX: parameters.startX,
    startY: parameters.startY,
  });
}

export function normalizeRadialGradientParameters(
  parameters: RadialGradientMaskParameters,
): RadialGradientMaskParameters {
  return radialGradientMaskParametersSchema.parse({
    centerX: parameters.centerX,
    centerY: parameters.centerY,
    feather: clamp(parameters.feather, 0, 1, 0.5),
    radiusX: clamp(parameters.radiusX, 1, 100_000, 1),
    radiusY: clamp(parameters.radiusY, 1, 100_000, 1),
    rotation: clamp(parameters.rotation, -180, 180, 0),
  });
}

export function parseLinearGradientParameters(parameters: unknown): LinearGradientMaskParameters {
  return linearGradientMaskParametersSchema.parse(parameters);
}

export function parseRadialGradientParameters(parameters: unknown): RadialGradientMaskParameters {
  return radialGradientMaskParametersSchema.parse(parameters);
}
