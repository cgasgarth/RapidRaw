import { colorGradingPresetSchema } from '../../../schemas/colorGradingPresetSchemas';

export interface RgbPixel {
  blue: number;
  green: number;
  red: number;
}

export interface ColorGradingRuntimeResult {
  hueShiftDegrees: number;
  luminanceDelta: number;
  outputRgb: RgbPixel;
  saturationScale: number;
}

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));
const wrapHue = (value: number) => ((value % 360) + 360) % 360;

const rec709Luminance = ({ blue, green, red }: RgbPixel) => 0.2126 * red + 0.7152 * green + 0.0722 * blue;

const getRangeWeights = (luminance: number, balance: number) => {
  const balanceOffset = balance / 500;
  const shadows = clamp01((0.5 - luminance + balanceOffset) / 0.5);
  const highlights = clamp01((luminance - 0.5 - balanceOffset) / 0.5);
  const midtones = clamp01(1 - Math.abs(luminance - 0.5 - balanceOffset) / 0.5);
  const total = shadows + midtones + highlights || 1;

  return {
    highlights: highlights / total,
    midtones: midtones / total,
    shadows: shadows / total,
  };
};

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

export function applyColorGradingPresetToRgbPixel(pixel: RgbPixel, value: unknown): ColorGradingRuntimeResult {
  const preset = colorGradingPresetSchema.parse(value);
  const luminance = rec709Luminance(pixel);
  const weights = getRangeWeights(luminance, preset.balance);
  const blend = preset.blending / 100;
  const hueShiftDegrees =
    (((preset.shadows.hue - 180) * weights.shadows +
      (preset.midtones.hue - 180) * weights.midtones +
      (preset.highlights.hue - 180) * weights.highlights +
      (preset.global.hue - 180)) /
      4) *
    blend;
  const saturationScale =
    1 +
    (((preset.shadows.saturation * weights.shadows +
      preset.midtones.saturation * weights.midtones +
      preset.highlights.saturation * weights.highlights +
      preset.global.saturation) /
      4) *
      blend) /
      100;
  const luminanceDelta =
    (((preset.shadows.luminance * weights.shadows +
      preset.midtones.luminance * weights.midtones +
      preset.highlights.luminance * weights.highlights +
      preset.global.luminance) /
      4) *
      blend) /
    100;
  const hsl = rgbToHsl(pixel);
  const outputRgb = hslToRgb({
    hue: wrapHue(hsl.hue + hueShiftDegrees),
    luminance: clamp01(hsl.luminance + luminanceDelta),
    saturation: clamp01(hsl.saturation * saturationScale),
  });

  return { hueShiftDegrees, luminanceDelta, outputRgb, saturationScale };
}
