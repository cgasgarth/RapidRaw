import { describe, expect, test } from 'bun:test';

import {
  negativeLabScannerColorFinishV1Schema,
  negativeLabSetConversionRecipeParametersV1Schema,
} from '../../../packages/rawengine-schema/src/rawEngineSchemas';

describe('Negative Lab scanner color finish', () => {
  test('defaults to an exact disabled identity recipe', () => {
    const finish = negativeLabScannerColorFinishV1Schema.parse({});
    expect(finish).toEqual({
      algorithmVersion: 1,
      chromaDenoiseRadius: 0,
      chromaDenoiseStrength: 0,
      enabled: false,
      saturationTrim: 0,
      transformId: 'linear_srgb_d65_cielab_v1',
      vibrance: 0,
      workingSpace: 'linear_srgb_d65',
    });
  });

  test('rejects out-of-range strength and radius before native invocation', () => {
    expect(() => negativeLabScannerColorFinishV1Schema.parse({ chromaDenoiseStrength: 1.1 })).toThrow();
    expect(() => negativeLabScannerColorFinishV1Schema.parse({ chromaDenoiseRadius: 0.11 })).toThrow();
  });

  test('conversion recipes carry color finish defaults and preserve explicit settings', () => {
    const recipe = negativeLabSetConversionRecipeParametersV1Schema.parse({
      baseStrategy: { baseSampleIds: [], mode: 'profile_default_low_confidence' },
      conversionModel: {
        algorithmId: 'density_rgb_v1',
        algorithmVersion: 1,
        densityMax: 4,
        epsilonPolicyId: 'density_epsilon_v1',
        negativeDensityTolerance: 0.01,
      },
      curveModel: { curveFamily: 'parametric_monotonic_v1' },
      frameSelection: {
        excludeFrameIds: [],
        frameIds: ['frame-1'],
        mode: 'selected',
        qcStatuses: [],
        warningCodes: [],
      },
      inputCharacterization: {
        channelBasis: 'scanner_rgb',
        confidence: 'declared_linear_scan_rgb',
        pixelBasis: 'linear_scan_rgb',
      },
      neutralization: { mode: 'none', sampleIds: [] },
      outputIntent: 'proof_preview',
      previewRequest: { artifactPurposes: ['objective_positive_preview'], includePreview: true },
      processFamily: 'c41_color_negative',
      sessionId: 'session-1',
      colorFinish: { chromaDenoiseStrength: 0.6, enabled: true, vibrance: 0.08 },
    });
    expect(recipe.colorFinish.enabled).toBe(true);
    expect(recipe.colorFinish.chromaDenoiseStrength).toBe(0.6);
    expect(recipe.colorFinish.transformId).toBe('linear_srgb_d65_cielab_v1');
  });
});
