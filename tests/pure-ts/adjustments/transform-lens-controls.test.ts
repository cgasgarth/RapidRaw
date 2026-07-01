import { describe, expect, test } from 'bun:test';

import {
  ADJUSTMENT_SECTIONS,
  hasAdjustmentValueChanges,
  INITIAL_ADJUSTMENTS,
  normalizeLoadedAdjustments,
  pickAdjustmentValues,
} from '../../../src/utils/adjustments';
import {
  buildGeometryPreviewParams,
  getLensCorrectionAvailability,
  hasSupportedLensCorrections,
  type LensDistortionParams,
  TRANSFORM_LENS_ADJUSTMENT_KEYS,
} from '../../../src/utils/transformLensControls';

const profileParams: LensDistortionParams = {
  k1: 0.012,
  k2: -0.004,
  k3: 0,
  model: 1,
  tca_vb: 0.9994,
  tca_vr: 1.0006,
  vig_k1: -0.02,
  vig_k2: 0.004,
  vig_k3: 0,
};

describe('transform lens controls', () => {
  test('keeps loaded transform and lens defaults intact', () => {
    const normalized = normalizeLoadedAdjustments({});

    expect(pickAdjustmentValues(TRANSFORM_LENS_ADJUSTMENT_KEYS, normalized)).toEqual(
      pickAdjustmentValues(TRANSFORM_LENS_ADJUSTMENT_KEYS, INITIAL_ADJUSTMENTS),
    );
    expect(hasAdjustmentValueChanges(ADJUSTMENT_SECTIONS.transformLens, normalized)).toBe(false);
  });

  test('marks transform lens section dirty when geometry or lens profile data changes', () => {
    expect(
      hasAdjustmentValueChanges(ADJUSTMENT_SECTIONS.transformLens, {
        ...INITIAL_ADJUSTMENTS,
        lensDistortionParams: profileParams,
      }),
    ).toBe(true);

    expect(
      hasAdjustmentValueChanges(ADJUSTMENT_SECTIONS.transformLens, {
        ...INITIAL_ADJUSTMENTS,
        transformVertical: 8,
      }),
    ).toBe(true);
  });

  test('disables unavailable lens correction families from profile params', () => {
    expect(getLensCorrectionAvailability(null)).toEqual({
      distortion: false,
      tca: false,
      vignetting: false,
    });
    expect(hasSupportedLensCorrections(getLensCorrectionAvailability(null))).toBe(false);

    const availability = getLensCorrectionAvailability(profileParams);
    expect(availability).toEqual({
      distortion: true,
      tca: true,
      vignetting: true,
    });
    expect(hasSupportedLensCorrections(availability)).toBe(true);
  });

  test('builds native geometry params from the same adjustment fields used by export', () => {
    const params = buildGeometryPreviewParams({
      ...INITIAL_ADJUSTMENTS,
      lensDistortionAmount: 55,
      lensDistortionEnabled: false,
      lensDistortionParams: profileParams,
      lensTcaAmount: 80,
      lensTcaEnabled: false,
      lensVignetteAmount: 70,
      lensVignetteEnabled: false,
      transformAspect: -2,
      transformDistortion: 12.5,
      transformHorizontal: 4,
      transformRotate: 1.5,
      transformScale: 88,
      transformVertical: -3,
      transformXOffset: 9,
      transformYOffset: -7,
    });

    expect(params).toMatchObject({
      aspect: -2,
      distortion: 12.5,
      horizontal: 4,
      lens_dist_k1: 0.012,
      lens_dist_k2: -0.004,
      lens_distortion_amount: 0.55,
      lens_distortion_enabled: false,
      lens_model: 1,
      lens_tca_amount: 0.8,
      lens_tca_enabled: false,
      lens_vignette_amount: 0.7,
      lens_vignette_enabled: false,
      rotate: 1.5,
      scale: 88,
      tca_vb: 0.9994,
      tca_vr: 1.0006,
      vertical: -3,
      vig_k1: -0.02,
      vig_k2: 0.004,
      x_offset: 9,
      y_offset: -7,
    });
  });
});
