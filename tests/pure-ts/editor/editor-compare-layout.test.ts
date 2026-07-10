import { describe, expect, test } from 'bun:test';
import {
  DEFAULT_EDITOR_COMPARE_STATE,
  reduceEditorCompare,
  resolveCompareDividerGeometry,
  resolveComparePaneLayout,
} from '../../../src/utils/editorCompare';

describe('editor compare image-space layout', () => {
  test.each([
    ['vertical', 1600, 900],
    ['horizontal', 900, 1600],
  ] as const)('fits matched %s panes at one semantic scale', (orientation, width, height) => {
    const layout = resolveComparePaneLayout({
      imageDimensions: { height: 4000, width: 6000 },
      mode: 'side-by-side',
      orientation,
      viewport: { height, width },
    });
    expect(layout.original.scale).toBe(layout.edited.scale);
    expect(layout.original.width).toBe(layout.edited.width);
    expect(layout.original.height).toBe(layout.edited.height);
    if (orientation === 'vertical') expect(layout.original.offsetX).toBeLessThan(layout.edited.offsetX);
    else expect(layout.original.offsetY).toBeLessThan(layout.edited.offsetY);
  });

  test('keeps wipe reveal normalized through resize, crop/orientation dimensions, and DPR-independent CSS geometry', () => {
    const before = resolveCompareDividerGeometry({
      dividerPosition: 0.37,
      imageRect: { height: 600, offsetX: 100, offsetY: 50, scale: 0.2, width: 900 },
      orientation: 'vertical',
    });
    const after = resolveCompareDividerGeometry({
      dividerPosition: 0.37,
      imageRect: { height: 1200, offsetX: 40, offsetY: 80, scale: 0.4, width: 1800 },
      orientation: 'vertical',
    });
    expect(before.clipPath).toBe(after.clipPath);
    expect((before.left - 100) / 900).toBeCloseTo(0.37);
    expect((after.left - 40) / 1800).toBeCloseTo(0.37);

    const rotatedCrop = resolveComparePaneLayout({
      imageDimensions: { height: 1800, width: 1200 },
      mode: 'side-by-side',
      orientation: 'horizontal',
      viewport: { height: 900, width: 1200 },
    });
    expect(rotatedCrop.original.scale).toBe(rotatedCrop.edited.scale);
  });

  test('clamps keyboard/drag commands and resets the divider deterministically', () => {
    const low = reduceEditorCompare(DEFAULT_EDITOR_COMPARE_STATE, { position: -10, type: 'set-divider' });
    const high = reduceEditorCompare(low, { position: 10, type: 'set-divider' });
    const reset = reduceEditorCompare(high, { type: 'reset-divider' });
    expect(low.dividerPosition).toBe(0.05);
    expect(high.dividerPosition).toBe(0.95);
    expect(reset.dividerPosition).toBe(0.5);
  });
});
