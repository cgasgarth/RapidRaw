import { describe, expect, test } from 'bun:test';

import {
  detailDenoiseUiControlsV1Schema,
  toDetailDenoiseControlsV1,
} from '../../../packages/rawengine-schema/src/rawEngineSchemas.ts';
import { INITIAL_ADJUSTMENTS } from '../../../src/utils/adjustments.ts';

describe('professional denoise controls', () => {
  test('migrates legacy luma/color controls to safe realtime defaults', () => {
    const legacy = detailDenoiseUiControlsV1Schema.parse({
      colorNoiseReduction: 35,
      lumaNoiseReduction: 45,
    });

    expect(toDetailDenoiseControlsV1(legacy)).toEqual({
      chromaStrength: 0.35,
      contrastProtection: 0.5,
      detail: 0.5,
      lumaStrength: 0.45,
      naturalGrain: 0,
      shadowBias: 0,
    });
  });

  test('maps independent UI controls into the versioned runtime contract', () => {
    const controls = detailDenoiseUiControlsV1Schema.parse({
      colorNoiseReduction: 62,
      denoiseContrastProtection: 73,
      denoiseDetail: 81,
      denoiseNaturalGrain: 44,
      denoiseShadowBias: -25,
      lumaNoiseReduction: 57,
    });

    expect(toDetailDenoiseControlsV1(controls)).toEqual({
      chromaStrength: 0.62,
      contrastProtection: 0.73,
      detail: 0.81,
      lumaStrength: 0.57,
      naturalGrain: 0.44,
      shadowBias: -0.25,
    });
  });

  test('new edits start neutral except for protective detail defaults', () => {
    expect(INITIAL_ADJUSTMENTS).toMatchObject({
      denoiseContrastProtection: 50,
      denoiseDetail: 50,
      denoiseNaturalGrain: 0,
      denoiseShadowBias: 0,
    });
  });
});
