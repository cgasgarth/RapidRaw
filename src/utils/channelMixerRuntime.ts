import { type ChannelMixerSettings, parseChannelMixerSettings } from '../schemas/channelMixerSchemas';

export interface RgbPixel {
  blue: number;
  green: number;
  red: number;
}

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));
const luma = (pixel: RgbPixel) => pixel.red * 0.2126 + pixel.green * 0.7152 + pixel.blue * 0.0722;

export const applyChannelMixerToRgbPixel = (pixel: RgbPixel, value: unknown): RgbPixel => {
  const settings = parseChannelMixerSettings(value);
  if (!settings.enabled) return pixel;

  const mixed = {
    blue: applyChannelMixerRow(pixel, settings, 'blue'),
    green: applyChannelMixerRow(pixel, settings, 'green'),
    red: applyChannelMixerRow(pixel, settings, 'red'),
  };

  if (!settings.preserveLuminance) return mixed;

  const sourceLuma = luma(pixel);
  const mixedLuma = luma(mixed);
  if (sourceLuma <= 0 || mixedLuma <= 0) return mixed;

  const scale = sourceLuma / mixedLuma;
  return {
    blue: clamp01(mixed.blue * scale),
    green: clamp01(mixed.green * scale),
    red: clamp01(mixed.red * scale),
  };
};

const applyChannelMixerRow = (pixel: RgbPixel, settings: ChannelMixerSettings, output: keyof RgbPixel) => {
  const row = settings[output];
  return clamp01(
    pixel.red * (row.red / 100) + pixel.green * (row.green / 100) + pixel.blue * (row.blue / 100) + row.constant / 100,
  );
};
