import { describe, expect, test } from 'bun:test';
import {
  negativeLabOutputTransformSchema,
  negativeLabSceneLinearStatsSchema,
} from '../../../src/schemas/negative-lab/negativeLabOutputTransformSchemas.ts';

describe('negative lab output transform contract', () => {
  test('keeps scene-linear identity separate from the named display transform', () => {
    const transform = negativeLabOutputTransformSchema.parse({
      bitDepth: 8,
      implementationVersion: 1,
      inputColorDomain: 'scene_linear_print_srgb_d65',
      intent: 'display_preview',
      outputColorDomain: 'srgb_display',
      transformId: 'scene_linear_to_srgb_gamma_v1',
      transferFunction: 'gamma_2_2_display_proof',
    });
    const stats = negativeLabSceneLinearStatsSchema.parse({
      contentHash: `sha256:${'a'.repeat(64)}`,
      max: 1,
      min: 0,
      nonFiniteCount: 0,
    });
    expect(transform.inputColorDomain).not.toBe(transform.outputColorDomain);
    expect(stats.contentHash).toMatch(/^sha256:[a-f0-9]{64}$/u);
    expect(() =>
      negativeLabOutputTransformSchema.parse({
        ...transform,
        inputColorDomain: 'srgb_display',
        outputColorDomain: 'srgb_display',
      }),
    ).toThrow();
  });
});
