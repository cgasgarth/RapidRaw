import { calculateDefaultSelectiveColorInfluence, calculateSelectiveColorInfluence } from '../../selectiveColorFalloff';
import {
  getSelectiveColorRange,
  normalizeSelectiveColorRangeControl,
  type SelectiveColorRangeControl,
  type SelectiveColorRangeKey,
} from '../../selectiveColorRanges';

export interface RgbPixel {
  blue: number;
  green: number;
  red: number;
}

export interface SelectiveColorAdjustment {
  hue: number;
  luminance: number;
  saturation: number;
}

export type SelectiveColorRangeControls = Partial<Record<SelectiveColorRangeKey, Partial<SelectiveColorRangeControl>>>;

export interface SelectiveColorRuntimeResult {
  hueDegrees: number;
  influence: number;
  maskWeight: number;
  neutralWeight: number;
  outputRgb: RgbPixel;
}

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));
const wrapHue = (value: number) => ((value % 360) + 360) % 360;
const MIN_SELECTIVE_COLOR_SATURATION = 0.04;
const FULL_SELECTIVE_COLOR_SATURATION = 0.12;

const rgbToHsl = ({ blue, green, red }: RgbPixel) => {
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  const luminance = (max + min) / 2;
  const chroma = max - min;

  if (chroma === 0) return { hue: 0, luminance, saturation: 0 };

  const saturation = chroma / (1 - Math.abs(2 * luminance - 1));
  const hue =
    max === red
      ? ((green - blue) / chroma) * 60 + (green < blue ? 360 : 0)
      : max === green
        ? ((blue - red) / chroma) * 60 + 120
        : ((red - green) / chroma) * 60 + 240;

  return { hue, luminance, saturation };
};

const hueToRgb = (p: number, q: number, t: number) => {
  const wrapped = t < 0 ? t + 1 : t > 1 ? t - 1 : t;
  if (wrapped < 1 / 6) return p + (q - p) * 6 * wrapped;
  if (wrapped < 1 / 2) return q;
  if (wrapped < 2 / 3) return p + (q - p) * (2 / 3 - wrapped) * 6;
  return p;
};

const hslToRgb = ({ hue, luminance, saturation }: { hue: number; luminance: number; saturation: number }): RgbPixel => {
  if (saturation === 0) return { blue: luminance, green: luminance, red: luminance };

  const q = luminance < 0.5 ? luminance * (1 + saturation) : luminance + saturation - luminance * saturation;
  const p = 2 * luminance - q;
  const h = hue / 360;

  return {
    blue: clamp01(hueToRgb(p, q, h - 1 / 3)),
    green: clamp01(hueToRgb(p, q, h)),
    red: clamp01(hueToRgb(p, q, h + 1 / 3)),
  };
};

export function applySelectiveColorToRgbPixel(
  pixel: RgbPixel,
  rangeKey: SelectiveColorRangeKey,
  adjustment: SelectiveColorAdjustment,
  rangeControls?: SelectiveColorRangeControls,
): SelectiveColorRuntimeResult {
  const hsl = rgbToHsl(pixel);
  const maskWeight = calculateSelectiveColorMaskWeight(pixel, rangeKey, rangeControls);
  const influence = maskWeight;
  const outputRgb = hslToRgb({
    hue: wrapHue(hsl.hue + adjustment.hue * influence),
    luminance: clamp01(hsl.luminance + (adjustment.luminance / 100) * influence),
    saturation: clamp01(hsl.saturation * (1 + (adjustment.saturation / 100) * influence)),
  });

  return {
    hueDegrees: hsl.hue,
    influence,
    maskWeight,
    neutralWeight: calculateNeutralSelectiveColorWeight(hsl.saturation),
    outputRgb,
  };
}

export function calculateSelectiveColorMaskWeight(
  pixel: RgbPixel,
  rangeKey: SelectiveColorRangeKey,
  rangeControls?: SelectiveColorRangeControls,
): number {
  const hsl = rgbToHsl(pixel);
  const range = getSelectiveColorRange(rangeKey);
  const control = normalizeSelectiveColorRangeControl(rangeKey, rangeControls?.[rangeKey]);
  const hueInfluence =
    rangeControls?.[rangeKey] === undefined
      ? calculateDefaultSelectiveColorInfluence({
          centerHueDegrees: range.centerHueDegrees,
          hueDegrees: hsl.hue,
          widthDegrees: range.widthDegrees,
        })
      : calculateSelectiveColorInfluence({
          centerHueDegrees: control.centerHueDegrees,
          hueDegrees: hsl.hue,
          smoothness: control.falloffSmoothness,
          widthDegrees: control.widthDegrees,
        });

  return hueInfluence * calculateNeutralSelectiveColorWeight(hsl.saturation);
}

export function renderSelectiveColorMaskPreviewPixel(
  pixel: RgbPixel,
  rangeKey: SelectiveColorRangeKey,
  rangeControls?: SelectiveColorRangeControls,
): RgbPixel {
  const maskWeight = calculateSelectiveColorMaskWeight(pixel, rangeKey, rangeControls);
  return { blue: maskWeight, green: maskWeight, red: maskWeight };
}

function calculateNeutralSelectiveColorWeight(saturation: number): number {
  if (saturation <= MIN_SELECTIVE_COLOR_SATURATION) return 0;
  if (saturation >= FULL_SELECTIVE_COLOR_SATURATION) return 1;

  const normalized =
    (saturation - MIN_SELECTIVE_COLOR_SATURATION) / (FULL_SELECTIVE_COLOR_SATURATION - MIN_SELECTIVE_COLOR_SATURATION);
  return normalized * normalized * (3 - 2 * normalized);
}
