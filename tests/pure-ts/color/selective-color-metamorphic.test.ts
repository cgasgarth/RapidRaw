import { describe, expect, test } from 'bun:test';
import { applySelectiveColorToRgbPixel } from '../../../src/utils/color/selective/selectiveColorRuntime';

function hslHueToRgb(hue: number) {
  const sector = (((hue % 360) + 360) % 360) / 60;
  const x = 1 - Math.abs((sector % 2) - 1);
  if (sector < 1) return { red: 1, green: x, blue: 0 };
  if (sector < 2) return { red: x, green: 1, blue: 0 };
  if (sector < 3) return { red: 0, green: 1, blue: x };
  if (sector < 4) return { red: 0, green: x, blue: 1 };
  if (sector < 5) return { red: x, green: 0, blue: 1 };
  return { red: 1, green: 0, blue: x };
}

describe('selective color production runtime metamorphic properties', () => {
  test('influence and pixel effect decrease monotonically with wrapped hue distance', () => {
    const adjustment = { hue: 24, luminance: 12, saturation: 20 };
    const distances = [0, 4, 8, 12, 16, 24, 36];
    const results = distances.map((distance) => {
      const input = hslHueToRgb(358 + distance);
      const result = applySelectiveColorToRgbPixel(input, 'reds', adjustment);
      const pixelDelta =
        Math.abs(result.outputRgb.red - input.red) +
        Math.abs(result.outputRgb.green - input.green) +
        Math.abs(result.outputRgb.blue - input.blue);
      return { influence: result.influence, pixelDelta };
    });

    for (const [near, far] of results.slice(0, -1).map((result, index) => [result, results[index + 1]])) {
      expect(near.influence).toBeGreaterThanOrEqual(far.influence);
      expect(near.pixelDelta).toBeGreaterThanOrEqual(far.pixelDelta - 1e-12);
    }
    expect(results[0].influence).toBe(1);
    expect(results.at(-1)?.influence).toBeLessThan(0.002);
  });

  test('zero adjustment is an identity within floating-point precision at every influence', () => {
    for (const hue of [0, 30, 120, 225, 330]) {
      const input = hslHueToRgb(hue);
      const result = applySelectiveColorToRgbPixel(input, 'reds', { hue: 0, luminance: 0, saturation: 0 });
      expect(result.outputRgb.red).toBeCloseTo(input.red, 12);
      expect(result.outputRgb.green).toBeCloseTo(input.green, 12);
      expect(result.outputRgb.blue).toBeCloseTo(input.blue, 12);
    }
  });
});
