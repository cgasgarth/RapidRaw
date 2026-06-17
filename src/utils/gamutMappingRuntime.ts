export type GamutClassification = 'high_component' | 'in_gamut' | 'mixed_out_of_gamut' | 'negative_component';

export interface GamutMappingRuntimeResult {
  classification: GamutClassification;
  clippedLinearRgb: [number, number, number];
  outOfGamutChannelCount: number;
  warnings: Array<string>;
}

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

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
