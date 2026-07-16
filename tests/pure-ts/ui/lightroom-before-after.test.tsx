import { describe, expect, test } from 'bun:test';
import {
  cycleEditorCompareMode,
  DEFAULT_EDITOR_COMPARE_STATE,
  reduceEditorCompare,
  resolveComparePaneLayout,
  resolveEditorComparePresentation,
} from '../../../src/utils/editorCompare';

describe('Lightroom Before/After compare authority', () => {
  test('cycles Loupe, left/right and top/bottom-capable compare modes without changing the edit target', () => {
    expect(cycleEditorCompareMode('off')).toBe('side-by-side');
    expect(cycleEditorCompareMode('side-by-side')).toBe('split-wipe');
    expect(cycleEditorCompareMode('split-wipe')).toBe('off');
    expect(cycleEditorCompareMode('off', -1)).toBe('split-wipe');

    const state = reduceEditorCompare(DEFAULT_EDITOR_COMPARE_STATE, { mode: 'side-by-side', type: 'set-mode' });
    const horizontal = reduceEditorCompare(state, { orientation: 'horizontal', type: 'set-orientation' });
    expect(resolveEditorComparePresentation(horizontal)).toMatchObject({
      active: true,
      axis: 'horizontal',
      isSideBySide: true,
      paneOrder: ['original', 'edited'],
    });
    expect(horizontal.source).toEqual(DEFAULT_EDITOR_COMPARE_STATE.source);
  });

  test('keeps matched semantic scale and divider geometry across both supported arrangements', () => {
    for (const orientation of ['vertical', 'horizontal'] as const) {
      const layout = resolveComparePaneLayout({
        imageDimensions: { height: 4000, width: 6000 },
        mode: 'side-by-side',
        orientation,
        viewport: { height: 1200, width: 1800 },
      });
      expect(layout.original.scale).toBe(layout.edited.scale);
      expect(layout.original.width).toBe(layout.edited.width);
      expect(layout.original.height).toBe(layout.edited.height);
      if (orientation === 'vertical') expect(layout.original.offsetX).toBeLessThan(layout.edited.offsetX);
      else expect(layout.original.offsetY).toBeLessThan(layout.edited.offsetY);
    }
  });

  test('hold and exit are atomic presentation transitions', () => {
    const held = reduceEditorCompare(DEFAULT_EDITOR_COMPARE_STATE, { held: true, type: 'set-original-held' });
    expect(resolveEditorComparePresentation(held)).toMatchObject({ active: true, isHoldOriginal: true });
    const exited = reduceEditorCompare(held, { type: 'exit' });
    expect(exited).toMatchObject({ mode: 'off', isOriginalHeld: false });
    expect(exited.source).toEqual(held.source);
  });
});
