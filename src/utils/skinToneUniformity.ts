const wrapHue = (hueDegrees: number) => ((hueDegrees % 360) + 360) % 360;

const shortestHueDelta = (fromHueDegrees: number, toHueDegrees: number) => {
  const delta = wrapHue(toHueDegrees) - wrapHue(fromHueDegrees);
  return ((delta + 540) % 360) - 180;
};

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

export interface SkinToneUniformityInput {
  hueDegrees: number;
  luminance: number;
  saturation: number;
}

export interface SkinToneUniformitySettings {
  hueUniformity: number;
  luminanceUniformity: number;
  saturationUniformity: number;
  targetHueDegrees: number;
  targetLuminance: number;
  targetSaturation: number;
}

export interface SkinToneUniformityOutput extends SkinToneUniformityInput {
  hueDeltaDegrees: number;
  luminanceDelta: number;
  saturationDelta: number;
}

export interface RgbPixel {
  blue: number;
  green: number;
  red: number;
}

export interface SkinToneUniformityRgbOutput {
  hsl: SkinToneUniformityOutput;
  outputRgb: RgbPixel;
}

const clamp01 = (value: number) => clamp(value, 0, 1);

const rgbToHsl = ({ blue, green, red }: RgbPixel): SkinToneUniformityInput => {
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  const luminance = (max + min) / 2;
  const chroma = max - min;

  if (chroma === 0) return { hueDegrees: 0, luminance, saturation: 0 };

  const saturation = chroma / (1 - Math.abs(2 * luminance - 1));
  const hueDegrees =
    max === red
      ? ((green - blue) / chroma) * 60 + (green < blue ? 360 : 0)
      : max === green
        ? ((blue - red) / chroma) * 60 + 120
        : ((red - green) / chroma) * 60 + 240;

  return { hueDegrees, luminance, saturation };
};

const hueToRgb = (p: number, q: number, t: number) => {
  const wrapped = t < 0 ? t + 1 : t > 1 ? t - 1 : t;
  if (wrapped < 1 / 6) return p + (q - p) * 6 * wrapped;
  if (wrapped < 1 / 2) return q;
  if (wrapped < 2 / 3) return p + (q - p) * (2 / 3 - wrapped) * 6;
  return p;
};

const hslToRgb = ({ hueDegrees, luminance, saturation }: SkinToneUniformityInput): RgbPixel => {
  if (saturation === 0) return { blue: luminance, green: luminance, red: luminance };

  const q = luminance < 0.5 ? luminance * (1 + saturation) : luminance + saturation - luminance * saturation;
  const p = 2 * luminance - q;
  const h = hueDegrees / 360;

  return {
    blue: clamp01(hueToRgb(p, q, h - 1 / 3)),
    green: clamp01(hueToRgb(p, q, h)),
    red: clamp01(hueToRgb(p, q, h + 1 / 3)),
  };
};

export const applySkinToneUniformity = (
  input: SkinToneUniformityInput,
  settings: SkinToneUniformitySettings,
): SkinToneUniformityOutput => {
  const hueAmount = clamp(settings.hueUniformity, 0, 1);
  const saturationAmount = clamp(settings.saturationUniformity, 0, 1);
  const luminanceAmount = clamp(settings.luminanceUniformity, 0, 1);

  const hueDeltaDegrees = shortestHueDelta(input.hueDegrees, settings.targetHueDegrees) * hueAmount;
  const saturationDelta = (settings.targetSaturation - input.saturation) * saturationAmount;
  const luminanceDelta = (settings.targetLuminance - input.luminance) * luminanceAmount;

  return {
    hueDegrees: wrapHue(input.hueDegrees + hueDeltaDegrees),
    hueDeltaDegrees,
    luminance: clamp(input.luminance + luminanceDelta, 0, 1),
    luminanceDelta,
    saturation: clamp(input.saturation + saturationDelta, 0, 1),
    saturationDelta,
  };
};

export const applySkinToneUniformityToRgbPixel = (
  pixel: RgbPixel,
  settings: SkinToneUniformitySettings,
): SkinToneUniformityRgbOutput => {
  const hsl = applySkinToneUniformity(rgbToHsl(pixel), settings);
  return {
    hsl,
    outputRgb: hslToRgb(hsl),
  };
};
