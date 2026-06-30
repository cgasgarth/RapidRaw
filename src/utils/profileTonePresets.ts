import type { ToneCurveId } from '../schemas/color/profileToneSchemas';
import type { ParametricCurveSettings } from './adjustments';

const BASE_PARAMETRIC_CURVE: ParametricCurveSettings = {
  blackLevel: 0,
  darks: 0,
  highlights: 0,
  lights: 0,
  shadows: 0,
  split1: 25,
  split2: 50,
  split3: 75,
  whiteLevel: 0,
};

export const TONE_CURVE_PARAMETRIC_PRESETS: Record<ToneCurveId, ParametricCurveSettings> = {
  auto_filmic: {
    ...BASE_PARAMETRIC_CURVE,
    darks: -4,
    highlights: -8,
    lights: 5,
    shadows: 5,
    split1: 22,
    split3: 78,
  },
  high_contrast: {
    ...BASE_PARAMETRIC_CURVE,
    blackLevel: -2,
    darks: -8,
    highlights: 8,
    lights: 8,
    shadows: -6,
    whiteLevel: 2,
  },
  linear: BASE_PARAMETRIC_CURVE,
  shadow_lift: {
    ...BASE_PARAMETRIC_CURVE,
    darks: 8,
    highlights: -4,
    shadows: 12,
  },
  soft_contrast: {
    ...BASE_PARAMETRIC_CURVE,
    darks: -2,
    highlights: -5,
    lights: 4,
    shadows: 4,
  },
};
