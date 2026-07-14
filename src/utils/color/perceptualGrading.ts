import type {
  PerceptualGradingRangeV1,
  PerceptualGradingSettingsV1,
} from '../../../packages/rawengine-schema/src/color/perceptualGradingSchemas';

interface WheelValue {
  hue: number;
  luminance: number;
  saturation: number;
}

export interface LegacyGradingSurface {
  balance: number;
  blending: number;
  global: WheelValue;
  highlights: WheelValue;
  midtones: WheelValue;
  shadows: WheelValue;
}

const wheelRange = (value: WheelValue): PerceptualGradingRangeV1 => ({
  brilliance: 0,
  chroma: (value.saturation / 100) * 0.24,
  hueDegrees: value.hue,
  luminanceEv: (value.luminance / 100) * 2,
  saturation: 0,
});

export const perceptualGradingFromWheelSurface = (value: LegacyGradingSurface): PerceptualGradingSettingsV1 => ({
  balance: value.balance / 100,
  blending: value.blending / 100,
  falloff: 1,
  global: wheelRange(value.global),
  highlightFulcrumEv: 2,
  highlights: wheelRange(value.highlights),
  midtones: wheelRange(value.midtones),
  neutralProtection: 0.5,
  perceptualModel: 'oklab_d65_from_acescg_v1',
  shadowFulcrumEv: -2,
  shadows: wheelRange(value.shadows),
  skinProtection: 0,
});
