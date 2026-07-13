import { describe, expect, test } from 'bun:test';
import { technicalWhiteBalanceV1Schema } from '../../../packages/rawengine-schema/src/color/whiteBalanceSchemas.ts';
import { INITIAL_ADJUSTMENTS, normalizeLoadedAdjustments } from '../../../src/utils/adjustments.ts';
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

  test('migrates legacy temperature and tint into the creative node without changing values', () => {
    const loaded = normalizeLoadedAdjustments({ temperature: 18, tint: -9 });
    expect(loaded.whiteBalanceTechnical.mode).toBe('as_shot');
    expect(loaded.creativeTemperature).toBe(18);
    expect(loaded.creativeTint).toBe(-9);
    expect(loaded.whiteBalanceMigration).toBe('legacy_creative_temperature_tint_v1');
    expect(loaded.temperature).toBe(18);
    expect(loaded.tint).toBe(-9);

    const current = normalizeLoadedAdjustments(INITIAL_ADJUSTMENTS);
    expect(current.whiteBalanceMigration).toBe('native_v1');
  });

  test('neutral picker reports physical coordinates and rejects clipped confidence', () => {
    const neutral = estimateNeutralSampleIlluminant({ red: 180, green: 180, blue: 180 });
    const clipped = estimateNeutralSampleIlluminant({ red: 255, green: 180, blue: 180 });
    expect(neutral.kelvin).toBeGreaterThan(5000);
    expect(neutral.confidence).toBeGreaterThan(clipped.confidence);
    expect(clipped.clippedChannelCount).toBe(1);
  });
});
