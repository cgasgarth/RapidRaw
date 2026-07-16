import { describe, expect, test } from 'bun:test';
import { technicalWhiteBalanceV1Schema } from '../../../packages/rawengine-schema/src/color/whiteBalanceSchemas.ts';
import {
  type Adjustments,
  INITIAL_ADJUSTMENTS,
  INITIAL_MASK_ADJUSTMENTS,
  normalizeLoadedAdjustments,
} from '../../../src/utils/adjustments.ts';
import { applyColorParityTechnicalWhiteBalance } from '../../../src/utils/color/runtime/colorCpuGpuParity.ts';
import {
  buildTechnicalWhiteBalance,
  cctDuvToXy,
  INITIAL_TECHNICAL_WHITE_BALANCE,
  technicalWhiteBalanceMatrix,
} from '../../../src/utils/color/whiteBalance.ts';
import { estimateNeutralSampleIlluminant } from '../../../src/utils/whiteBalancePicker.ts';

describe('illuminant-based white balance', () => {
  test('builds finite CAT16 AP1 matrices for standard and off-locus illuminants', () => {
    for (const kelvin of [2856, 5003, 5503, 6504, 7504]) {
      for (const duv of [-0.02, 0, 0.02]) {
        const settings = buildTechnicalWhiteBalance('kelvin_tint', kelvin, duv);
        expect(technicalWhiteBalanceV1Schema.parse(settings)).toEqual(settings);
        expect(technicalWhiteBalanceMatrix(settings).flat().every(Number.isFinite)).toBe(true);
        const [x, y] = cctDuvToXy(kelvin, duv);
        expect(x).toBeGreaterThan(0);
        expect(y).toBeGreaterThan(0);
        expect(x + y).toBeLessThan(1);
      }
    }
  });

  test('as-shot is an exact identity and technical changes are deterministic', () => {
    expect(technicalWhiteBalanceMatrix(INITIAL_TECHNICAL_WHITE_BALANCE)).toEqual([
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 1],
    ]);
    expect(technicalWhiteBalanceMatrix(buildTechnicalWhiteBalance('kelvin_tint', 3200, 0))).not.toEqual(
      technicalWhiteBalanceMatrix(buildTechnicalWhiteBalance('kelvin_tint', 7500, 0)),
    );
  });

  test('CPU matrix application matches the production WGSL column-matrix convention', () => {
    const matrix = technicalWhiteBalanceMatrix(buildTechnicalWhiteBalance('kelvin_tint', 3200, 0.008));
    const output = applyColorParityTechnicalWhiteBalance([0.18, 0.32, 0.54], matrix);
    const direct = matrix.map((row) =>
      row.reduce((sum, coefficient, index) => sum + coefficient * [0.18, 0.32, 0.54][index]!, 0),
    );
    expect(output[0]).toBeCloseTo(direct[0]!, 7);
    expect(output[1]).toBeCloseTo(direct[1]!, 7);
    expect(output[2]).toBeCloseTo(direct[2]!, 7);
  });

  test('requires current technical WB and rejects old flat global WB state', () => {
    expect(() => normalizeLoadedAdjustments({ exposure: 0.25 })).toThrow('adjustments.missing_white_balance_technical');
    expect(() => normalizeLoadedAdjustments({ ...INITIAL_ADJUSTMENTS, temperature: 18, tint: -9 })).toThrow(
      'adjustments.obsolete_white_balance_representation',
    );
    expect(() => normalizeLoadedAdjustments({ creativeTemperature: 18 } as Partial<Adjustments>)).toThrow(
      'adjustments.obsolete_white_balance_representation',
    );
    expect(INITIAL_MASK_ADJUSTMENTS).toMatchObject({ temperature: 0, tint: 0 });
  });

  test('accepts Lightroom kelvin/tint import provenance without claiming a named preset', () => {
    const imported = buildTechnicalWhiteBalance('kelvin_tint', 4_850, 0.006, 'preset');
    expect(imported.presetId).toBeNull();
    expect(technicalWhiteBalanceV1Schema.parse(imported)).toEqual(imported);
  });

  test('neutral picker reports physical coordinates and rejects clipped confidence', () => {
    const neutral = estimateNeutralSampleIlluminant({ red: 180, green: 180, blue: 180 });
    const clipped = estimateNeutralSampleIlluminant({ red: 255, green: 180, blue: 180 });
    expect(neutral.kelvin).toBeGreaterThan(5000);
    expect(neutral.confidence).toBeGreaterThan(clipped.confidence);
    expect(clipped.clippedChannelCount).toBe(1);
  });
});
