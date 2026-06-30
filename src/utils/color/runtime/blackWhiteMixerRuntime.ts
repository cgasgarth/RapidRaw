import { parseBlackWhiteMixerSettings } from '../../../schemas/color/blackWhiteMixerSchemas';
import { SELECTIVE_COLOR_RANGES } from '../../../utils/selectiveColorRanges';

export interface RgbPixel {
  blue: number;
  green: number;
  red: number;
}

export interface BlackWhiteMixerRuntimeResult {
  influence: Partial<Record<(typeof SELECTIVE_COLOR_RANGES)[number]['key'], number>>;
  luminance: number;
  outputRgb: RgbPixel;
  weightedAdjustment: number;
}

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

const circularHueDistance = (left: number, right: number) => {
  const delta = Math.abs(left - right) % 360;
  return Math.min(delta, 360 - delta);
};

const rgbToHueDegrees = ({ blue, green, red }: RgbPixel) => {
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  const chroma = max - min;

  if (chroma === 0) return undefined;

  if (max === red) return ((green - blue) / chroma) * 60 + (green < blue ? 360 : 0);
  if (max === green) return ((blue - red) / chroma) * 60 + 120;
  return ((red - green) / chroma) * 60 + 240;
};

const rec709Luminance = ({ blue, green, red }: RgbPixel) => 0.2126 * red + 0.7152 * green + 0.0722 * blue;

export function applyBlackWhiteMixerToRgbPixel(pixel: RgbPixel, value: unknown): BlackWhiteMixerRuntimeResult {
  const settings = parseBlackWhiteMixerSettings(value);
  const luminance = rec709Luminance(pixel);

  if (!settings.enabled) {
    return {
      influence: {},
      luminance,
      outputRgb: { ...pixel },
      weightedAdjustment: 0,
    };
  }

  const hue = rgbToHueDegrees(pixel);
  if (hue === undefined) {
    return {
      influence: {},
      luminance,
      outputRgb: { blue: luminance, green: luminance, red: luminance },
      weightedAdjustment: 0,
    };
  }

  const influenceEntries = SELECTIVE_COLOR_RANGES.map((range) => {
    const distance = circularHueDistance(hue, range.centerHueDegrees);
    const influence = clamp01(1 - distance / (range.widthDegrees / 2));
    return { influence, key: range.key };
  }).filter((entry) => entry.influence > 0);

  const influenceTotal = influenceEntries.reduce((total, entry) => total + entry.influence, 0);
  const weightedAdjustment =
    influenceTotal === 0
      ? 0
      : influenceEntries.reduce((total, entry) => total + entry.influence * settings.weights[entry.key], 0) /
        influenceTotal /
        100;
  const mixed = clamp01(luminance * (1 + weightedAdjustment * 0.5));
  const influence = Object.fromEntries(influenceEntries.map((entry) => [entry.key, entry.influence]));

  return {
    influence,
    luminance,
    outputRgb: { blue: mixed, green: mixed, red: mixed },
    weightedAdjustment,
  };
}
