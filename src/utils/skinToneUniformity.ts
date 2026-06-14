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
