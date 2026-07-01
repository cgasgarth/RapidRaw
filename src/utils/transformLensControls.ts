import type { Adjustments } from './adjustments';

export interface LensDistortionParams {
  k1: number;
  k2: number;
  k3: number;
  model: number;
  tca_vb: number;
  tca_vr: number;
  vig_k1: number;
  vig_k2: number;
  vig_k3: number;
}

export interface GeometryPreviewParams {
  aspect: number;
  distortion: number;
  horizontal: number;
  lens_dist_k1: number;
  lens_dist_k2: number;
  lens_dist_k3: number;
  lens_distortion_amount: number;
  lens_distortion_enabled: boolean;
  lens_model: number;
  lens_tca_amount: number;
  lens_tca_enabled: boolean;
  lens_vignette_amount: number;
  lens_vignette_enabled: boolean;
  rotate: number;
  scale: number;
  tca_vb: number;
  tca_vr: number;
  vertical: number;
  vig_k1: number;
  vig_k2: number;
  vig_k3: number;
  x_offset: number;
  y_offset: number;
}

export interface LensCorrectionAvailability {
  distortion: boolean;
  tca: boolean;
  vignetting: boolean;
}

const SLIDER_AMOUNT_DIVISOR = 100;
const DISTORTION_EPSILON = 1e-6;
const TCA_EPSILON = 1e-5;

export const TRANSFORM_LENS_ADJUSTMENT_KEYS = [
  'transformDistortion',
  'transformVertical',
  'transformHorizontal',
  'transformRotate',
  'transformAspect',
  'transformScale',
  'transformXOffset',
  'transformYOffset',
  'lensCorrectionMode',
  'lensMaker',
  'lensModel',
  'lensDistortionAmount',
  'lensVignetteAmount',
  'lensTcaAmount',
  'lensDistortionEnabled',
  'lensTcaEnabled',
  'lensVignetteEnabled',
  'lensDistortionParams',
] as const satisfies ReadonlyArray<keyof Adjustments>;

export const getLensCorrectionAvailability = (
  params: LensDistortionParams | null | undefined,
): LensCorrectionAvailability => {
  if (params == null) {
    return { distortion: false, tca: false, vignetting: false };
  }

  return {
    distortion:
      Math.abs(params.k1) > DISTORTION_EPSILON ||
      Math.abs(params.k2) > DISTORTION_EPSILON ||
      Math.abs(params.k3) > DISTORTION_EPSILON,
    tca: Math.abs(params.tca_vr - 1) > TCA_EPSILON || Math.abs(params.tca_vb - 1) > TCA_EPSILON,
    vignetting:
      Math.abs(params.vig_k1) > DISTORTION_EPSILON ||
      Math.abs(params.vig_k2) > DISTORTION_EPSILON ||
      Math.abs(params.vig_k3) > DISTORTION_EPSILON,
  };
};

export const buildGeometryPreviewParams = (adjustments: Adjustments): GeometryPreviewParams => ({
  aspect: adjustments.transformAspect,
  distortion: adjustments.transformDistortion,
  horizontal: adjustments.transformHorizontal,
  lens_dist_k1: adjustments.lensDistortionParams?.k1 ?? 0,
  lens_dist_k2: adjustments.lensDistortionParams?.k2 ?? 0,
  lens_dist_k3: adjustments.lensDistortionParams?.k3 ?? 0,
  lens_distortion_amount: adjustments.lensDistortionAmount / SLIDER_AMOUNT_DIVISOR,
  lens_distortion_enabled: adjustments.lensDistortionEnabled,
  lens_model: adjustments.lensDistortionParams?.model ?? 0,
  lens_tca_amount: adjustments.lensTcaAmount / SLIDER_AMOUNT_DIVISOR,
  lens_tca_enabled: adjustments.lensTcaEnabled,
  lens_vignette_amount: adjustments.lensVignetteAmount / SLIDER_AMOUNT_DIVISOR,
  lens_vignette_enabled: adjustments.lensVignetteEnabled,
  rotate: adjustments.transformRotate,
  scale: adjustments.transformScale,
  tca_vb: adjustments.lensDistortionParams?.tca_vb ?? 1,
  tca_vr: adjustments.lensDistortionParams?.tca_vr ?? 1,
  vertical: adjustments.transformVertical,
  vig_k1: adjustments.lensDistortionParams?.vig_k1 ?? 0,
  vig_k2: adjustments.lensDistortionParams?.vig_k2 ?? 0,
  vig_k3: adjustments.lensDistortionParams?.vig_k3 ?? 0,
  x_offset: adjustments.transformXOffset,
  y_offset: adjustments.transformYOffset,
});

export const hasSupportedLensCorrections = (availability: LensCorrectionAvailability): boolean =>
  availability.distortion || availability.tca || availability.vignetting;
