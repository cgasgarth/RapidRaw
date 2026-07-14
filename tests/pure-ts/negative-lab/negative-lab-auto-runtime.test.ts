import { describe, expect, test } from 'bun:test';

import { negativeLabSetConversionRecipeParametersV1Schema } from '../../../packages/rawengine-schema/src/rawEngineSchemas';

const baseRecipe = {
  baseStrategy: { baseSampleIds: [], mode: 'profile_default_low_confidence' as const },
  conversionModel: {
    algorithmId: 'density_rgb_v1' as const,
    algorithmVersion: 1 as const,
    densityMax: 4,
    epsilonPolicyId: 'density_epsilon_v1' as const,
    negativeDensityTolerance: 0.01,
  },
  curveModel: { curveFamily: 'parametric_monotonic_v1' as const },
  frameSelection: {
    excludeFrameIds: [],
    frameIds: ['frame-1'],
    mode: 'selected' as const,
    qcStatuses: [],
    warningCodes: [],
  },
  inputCharacterization: {
    channelBasis: 'scanner_rgb' as const,
    confidence: 'declared_linear_scan_rgb' as const,
    pixelBasis: 'linear_scan_rgb' as const,
  },
  neutralization: { mode: 'none' as const, sampleIds: [] },
  outputIntent: 'proof_preview' as const,
  previewRequest: { artifactPurposes: ['objective_positive_preview' as const], includePreview: true },
  processFamily: 'c41_color_negative' as const,
  sessionId: 'session-auto-runtime',
};

describe('Negative Lab native auto meter recipe contract', () => {
  test('defaults independent helpers to disabled and preserves explicit switches', () => {
    const identity = negativeLabSetConversionRecipeParametersV1Schema.parse(baseRecipe);
    expect(identity.autoMeter).toMatchObject({ autoDensityEnabled: false, autoGradeEnabled: false });

    const enabled = negativeLabSetConversionRecipeParametersV1Schema.parse({
      ...baseRecipe,
      autoMeter: {
        autoDensityEnabled: true,
        autoGradeEnabled: true,
        autoDensityStrength: 0.7,
        autoGradeStrength: 0.45,
      },
    });
    expect(enabled.autoMeter.autoDensityEnabled).toBe(true);
    expect(enabled.autoMeter.autoGradeEnabled).toBe(true);
    expect(enabled.autoMeter.autoDensityStrength).toBe(0.7);
    expect(enabled.autoMeter.autoGradeStrength).toBe(0.45);
  });

  test('rejects unsafe strength and confidence values before native invocation', () => {
    expect(() =>
      negativeLabSetConversionRecipeParametersV1Schema.parse({
        ...baseRecipe,
        autoMeter: { autoDensityStrength: 1.1 },
      }),
    ).toThrow();
    expect(() =>
      negativeLabSetConversionRecipeParametersV1Schema.parse({
        ...baseRecipe,
        autoMeter: { confidenceThreshold: 0.1 },
      }),
    ).toThrow();
  });
});
