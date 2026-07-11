import { describe, expect, test } from 'bun:test';

import {
  buildCropEditSessionSnapshot,
  formatCustomRatioDraft,
  getOrientedOriginalRatio,
  resolveCropPresetRatio,
} from '../../../src/components/panel/right/color/CropPanel.tsx';
import { Orientation } from '../../../src/components/ui/AppProperties.tsx';
import { INITIAL_ADJUSTMENTS } from '../../../src/utils/adjustments.ts';

describe('crop edit session helpers', () => {
  test('snapshots canonical adjustments and overlays without retaining mutable aliases', () => {
    const adjustments = {
      ...structuredClone(INITIAL_ADJUSTMENTS),
      aspectRatio: 5 / 4,
      rotation: 2.5,
    };
    const snapshot = buildCropEditSessionSnapshot(adjustments, 'goldenSpiral', 3);
    adjustments.rotation = 9;
    expect(snapshot).toMatchObject({ overlayMode: 'goldenSpiral', overlayRotation: 3 });
    expect(snapshot.adjustments).toMatchObject({ aspectRatio: 5 / 4, rotation: 2.5 });
  });

  test('formats the idle custom ratio directly from the canonical ratio', () => {
    expect(formatCustomRatioDraft(1.618)).toEqual({ height: '100', width: '161.8' });
    expect(formatCustomRatioDraft(0.8)).toEqual({ height: '100', width: '80' });
    expect(formatCustomRatioDraft(null)).toEqual({ height: '', width: '' });
    expect(formatCustomRatioDraft(0)).toEqual({ height: '', width: '' });
  });

  test('resolves Original atomically for every orientation step', () => {
    expect(getOrientedOriginalRatio(6000, 4000, 0)).toBe(1.5);
    expect(getOrientedOriginalRatio(6000, 4000, 1)).toBeCloseTo(2 / 3);
    expect(getOrientedOriginalRatio(6000, 4000, 2)).toBe(1.5);
    expect(getOrientedOriginalRatio(6000, 4000, 3)).toBeCloseTo(2 / 3);
    expect(getOrientedOriginalRatio(undefined, 4000, 0)).toBeNull();
  });

  test('resolves Free, Original, square, numeric, and reciprocal portrait presets', () => {
    expect(resolveCropPresetRatio(null, Orientation.Horizontal, 1.5)).toBeNull();
    expect(resolveCropPresetRatio(0, Orientation.Horizontal, 1.5)).toBe(1.5);
    expect(resolveCropPresetRatio(1, Orientation.Vertical, 1.5)).toBe(1);
    expect(resolveCropPresetRatio(5 / 4, Orientation.Horizontal, 1.5)).toBe(5 / 4);
    expect(resolveCropPresetRatio(5 / 4, Orientation.Vertical, 1.5)).toBe(4 / 5);
  });
});
