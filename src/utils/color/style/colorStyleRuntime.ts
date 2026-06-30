import { z } from 'zod';
import { colorStylePresetSchema } from '../../../schemas/color/colorStylePresetSchemas';
import { calculateDefaultSelectiveColorInfluence } from '../../selectiveColorFalloff';
import {
  getSelectiveColorRange,
  SELECTIVE_COLOR_RANGE_KEYS,
  type SelectiveColorRangeKey,
} from '../../selectiveColorRanges';

export interface RgbPixel {
  blue: number;
  green: number;
  red: number;
}

export interface ColorStyleRuntimeResult {
  appliedRanges: Array<SelectiveColorRangeKey>;
  outputRgb: RgbPixel;
  saturationScale: number;
}

const hslAdjustmentSchema = z
  .object({
    hue: z.number().min(-180).max(180),
    luminance: z.number().min(-100).max(100),
    saturation: z.number().min(-100).max(100),
  })
  .strict();

const hslPatchSchema = z
  .object({
    aquas: hslAdjustmentSchema.optional(),
    blues: hslAdjustmentSchema.optional(),
    greens: hslAdjustmentSchema.optional(),
    magentas: hslAdjustmentSchema.optional(),
    oranges: hslAdjustmentSchema.optional(),
    purples: hslAdjustmentSchema.optional(),
    reds: hslAdjustmentSchema.optional(),
    yellows: hslAdjustmentSchema.optional(),
  })
  .strict();

const runtimePatchSchema = z
  .object({
    hsl: hslPatchSchema.optional(),
    saturation: z.number().min(-100).max(100).optional(),
    vibrance: z.number().min(-100).max(100).optional(),
  })
  .loose();

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));
const wrapHue = (value: number) => ((value % 360) + 360) % 360;

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

export function applyColorStylePresetToRgbPixel(pixel: RgbPixel, value: unknown): ColorStyleRuntimeResult {
  const preset = colorStylePresetSchema.parse(value);
  const patch = runtimePatchSchema.parse(preset.adjustmentPatch);
  const hsl = rgbToHsl(pixel);
  const saturationScale = 1 + ((patch.saturation ?? 0) + (patch.vibrance ?? 0) * 0.6) / 100;
  const appliedRanges: Array<SelectiveColorRangeKey> = [];

  let hue = hsl.hue;
  let luminance = hsl.luminance;
  let saturation = hsl.saturation * saturationScale;

  for (const rangeKey of SELECTIVE_COLOR_RANGE_KEYS) {
    const adjustment = patch.hsl?.[rangeKey];
    if (!adjustment) continue;

    const range = getSelectiveColorRange(rangeKey);
    const influence = calculateDefaultSelectiveColorInfluence({
      centerHueDegrees: range.centerHueDegrees,
      hueDegrees: hsl.hue,
      widthDegrees: range.widthDegrees,
    });
    if (influence <= 0.0001) continue;

    appliedRanges.push(rangeKey);
    hue += adjustment.hue * influence;
    luminance += (adjustment.luminance / 100) * influence;
    saturation *= 1 + (adjustment.saturation / 100) * influence;
  }

  return {
    appliedRanges,
    outputRgb: hslToRgb({ hue: wrapHue(hue), luminance: clamp01(luminance), saturation: clamp01(saturation) }),
    saturationScale,
  };
}
