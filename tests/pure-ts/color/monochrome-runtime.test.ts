import { describe, expect, test } from 'bun:test';

import { parseBlackWhiteMixerSettings } from '../../../src/schemas/color/blackWhiteMixerSchemas';
import {
  applyBlackWhiteMixerToRgbPixel,
  applyTargetedMonochromeMix,
  continuousMonochromeTarget,
} from '../../../src/utils/color/runtime/blackWhiteMixerRuntime';

const zeroWeights = {
  aquas: 0,
  blues: 0,
  greens: 0,
  magentas: 0,
  oranges: 0,
  purples: 0,
  reds: 0,
  yellows: 0,
};

describe('versioned monochrome runtime', () => {
  test('keeps missing process values on the pixel-stable legacy process', () => {
    const parsed = parseBlackWhiteMixerSettings({ enabled: false, weights: zeroWeights });
    expect(parsed.process).toBe('legacy_fixed_band_v1');
  });

  test('neutral panchromatic v1 uses AP1 energy without an SDR clamp', () => {
    const settings = { enabled: true, process: 'neutral_panchromatic_v1' as const, weights: zeroWeights };
    const source = { blue: 0.5, green: 2, red: 4 };
    const result = applyBlackWhiteMixerToRgbPixel(source, settings);
    const expected = 4 * 0.27222872 + 2 * 0.67408174 + 0.5 * 0.05368952;

    expect(result.outputRgb).toEqual({ blue: expected, green: expected, red: expected });
    expect(expected).toBeGreaterThan(1);
    expect(result.influence).toEqual({});
  });

  test('neutral panchromatic v1 is exposure-linear across sixteen stops', () => {
    const settings = { enabled: true, process: 'neutral_panchromatic_v1' as const, weights: zeroWeights };
    const source = { blue: 0.15, green: 0.7, red: 1.8 };
    const baseline = applyBlackWhiteMixerToRgbPixel(source, settings).luminance;

    for (const exposureEv of [-8, 8]) {
      const scale = 2 ** exposureEv;
      const exposed = applyBlackWhiteMixerToRgbPixel(
        { blue: source.blue * scale, green: source.green * scale, red: source.red * scale },
        settings,
      ).luminance;
      expect(exposed).toBeCloseTo(baseline * scale, 10);
    }
  });

  test('continuous sensitivity wraps smoothly and preserves scene headroom', () => {
    const weights = { ...zeroWeights, aquas: -100, blues: -60, magentas: 80, reds: 100 };
    const settings = { enabled: true, process: 'continuous_sensitivity_v1' as const, weights };
    const warm = applyBlackWhiteMixerToRgbPixel({ blue: 0.05, green: 0.1, red: 4 }, settings);
    const cool = applyBlackWhiteMixerToRgbPixel({ blue: 1.8, green: 0.3, red: 0.05 }, settings);

    expect(warm.outputRgb.red).toBeGreaterThan(cool.outputRgb.red);
    expect(warm.outputRgb.red).toBeGreaterThan(1);
    expect(warm.outputRgb.red).toBe(warm.outputRgb.green);
    expect(continuousMonochromeTarget(359.999).reds).toBeCloseTo(continuousMonochromeTarget(0.001).reds ?? 0, 6);
  });

  test('targeted mixing edits only the smooth neighboring sensitivity anchors', () => {
    const settings = { enabled: true, process: 'continuous_sensitivity_v1' as const, weights: zeroWeights };
    const targeted = applyTargetedMonochromeMix(settings, { blue: 0.05, green: 0.2, red: 0.9 }, 40);
    const changed = Object.entries(targeted.weights).filter(([, value]) => value !== 0);

    expect(targeted.process).toBe('continuous_sensitivity_v1');
    expect(changed.length).toBeGreaterThanOrEqual(1);
    expect(changed.length).toBeLessThanOrEqual(2);
  });
});
