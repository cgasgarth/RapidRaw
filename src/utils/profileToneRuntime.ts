import { type CameraProfileId, parseProfileToneSettings } from '../schemas/color/profileToneSchemas';
import { TONE_CURVE_PARAMETRIC_PRESETS } from './profileTonePresets';

export interface RgbPixel {
  blue: number;
  green: number;
  red: number;
}

export interface ProfileToneRuntimeResult {
  luminanceAfter: number;
  luminanceBefore: number;
  outputRgb: RgbPixel;
  toneDelta: number;
}

const CAMERA_PROFILE_MULTIPLIERS: Record<CameraProfileId, RgbPixel> = {
  camera_landscape: { blue: 1.04, green: 1.02, red: 1.01 },
  camera_neutral: { blue: 0.99, green: 1, red: 0.99 },
  camera_portrait: { blue: 0.98, green: 1, red: 1.03 },
  camera_standard: { blue: 1, green: 1, red: 1 },
  linear_raw: { blue: 1, green: 1, red: 1 },
};

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));
const rec709Luminance = ({ blue, green, red }: RgbPixel) => 0.2126 * red + 0.7152 * green + 0.0722 * blue;

const rangeWeight = (luminance: number, center: number, width: number) =>
  clamp01(1 - Math.abs(luminance - center) / width);

const applyToneCurve = (luminance: number, toneCurve: keyof typeof TONE_CURVE_PARAMETRIC_PRESETS) => {
  const preset = TONE_CURVE_PARAMETRIC_PRESETS[toneCurve];
  const blackWhiteDelta = (preset.blackLevel * (1 - luminance) + preset.whiteLevel * luminance) / 100;
  const tonalDelta =
    (preset.shadows * rangeWeight(luminance, 0.18, 0.22) +
      preset.darks * rangeWeight(luminance, 0.35, 0.22) +
      preset.lights * rangeWeight(luminance, 0.65, 0.22) +
      preset.highlights * rangeWeight(luminance, 0.85, 0.2)) /
    100;
  const toneDelta = blackWhiteDelta + tonalDelta;

  return {
    luminance: clamp01(luminance + toneDelta),
    toneDelta,
  };
};

const scaleToLuminance = (pixel: RgbPixel, targetLuminance: number) => {
  const luminance = rec709Luminance(pixel);
  if (luminance === 0) return pixel;

  const scale = targetLuminance / luminance;
  return {
    blue: clamp01(pixel.blue * scale),
    green: clamp01(pixel.green * scale),
    red: clamp01(pixel.red * scale),
  };
};

export function applyProfileToneToRgbPixel(pixel: RgbPixel, value: unknown): ProfileToneRuntimeResult {
  const settings = parseProfileToneSettings(value);
  const profile = CAMERA_PROFILE_MULTIPLIERS[settings.cameraProfile];
  const profiled = {
    blue: clamp01(pixel.blue * profile.blue),
    green: clamp01(pixel.green * profile.green),
    red: clamp01(pixel.red * profile.red),
  };
  const luminanceBefore = rec709Luminance(profiled);
  const tone = applyToneCurve(luminanceBefore, settings.toneCurve);

  return {
    luminanceAfter: tone.luminance,
    luminanceBefore,
    outputRgb: scaleToLuminance(profiled, tone.luminance),
    toneDelta: tone.toneDelta,
  };
}
