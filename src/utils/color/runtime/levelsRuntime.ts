import { parseLevelsSettings } from '../../../schemas/levelsSchemas';

export interface RgbPixel {
  blue: number;
  green: number;
  red: number;
}

const MIN_INPUT_RANGE = 0.0001;
const MIN_SOURCE_LUMA = 0.0001;

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));
const luma = (pixel: RgbPixel) => Math.max(pixel.red * 0.2126 + pixel.green * 0.7152 + pixel.blue * 0.0722, 0);

export const applyLumaLevelsToRgbPixel = (pixel: RgbPixel, value: unknown): RgbPixel => {
  const settings = parseLevelsSettings(value);
  if (!settings.enabled) return pixel;

  const sourceLuma = luma(pixel);
  const inputRange = Math.max(settings.inputWhite - settings.inputBlack, MIN_INPUT_RANGE);
  const normalizedLuma = clamp01((sourceLuma - settings.inputBlack) / inputRange);
  const gammaLuma = normalizedLuma ** (1 / Math.max(settings.gamma, MIN_INPUT_RANGE));
  const outputLuma = settings.outputBlack + (settings.outputWhite - settings.outputBlack) * gammaLuma;

  if (sourceLuma <= MIN_SOURCE_LUMA) {
    return { blue: outputLuma, green: outputLuma, red: outputLuma };
  }

  const scale = outputLuma / sourceLuma;
  return {
    blue: clamp01(pixel.blue * scale),
    green: clamp01(pixel.green * scale),
    red: clamp01(pixel.red * scale),
  };
};
