import Color from 'colorjs.io';

export type GamutClassification = 'high_component' | 'in_gamut' | 'mixed_out_of_gamut' | 'negative_component';
export type GamutMappingDestination = 'display_p3' | 'srgb';

export interface GamutMappingRuntimeResult {
  classification: GamutClassification;
  clippedLinearRgb: [number, number, number];
  outOfGamutChannelCount: number;
  warnings: Array<string>;
}

export interface PerceptualGamutMappingRuntimeResult extends GamutMappingRuntimeResult {
  clipDeltaL1: number;
  hueAngleDriftDeg: number;
  neutralAxisDrift: number;
  perceptualDeltaL1: number;
  perceptualLinearRgb: [number, number, number];
  preservedInGamut: boolean;
  saturationMonotonic: boolean;
}

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));
const DESTINATION_COLOR_SPACE: Record<GamutMappingDestination, 'p3-linear' | 'srgb-linear'> = {
  display_p3: 'p3-linear',
  srgb: 'srgb-linear',
};

export function classifyLinearRgbGamut(rgb: readonly [number, number, number]): GamutClassification {
  const minComponent = Math.min(...rgb);
  const maxComponent = Math.max(...rgb);
  const hasNegative = minComponent < 0;
  const hasHigh = maxComponent > 1;

  if (hasNegative && hasHigh) return 'mixed_out_of_gamut';
  if (hasNegative) return 'negative_component';
  if (hasHigh) return 'high_component';
  return 'in_gamut';
}

export function applyRelativeColorimetricClipFallback(
  rgb: readonly [number, number, number],
): GamutMappingRuntimeResult {
  const classification = classifyLinearRgbGamut(rgb);
  const warnings = [];

  if (classification === 'negative_component' || classification === 'mixed_out_of_gamut') {
    warnings.push('output_gamut_negative_component_v1');
  }
  if (classification === 'high_component' || classification === 'mixed_out_of_gamut') {
    warnings.push('output_gamut_high_component_v1');
  }

  return {
    classification,
    clippedLinearRgb: [clamp01(rgb[0]), clamp01(rgb[1]), clamp01(rgb[2])],
    outOfGamutChannelCount: rgb.filter((component) => component < 0 || component > 1).length,
    warnings,
  };
}

export function applyPerceptualOklchChromaReduceReference(
  rgb: readonly [number, number, number],
  destination: GamutMappingDestination,
): PerceptualGamutMappingRuntimeResult {
  const clipRuntime = applyRelativeColorimetricClipFallback(rgb);
  const colorSpace = DESTINATION_COLOR_SPACE[destination];
  const mappedRgb = new Color(colorSpace, [...rgb])
    .toGamut({ method: 'oklch.c', space: colorSpace })
    .to(colorSpace)
    .coords.map((component) => clamp01(component ?? 0)) as [number, number, number];
  const inputOklch = new Color(colorSpace, [...rgb]).to('oklch').coords;
  const mappedOklch = new Color(colorSpace, mappedRgb).to('oklch').coords;
  const inputChroma = inputOklch[1] ?? 0;
  const mappedChroma = mappedOklch[1] ?? 0;
  const classification = clipRuntime.classification;
  const warnings = new Set(clipRuntime.warnings);

  if (classification !== 'in_gamut') warnings.add('output_gamut_perceptual_cpu_reference_v1');

  return {
    ...clipRuntime,
    clipDeltaL1: sumAbsDelta(rgb, clipRuntime.clippedLinearRgb),
    hueAngleDriftDeg: hueAngleDeltaDeg(inputOklch[2], mappedOklch[2]),
    neutralAxisDrift: Math.max(...mappedRgb) - Math.min(...mappedRgb),
    perceptualDeltaL1: sumAbsDelta(rgb, mappedRgb),
    perceptualLinearRgb: mappedRgb,
    preservedInGamut: classification !== 'in_gamut' || sumAbsDelta(rgb, mappedRgb) <= 1e-12,
    saturationMonotonic: mappedChroma <= inputChroma + 1e-12,
    warnings: [...warnings],
  };
}

function sumAbsDelta(left: readonly [number, number, number], right: readonly [number, number, number]): number {
  return Math.abs(left[0] - right[0]) + Math.abs(left[1] - right[1]) + Math.abs(left[2] - right[2]);
}

function hueAngleDeltaDeg(left: unknown, right: unknown): number {
  if (typeof left !== 'number' || typeof right !== 'number' || !Number.isFinite(left) || !Number.isFinite(right)) {
    return 0;
  }

  const rawDelta = Math.abs(left - right) % 360;
  return Math.min(rawDelta, 360 - rawDelta);
}
