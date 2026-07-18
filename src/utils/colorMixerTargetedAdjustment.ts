import type { SelectiveColorMixerSettings } from './selectiveColorEditTransaction';
import { SELECTIVE_COLOR_RANGES, type SelectiveColorRangeKey } from './selectiveColorRanges';

export type ColorMixerTargetedMode = 'hue' | 'saturation' | 'luminance';

export interface ColorMixerTargetedBandWeight {
  readonly key: SelectiveColorRangeKey;
  readonly weight: number;
}

export interface ColorMixerTargetedSample {
  readonly graphRevision: string;
  readonly hueDegrees: number;
  readonly sourceIdentity: string;
}

export interface ColorMixerTargetedReceipt extends ColorMixerTargetedSample {
  readonly bands: readonly ColorMixerTargetedBandWeight[];
  readonly mode: ColorMixerTargetedMode;
}

const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));
const wrapHue = (value: number): number => ((value % 360) + 360) % 360;
const circularDistance = (left: number, right: number): number => {
  const delta = Math.abs(wrapHue(left) - wrapHue(right));
  return Math.min(delta, 360 - delta);
};

export const resolveHueFromDisplayRgb = (rgb: readonly [number, number, number]): number => {
  const red = clamp(rgb[0] ?? 0, 0, 1);
  const green = clamp(rgb[1] ?? 0, 0, 1);
  const blue = clamp(rgb[2] ?? 0, 0, 1);
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  const chroma = max - min;
  if (chroma === 0) return 0;
  const sector =
    max === red
      ? ((green - blue) / chroma) % 6
      : max === green
        ? (blue - red) / chroma + 2
        : (red - green) / chroma + 4;
  return wrapHue(sector * 60);
};

export const resolveLightnessFromDisplayRgb = (rgb: readonly [number, number, number]): number => {
  const values = [clamp(rgb[0] ?? 0, 0, 1), clamp(rgb[1] ?? 0, 0, 1), clamp(rgb[2] ?? 0, 0, 1)];
  return (Math.max(...values) + Math.min(...values)) / 2;
};

export const resolveChromaFromDisplayRgb = (rgb: readonly [number, number, number]): number => {
  const values = [clamp(rgb[0] ?? 0, 0, 1), clamp(rgb[1] ?? 0, 0, 1), clamp(rgb[2] ?? 0, 0, 1)];
  return Math.max(...values) - Math.min(...values);
};

/** Resolve the neighboring mixer bands for a rendered sample, including their falloff weights. */
export const resolveColorMixerBandWeights = (
  sampleHueDegrees: number,
  settings: SelectiveColorMixerSettings,
): readonly ColorMixerTargetedBandWeight[] =>
  SELECTIVE_COLOR_RANGES.map((range) => {
    const controls = settings.selectiveColorRangeControls[range.key];
    const distance = circularDistance(sampleHueDegrees, controls.centerHueDegrees);
    const radius = Math.max(controls.widthDegrees / 2, 1);
    const normalized = distance / radius;
    const weight = normalized >= 1 ? 0 : clamp((1 - normalized) ** controls.falloffSmoothness, 0, 1);
    return { key: range.key, weight };
  })
    .filter(({ weight }) => weight > 0)
    .sort((left, right) => right.weight - left.weight);

/** Apply one bounded vertical targeted gesture to only the weighted H/S/L bands. */
export const applyColorMixerTargetedDelta = (
  settings: SelectiveColorMixerSettings,
  mode: ColorMixerTargetedMode,
  bands: readonly ColorMixerTargetedBandWeight[],
  delta: number,
): SelectiveColorMixerSettings => {
  const key = mode;
  const boundedDelta = clamp(delta, -100, 100);
  const nextHsl = { ...settings.hsl };
  for (const { key: rangeKey, weight } of bands) {
    const current = nextHsl[rangeKey];
    nextHsl[rangeKey] = { ...current, [key]: clamp(current[key] + boundedDelta * clamp(weight, 0, 1), -100, 100) };
  }
  return { ...settings, hsl: nextHsl };
};

export const colorMixerTargetedDeltaFromVerticalDrag = (startClientY: number, clientY: number): number =>
  clamp((startClientY - clientY) / 2, -100, 100);
