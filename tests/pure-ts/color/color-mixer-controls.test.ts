import { describe, expect, test } from 'bun:test';

import {
  enableBlackWhiteMixer,
  formatRgbSummary,
  getHueBandSegments,
  getNextAdvancedMixerSelection,
  getNextSelectiveColorRange,
  isBlackWhiteMixerModified,
  isChannelMixerModified,
  isColorBalanceRgbModified,
  resetChannelMixerOutput,
  resetColorBalanceRange,
} from '../../../src/components/adjustments/color/ColorMixerControls';
import { INITIAL_ADJUSTMENTS } from '../../../src/utils/adjustments';

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

describe('Advanced mixer view models', () => {
  test('seeds only the selected B&W channel when enabling an all-zero mixer', () => {
    const enabled = enableBlackWhiteMixer(structuredClone(INITIAL_ADJUSTMENTS.blackWhiteMixer), 'oranges');

    expect(enabled.enabled).toBe(true);
    expect(enabled.weights.oranges).toBe(20);
    expect(Object.entries(enabled.weights).filter(([, value]) => value !== 0)).toEqual([['oranges', 20]]);
  });

  test('preserves stored B&W weights when enabling', () => {
    const settings = structuredClone(INITIAL_ADJUSTMENTS.blackWhiteMixer);
    settings.weights.blues = -24;

    expect(enableBlackWhiteMixer(settings, 'reds').weights).toEqual(settings.weights);
  });

  test('detects enabled, preserve-luminance, and value edits independently', () => {
    expect(isBlackWhiteMixerModified(INITIAL_ADJUSTMENTS.blackWhiteMixer)).toBe(false);
    expect(isColorBalanceRgbModified(INITIAL_ADJUSTMENTS.colorBalanceRgb)).toBe(false);
    expect(isChannelMixerModified(INITIAL_ADJUSTMENTS.channelMixer)).toBe(false);

    expect(isBlackWhiteMixerModified({ ...INITIAL_ADJUSTMENTS.blackWhiteMixer, enabled: true })).toBe(true);
    expect(isColorBalanceRgbModified({ ...INITIAL_ADJUSTMENTS.colorBalanceRgb, preserveLuminance: false })).toBe(true);
    expect(
      isChannelMixerModified({
        ...INITIAL_ADJUSTMENTS.channelMixer,
        green: { ...INITIAL_ADJUSTMENTS.channelMixer.green, constant: 4 },
      }),
    ).toBe(true);
  });

  test('resets only the selected RGB range or channel output', () => {
    const balance = structuredClone(INITIAL_ADJUSTMENTS.colorBalanceRgb);
    balance.shadows.red = 12;
    balance.highlights.blue = -8;
    const resetBalance = resetColorBalanceRange(balance, 'shadows');
    expect(resetBalance.shadows).toEqual(INITIAL_ADJUSTMENTS.colorBalanceRgb.shadows);
    expect(resetBalance.highlights.blue).toBe(-8);

    const mixer = structuredClone(INITIAL_ADJUSTMENTS.channelMixer);
    mixer.red.green = 25;
    mixer.blue.constant = -5;
    const resetMixer = resetChannelMixerOutput(mixer, 'red');
    expect(resetMixer.red).toEqual(INITIAL_ADJUSTMENTS.channelMixer.red);
    expect(resetMixer.blue.constant).toBe(-5);
  });

  test('formats compact signed RGB summaries', () => {
    expect(formatRgbSummary({ blue: 0, green: -3, red: 8 })).toBe('R +8 / G -3 / B 0');
  });

  test('navigates advanced selectors without mutating adjustment values', () => {
    const ranges = ['shadows', 'midtones', 'highlights'];
    expect(getNextAdvancedMixerSelection(ranges, 'midtones', 'ArrowRight')).toBe('highlights');
    expect(getNextAdvancedMixerSelection(ranges, 'shadows', 'ArrowLeft')).toBe('highlights');
    expect(getNextAdvancedMixerSelection(ranges, 'highlights', 'Home')).toBe('shadows');
    expect(getNextAdvancedMixerSelection(ranges, 'shadows', 'End')).toBe('highlights');
    expect(getNextAdvancedMixerSelection(ranges, 'midtones', 'Enter')).toBe('midtones');
  });
});
