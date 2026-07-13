import { describe, expect, test } from 'bun:test';
import {
  buildTechnicalWhiteBalance,
  buildTechnicalWhiteBalancePreset,
  technicalWhiteBalanceFromAutoAdjustments,
  technicalWhiteBalanceMatrix,
  WHITE_BALANCE_PRESETS,
} from '../../../src/utils/color/whiteBalance';
import { applyWhiteBalanceToRgbPixel } from '../../../src/utils/whiteBalancePicker';

// BabelColor-derived ColorChecker Classic sRGB measurements, D65 encoding.
const COLORCHECKER_SRGB8 = [
  [115, 82, 68],
  [194, 150, 130],
  [98, 122, 157],
  [87, 108, 67],
  [133, 128, 177],
  [103, 189, 170],
  [214, 126, 44],
  [80, 91, 166],
  [193, 90, 99],
  [94, 60, 108],
  [157, 188, 64],
  [224, 163, 46],
  [56, 61, 150],
  [70, 148, 73],
  [175, 54, 60],
  [231, 199, 31],
  [187, 86, 149],
  [8, 133, 161],
  [243, 243, 242],
  [200, 200, 200],
  [160, 160, 160],
  [122, 122, 121],
  [85, 85, 85],
  [52, 52, 52],
] as const;

const AP1_TO_XYZ_D60 = [
  [0.66245418, 0.13400421, 0.15618769],
  [0.27222872, 0.67408177, 0.05368952],
  [-0.00557465, 0.00406073, 1.0103391],
];
const XYZ_D65_TO_AP1 = [
  [1.64102338, -0.32480329, -0.2364247],
  [-0.66366286, 1.61533159, 0.01675635],
  [0.01172189, -0.00828444, 0.98839486],
];
const SRGB_TO_XYZ_D65 = [
  [0.4124564, 0.3575761, 0.1804375],
  [0.2126729, 0.7151522, 0.072175],
  [0.0193339, 0.119192, 0.9503041],
];
const mulVector = (matrix: number[][], vector: readonly number[]) =>
  matrix.map((row) => row.reduce((sum, value, index) => sum + value * vector[index]!, 0));
const inverse3 = (matrix: number[][]) => {
  const [a, b, c] = matrix[0]!;
  const [d, e, f] = matrix[1]!;
  const [g, h, i] = matrix[2]!;
  const determinant = a! * (e! * i! - f! * h!) - b! * (d! * i! - f! * g!) + c! * (d! * h! - e! * g!);
  return [
    [(e! * i! - f! * h!) / determinant, (c! * h! - b! * i!) / determinant, (b! * f! - c! * e!) / determinant],
    [(f! * g! - d! * i!) / determinant, (a! * i! - c! * g!) / determinant, (c! * d! - a! * f!) / determinant],
    [(d! * h! - e! * g!) / determinant, (b! * g! - a! * h!) / determinant, (a! * e! - b! * d!) / determinant],
  ];
};
const linearize = (value: number) => {
  const normalized = value / 255;
  return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
};
const xyzToLab = ([x, y, z]: number[]) => {
  const f = (value: number) => (value > 216 / 24389 ? Math.cbrt(value) : ((24389 / 27) * value + 16) / 116);
  const fx = f(x! / 0.952646),
    fy = f(y!),
    fz = f(z! / 1.008825);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
};
const deltaE76 = (left: number[], right: number[]) => Math.hypot(...left.map((value, index) => value - right[index]!));

describe('professional white balance contract', () => {
  test('common presets compile to their named physical illuminants', () => {
    expect(WHITE_BALANCE_PRESETS.map(({ id }) => id)).toEqual(['tungsten', 'daylight', 'flash', 'cloudy', 'shade']);
    const shade = buildTechnicalWhiteBalancePreset('shade');
    expect(shade).toMatchObject({ mode: 'preset', presetId: 'shade', kelvin: 7500, source: 'preset' });
    expect(technicalWhiteBalanceMatrix(shade).flat().every(Number.isFinite)).toBeTrue();
  });

  test('records rendered-source limits and reference-lock semantics', () => {
    const rendered = {
      ...buildTechnicalWhiteBalance('kelvin_tint', 5500, 0),
      inputSemantics: 'rendered_scene_linear_approximation' as const,
      synchronization: { mode: 'locked_reference' as const, referenceSourceIdentity: 'source:reference.raw' },
    };
    expect(rendered.inputSemantics).toBe('rendered_scene_linear_approximation');
    expect(rendered.synchronization).toEqual({
      mode: 'locked_reference',
      referenceSourceIdentity: 'source:reference.raw',
    });
  });

  test('accepts only truthful Auto analysis receipts and preserves source semantics', () => {
    const auto = buildTechnicalWhiteBalance('auto', 4380, 0.008, 'auto');
    const resolved = technicalWhiteBalanceFromAutoAdjustments(
      { whiteBalanceTechnical: { ...auto, confidence: 0.72, sampleCount: 412 } },
      'rendered_scene_linear_approximation',
    );
    expect(resolved).toMatchObject({
      mode: 'auto',
      source: 'auto',
      confidence: 0.72,
      sampleCount: 412,
      inputSemantics: 'rendered_scene_linear_approximation',
    });
    expect(() =>
      technicalWhiteBalanceFromAutoAdjustments(
        { whiteBalanceTechnical: buildTechnicalWhiteBalance('kelvin_tint', 4380, 0.008) },
        'raw_scene_linear',
      ),
    ).toThrow('auto_white_balance_invalid_runtime_receipt');
    expect(() => technicalWhiteBalanceFromAutoAdjustments({}, 'raw_scene_linear')).toThrow(
      'auto_white_balance_missing_runtime_receipt',
    );
  });

  test('CAT16 materially lowers measured ColorChecker ΔE under tungsten and shade', () => {
    const d65ToD60 = technicalWhiteBalanceMatrix(buildTechnicalWhiteBalance('kelvin_tint', 6504, 0));
    const references = COLORCHECKER_SRGB8.map((rgb) =>
      mulVector(d65ToD60, mulVector(XYZ_D65_TO_AP1, mulVector(SRGB_TO_XYZ_D65, rgb.map(linearize)))),
    );
    for (const [kelvin, legacyTemperature] of [
      [2856, -100],
      [7504, 40],
    ] as const) {
      const cat = technicalWhiteBalanceMatrix(buildTechnicalWhiteBalance('kelvin_tint', kelvin, 0));
      const cast = inverse3(cat);
      const errors = references.map((reference) => {
        const source = mulVector(cast, reference);
        const corrected = mulVector(cat, source);
        const legacyResult = applyWhiteBalanceToRgbPixel(
          { red: source[0]!, green: source[1]!, blue: source[2]! },
          legacyTemperature,
          0,
        ).outputRgb;
        const referenceLab = xyzToLab(mulVector(AP1_TO_XYZ_D60, reference));
        return {
          cat: deltaE76(xyzToLab(mulVector(AP1_TO_XYZ_D60, corrected)), referenceLab),
          legacy: deltaE76(
            xyzToLab(mulVector(AP1_TO_XYZ_D60, [legacyResult.red, legacyResult.green, legacyResult.blue])),
            referenceLab,
          ),
        };
      });
      const mean = (key: 'cat' | 'legacy') => errors.reduce((sum, error) => sum + error[key], 0) / errors.length;
      expect(mean('cat')).toBeLessThan(0.01);
      expect(mean('cat')).toBeLessThan(mean('legacy') * 0.1);
    }
  });
});
