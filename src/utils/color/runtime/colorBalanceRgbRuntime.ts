import { parseColorBalanceRgbSettings } from '../../../schemas/colorBalanceRgbSchemas';

export interface RgbPixel {
  blue: number;
  green: number;
  red: number;
}

export interface ColorBalanceRgbRuntimeResult {
  appliedOffset: RgbPixel;
  luminance: number;
  outputRgb: RgbPixel;
  rangeWeights: {
    highlights: number;
    midtones: number;
    shadows: number;
  };
}

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

const rec709Luminance = ({ blue, green, red }: RgbPixel) => 0.2126 * red + 0.7152 * green + 0.0722 * blue;

const getRangeWeights = (luminance: number) => {
  const shadows = clamp01((0.55 - luminance) / 0.55);
  const highlights = clamp01((luminance - 0.45) / 0.55);
  const midtones = clamp01(1 - Math.abs(luminance - 0.5) / 0.5);
  const total = shadows + midtones + highlights;

  if (total === 0) {
    return { highlights: 0, midtones: 1, shadows: 0 };
  }

  return {
    highlights: highlights / total,
    midtones: midtones / total,
    shadows: shadows / total,
  };
};

const scaleToPreserveLuminance = (pixel: RgbPixel, targetLuminance: number) => {
  const outputLuminance = rec709Luminance(pixel);
  if (outputLuminance === 0) return pixel;

  const scale = targetLuminance / outputLuminance;
  return {
    blue: clamp01(pixel.blue * scale),
    green: clamp01(pixel.green * scale),
    red: clamp01(pixel.red * scale),
  };
};

export function applyColorBalanceRgbToPixel(pixel: RgbPixel, value: unknown): ColorBalanceRgbRuntimeResult {
  const settings = parseColorBalanceRgbSettings(value);
  const luminance = rec709Luminance(pixel);
  const rangeWeights = getRangeWeights(luminance);

  if (!settings.enabled) {
    return {
      appliedOffset: { blue: 0, green: 0, red: 0 },
      luminance,
      outputRgb: pixel,
      rangeWeights,
    };
  }

  const appliedOffset = {
    blue:
      (settings.shadows.blue * rangeWeights.shadows +
        settings.midtones.blue * rangeWeights.midtones +
        settings.highlights.blue * rangeWeights.highlights) /
      400,
    green:
      (settings.shadows.green * rangeWeights.shadows +
        settings.midtones.green * rangeWeights.midtones +
        settings.highlights.green * rangeWeights.highlights) /
      400,
    red:
      (settings.shadows.red * rangeWeights.shadows +
        settings.midtones.red * rangeWeights.midtones +
        settings.highlights.red * rangeWeights.highlights) /
      400,
  };
  const adjusted = {
    blue: clamp01(pixel.blue + appliedOffset.blue),
    green: clamp01(pixel.green + appliedOffset.green),
    red: clamp01(pixel.red + appliedOffset.red),
  };

  return {
    appliedOffset,
    luminance,
    outputRgb: settings.preserveLuminance ? scaleToPreserveLuminance(adjusted, luminance) : adjusted,
    rangeWeights,
  };
}
