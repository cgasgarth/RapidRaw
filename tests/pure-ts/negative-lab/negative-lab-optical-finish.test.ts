import { describe, expect, test } from 'bun:test';

import {
  negativeLabOpticalFinishMetricsSchema,
  negativeLabOpticalFinishParamsSchema,
} from '../../../src/schemas/negative-lab/negativeLabOpticalFinishSchemas';

const hash = 'sha256:' + 'a'.repeat(64);

describe('Negative Lab optical finish contract', () => {
  test('default-off parameters are valid and metrics preserve native identity', () => {
    const params = negativeLabOpticalFinishParamsSchema.parse({
      algorithmVersion: 1,
      enabled: false,
      glowAmount: 0,
      glowRadius: 0.02,
      glowThreshold: 0.35,
      halationAmount: 0,
      halationRadius: 0.02,
      halationThreshold: 0.35,
      orangeWeight: 0.35,
      redWeight: 0.75,
      scaleBasis: 'full_resolution_short_edge_v1',
      workingSpace: 'scene_linear_srgb_d65_v1',
    });
    expect(params.enabled).toBe(false);
    const metrics = negativeLabOpticalFinishMetricsSchema.parse({
      afterHash: hash,
      algorithmId: 'negative_lab_optical_finish_v1',
      algorithmVersion: 1,
      beforeHash: hash,
      changedPixelRatio: 0,
      effectiveGlowRadiusPixels: 0,
      effectiveHalationRadiusPixels: 0,
      gamutClippedPixelCount: 0,
      localizedMaskRatio: 0,
      operationId: 'negative_lab.optical_finish',
      prePolicyOvershoot: 0,
      warningCodes: [],
    });
    expect(metrics.beforeHash).toBe(metrics.afterHash);
  });

  test('rejects an unbounded radius', () => {
    expect(() =>
      negativeLabOpticalFinishParamsSchema.parse({
        algorithmVersion: 1,
        enabled: true,
        glowAmount: 0.2,
        glowRadius: 0.5,
        glowThreshold: 0.35,
        halationAmount: 0,
        halationRadius: 0.02,
        halationThreshold: 0.35,
        orangeWeight: 0.35,
        redWeight: 0.75,
        scaleBasis: 'full_resolution_short_edge_v1',
        workingSpace: 'scene_linear_srgb_d65_v1',
      }),
    ).toThrow();
  });
});
