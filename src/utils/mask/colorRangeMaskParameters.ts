import {
  type ColorRangeMaskParameters,
  colorRangeMaskParametersSchema,
} from '../../schemas/masks/maskParameterSchemas';
import { createSelectiveColorMaskSelection, type SelectiveColorMaskOptions } from '../selectiveColorMask';

import type { SelectiveColorRangeKey } from '../selectiveColorRanges';

function clamp01(value: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(0, Math.min(1, value));
}

function hueDistanceDegrees(left: number, right: number): number {
  const delta = Math.abs((((left - right) % 360) + 540) % 360) - 180;
  return Math.min(delta, 360 - delta);
}

export function createColorRangeMaskParameters(
  rangeKey: SelectiveColorRangeKey,
  options: SelectiveColorMaskOptions = {},
): ColorRangeMaskParameters {
  return colorRangeMaskParametersSchema.parse(createSelectiveColorMaskSelection(rangeKey, options));
}

export function parseColorRangeMaskParameters(parameters: unknown): ColorRangeMaskParameters {
  return colorRangeMaskParametersSchema.parse(parameters);
}

export function evaluateColorRangeMaskWeight(
  sample: { hueDegrees: number; luma: number; saturation: number },
  parameters: ColorRangeMaskParameters,
): number {
  const parsed = parseColorRangeMaskParameters(parameters);
  const luma = clamp01(sample.luma, 0);
  const saturation = clamp01(sample.saturation, 0);
  if (
    luma < parsed.minLuma ||
    luma > parsed.maxLuma ||
    saturation < parsed.minSaturation ||
    saturation > parsed.maxSaturation
  ) {
    return 0;
  }

  const hueDistance = hueDistanceDegrees(sample.hueDegrees, parsed.centerHueDegrees);
  const innerRadius = parsed.hueToleranceDegrees * (1 - parsed.feather);
  if (hueDistance <= innerRadius) return 1;
  if (hueDistance >= parsed.hueToleranceDegrees) return 0;

  const featherWidth = Math.max(parsed.hueToleranceDegrees - innerRadius, 0.0001);
  return Math.max(0, Math.min(1, 1 - (hueDistance - innerRadius) / featherWidth));
}
