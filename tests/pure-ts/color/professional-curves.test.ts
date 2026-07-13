import { describe, expect, test } from 'bun:test';

import { outputCurveV1Schema, sceneCurveV1Schema } from '../../../packages/rawengine-schema/src/index.ts';

describe('professional curve schemas', () => {
  test('accepts scene EV and HDR output curve contracts', () => {
    const scene = sceneCurveV1Schema.parse({
      enabled: true,
      channelMode: 'luminance_preserving',
      interpolation: 'monotone_cubic',
      middleGrey: 0.18,
      points: [
        { xEv: -16, yEv: -16 },
        { xEv: 0, yEv: 0 },
        { xEv: 16, yEv: 16 },
      ],
      lowExtrapolation: 'linear_tangent',
      highExtrapolation: 'linear_tangent',
      preserveColor: 'luminance_ratio',
    });
    const output = outputCurveV1Schema.parse({
      enabled: true,
      domain: 'output_encoded',
      outputProfileId: 'display-p3-hdr',
      referenceWhite: 1,
      maximumValue: 4,
      channelMode: 'linked_rgb',
      interpolation: 'monotone_cubic',
      points: [
        { x: 0, y: 0 },
        { x: 1, y: 1 },
        { x: 4, y: 3.5 },
      ],
      lowExtrapolation: 'linear_tangent',
      highExtrapolation: { softRollOffStrength: 0.5 },
      preserveColor: 'none',
    });

    expect(scene.domain).toBe('scene_log2_ev');
    expect(output.maximumValue).toBe(4);
  });

  test('rejects invalid point counts and HDR ranges below reference white', () => {
    expect(() =>
      outputCurveV1Schema.parse({
        enabled: true,
        domain: 'output_encoded',
        outputProfileId: 'invalid',
        referenceWhite: 1,
        maximumValue: 0.5,
        channelMode: 'linked_rgb',
        interpolation: 'linear',
        points: [{ x: 0, y: 0 }],
        lowExtrapolation: 'constant',
        highExtrapolation: 'constant',
        preserveColor: 'none',
      }),
    ).toThrow();
  });
});
