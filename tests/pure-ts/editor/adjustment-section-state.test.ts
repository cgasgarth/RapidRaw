import { describe, expect, test } from 'bun:test';
import { DEFAULT_COLLAPSIBLE_SECTIONS_STATE } from '../../../src/store/useUIStore';
import {
  ADJUSTMENT_SECTIONS,
  hasAdjustmentValueChanges,
  INITIAL_ADJUSTMENTS,
  INITIAL_MASK_ADJUSTMENTS,
} from '../../../src/utils/adjustments';

describe('adjustment section state', () => {
  test('treats default section values as clean', () => {
    expect(hasAdjustmentValueChanges(ADJUSTMENT_SECTIONS.basic, INITIAL_ADJUSTMENTS)).toBe(false);
  });

  test('marks a section dirty when one of its values changes', () => {
    expect(
      hasAdjustmentValueChanges(ADJUSTMENT_SECTIONS.basic, {
        ...INITIAL_ADJUSTMENTS,
        exposure: 0.35,
      }),
    ).toBe(true);
  });

  test('supports mask adjustment defaults', () => {
    expect(
      hasAdjustmentValueChanges(
        ADJUSTMENT_SECTIONS.details,
        {
          ...INITIAL_MASK_ADJUSTMENTS,
          clarity: 12,
        },
        INITIAL_MASK_ADJUSTMENTS,
      ),
    ).toBe(true);
  });

  test('keeps color adjustment data compatible after color moves to its own panel', () => {
    expect(ADJUSTMENT_SECTIONS.color).toContain('temperature');
    expect(hasAdjustmentValueChanges(ADJUSTMENT_SECTIONS.color, INITIAL_ADJUSTMENTS)).toBe(false);
  });

  test('defaults generic adjustments to tone sections without opening color', () => {
    expect(DEFAULT_COLLAPSIBLE_SECTIONS_STATE).toEqual({
      basic: true,
      color: false,
      curves: true,
      details: false,
      effects: false,
      transformLens: false,
    });
  });
});
