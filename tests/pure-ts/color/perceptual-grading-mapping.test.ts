import { describe, expect, test } from 'bun:test';
import { perceptualGradingSettingsV1Schema } from '../../../packages/rawengine-schema/src/color/perceptualGradingSchemas';
import { perceptualGradingFromWheelSurface } from '../../../src/utils/color/perceptualGrading';

describe('perceptual grading wheel mapping', () => {
  test('maps the four-way UI into strict device-independent scene controls', () => {
    const plan = perceptualGradingFromWheelSurface({
      balance: -25,
      blending: 75,
      global: { hue: 10, saturation: 20, luminance: 5 },
      highlights: { hue: 45, saturation: 50, luminance: 20 },
      midtones: { hue: 25, saturation: 30, luminance: 0 },
      shadows: { hue: 220, saturation: 40, luminance: -15 },
    });

    expect(perceptualGradingSettingsV1Schema.parse(plan)).toEqual(plan);
    expect(plan.balance).toBe(-0.25);
    expect(plan.blending).toBe(0.75);
    expect(plan.shadows.chroma).toBeCloseTo(0.096);
    expect(plan.shadows.luminanceEv).toBeCloseTo(-0.3);
    expect(plan.highlights.hueDegrees).toBe(45);
  });
});
