import { describe, expect, test } from 'bun:test';

import {
  getHueBandSegments,
  getNextSelectiveColorRange,
} from '../../../src/components/adjustments/color/ColorMixerControls';

describe('Color Mixer range model', () => {
  test('splits a red range across the hue wraparound boundary', () => {
    expect(getHueBandSegments(358, 35)).toEqual([
      { leftPercent: 0, widthPercent: 4.305555555555555 },
      { leftPercent: 94.58333333333333, widthPercent: 5.416666666666667 },
    ]);
  });

  test('keeps an ordinary range in one bounded segment', () => {
    expect(getHueBandSegments(60, 40)).toEqual([{ leftPercent: 11.11111111111111, widthPercent: 11.11111111111111 }]);
  });

  test('normalizes centers and bounds malformed widths', () => {
    expect(getHueBandSegments(-10, -5)).toEqual([{ leftPercent: 97.22222222222221, widthPercent: 0 }]);
    expect(getHueBandSegments(720, 360)).toEqual([{ leftPercent: 0, widthPercent: 100 }]);
  });

  test('navigates all channels with arrows and boundary keys', () => {
    expect(getNextSelectiveColorRange('reds', 'ArrowLeft')).toBe('magentas');
    expect(getNextSelectiveColorRange('reds', 'ArrowRight')).toBe('oranges');
    expect(getNextSelectiveColorRange('greens', 'Home')).toBe('reds');
    expect(getNextSelectiveColorRange('greens', 'End')).toBe('magentas');
    expect(getNextSelectiveColorRange('greens', 'Enter')).toBe('greens');
    expect(getNextSelectiveColorRange('magentas', 'ArrowRight')).toBe('reds');
  });
});
