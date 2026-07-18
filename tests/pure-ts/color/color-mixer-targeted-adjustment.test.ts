import { describe, expect, test } from 'bun:test';
import { INITIAL_ADJUSTMENTS } from '../../../src/utils/adjustments';
import {
  applyColorMixerTargetedDelta,
  colorMixerTargetedDeltaFromVerticalDrag,
  resolveColorMixerBandWeights,
  resolveHueFromDisplayRgb,
} from '../../../src/utils/colorMixerTargetedAdjustment';

describe('Color Mixer targeted adjustment', () => {
  test('resolves wrapped hue neighbors with normalized falloff weights', () => {
    const bands = resolveColorMixerBandWeights(1, INITIAL_ADJUSTMENTS);
    expect(bands[0]?.key).toBe('reds');
    expect(bands[0]?.weight).toBeGreaterThan(0.7);
    expect(bands.every((band) => band.weight > 0 && band.weight <= 1)).toBe(true);
  });

  test('applies a bounded weighted delta only to affected HSL rows', () => {
    const before = structuredClone(INITIAL_ADJUSTMENTS);
    const next = applyColorMixerTargetedDelta(
      before,
      'saturation',
      [
        { key: 'reds', weight: 1 },
        { key: 'oranges', weight: 0.5 },
      ],
      40,
    );
    expect(next.hsl.reds.saturation).toBe(40);
    expect(next.hsl.oranges.saturation).toBe(20);
    expect(next.hsl.blues.saturation).toBe(before.hsl.blues.saturation);
    expect(applyColorMixerTargetedDelta(before, 'hue', [{ key: 'reds', weight: 1 }], 500).hsl.reds.hue).toBe(100);
  });

  test('maps vertical movement to a bounded keyboard-equivalent delta', () => {
    expect(colorMixerTargetedDeltaFromVerticalDrag(200, 100)).toBe(50);
    expect(colorMixerTargetedDeltaFromVerticalDrag(100, 400)).toBe(-100);
  });

  test('derives hue from the current display RGB sample, including the red wrap', () => {
    expect(resolveHueFromDisplayRgb([1, 0, 0])).toBe(0);
    expect(resolveHueFromDisplayRgb([1, 1, 0])).toBe(60);
    expect(resolveHueFromDisplayRgb([0, 0, 1])).toBe(240);
  });
});
