import type { NegativeLabBaseFogSampleRect } from '../schemas/negativeLabPresetCatalogSchemas';

export interface NegativeLabPatchPickerPoint {
  x: number;
  y: number;
}

export interface NegativeLabPatchPickerBounds {
  height: number;
  left: number;
  top: number;
  width: number;
}

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

const normalizePoint = (
  point: NegativeLabPatchPickerPoint,
  bounds: NegativeLabPatchPickerBounds,
): NegativeLabPatchPickerPoint => ({
  x: clamp((point.x - bounds.left) / bounds.width, 0, 1),
  y: clamp((point.y - bounds.top) / bounds.height, 0, 1),
});

export const buildNegativeLabPickedPatchRect = (
  startPoint: NegativeLabPatchPickerPoint,
  endPoint: NegativeLabPatchPickerPoint,
  bounds: NegativeLabPatchPickerBounds,
  minSize = 0.02,
): NegativeLabBaseFogSampleRect | null => {
  if (
    !Number.isFinite(startPoint.x) ||
    !Number.isFinite(startPoint.y) ||
    !Number.isFinite(endPoint.x) ||
    !Number.isFinite(endPoint.y) ||
    !Number.isFinite(bounds.left) ||
    !Number.isFinite(bounds.top) ||
    !Number.isFinite(bounds.width) ||
    !Number.isFinite(bounds.height) ||
    bounds.width <= 0 ||
    bounds.height <= 0
  ) {
    return null;
  }

  const start = normalizePoint(startPoint, bounds);
  const end = normalizePoint(endPoint, bounds);
  const left = Math.min(start.x, end.x);
  const top = Math.min(start.y, end.y);
  const right = Math.max(start.x, end.x);
  const bottom = Math.max(start.y, end.y);
  const width = clamp(Math.max(right - left, minSize), minSize, 1);
  const height = clamp(Math.max(bottom - top, minSize), minSize, 1);

  return {
    height,
    width,
    x: clamp(left, 0, 1 - width),
    y: clamp(top, 0, 1 - height),
  };
};
