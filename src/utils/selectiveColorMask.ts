import { getSelectiveColorRange, type SelectiveColorRangeKey } from './selectiveColorRanges';

export interface SelectiveColorMaskSelection {
  centerHueDegrees: number;
  feather: number;
  hueToleranceDegrees: number;
  maxLuma: number;
  maxSaturation: number;
  minLuma: number;
  minSaturation: number;
  rangeKind: 'color';
  sourceRangeKey: SelectiveColorRangeKey;
}

export interface SelectiveColorMaskOptions {
  centerHueDegrees?: number;
  feather?: number;
  hueToleranceDegrees?: number;
  maxLuma?: number;
  maxSaturation?: number;
  minLuma?: number;
  minSaturation?: number;
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

export const createSelectiveColorMaskSelection = (
  rangeKey: SelectiveColorRangeKey,
  options: SelectiveColorMaskOptions = {},
): SelectiveColorMaskSelection => {
  const range = getSelectiveColorRange(rangeKey);
  const minSaturation = clamp(options.minSaturation ?? 0.08, 0, 0.99);
  const maxSaturation = clamp(options.maxSaturation ?? 1, minSaturation + 0.01, 1);
  const minLuma = clamp(options.minLuma ?? 0.02, 0, 0.99);
  const maxLuma = clamp(options.maxLuma ?? 0.98, minLuma + 0.01, 1);

  return {
    centerHueDegrees: clamp(options.centerHueDegrees ?? range.centerHueDegrees, 0, 359.999),
    feather: clamp(options.feather ?? 0.35, 0, 1),
    hueToleranceDegrees: clamp(options.hueToleranceDegrees ?? range.widthDegrees * 0.5, 1, 180),
    maxLuma,
    maxSaturation,
    minLuma,
    minSaturation,
    rangeKind: 'color',
    sourceRangeKey: range.key,
  };
};
