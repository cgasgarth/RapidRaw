import { describe, expect, test } from 'bun:test';

import { negativeLabCmyTimingParamsSchema } from '../../../src/schemas/negative-lab/negativeLabCmyTimingSchemas';

const defaults = {
  algorithm_version: 1,
  enabled: false,
  global_c: 0,
  global_m: 0,
  global_y: 0,
  shadow_c: 0,
  shadow_m: 0,
  shadow_y: 0,
  highlight_c: 0,
  highlight_m: 0,
  highlight_y: 0,
  transition_width: 0.15,
  source: 'manual_global_v1',
  sign_convention: 'positive_density_reduces_channel_exposure_v1' as const,
};

describe('Negative Lab density-domain CMY timing', () => {
  test('preserves explicit subtractive sign convention and regional fields', () => {
    const parsed = negativeLabCmyTimingParamsSchema.parse({
      ...defaults,
      enabled: true,
      shadow_c: 0.2,
      highlight_y: -0.1,
    });
    expect(parsed.sign_convention).toBe('positive_density_reduces_channel_exposure_v1');
    expect(parsed.shadow_c).toBe(0.2);
  });

  test('rejects unbounded transition width', () => {
    expect(() => negativeLabCmyTimingParamsSchema.parse({ ...defaults, transition_width: 0.9 })).toThrow();
  });
});
