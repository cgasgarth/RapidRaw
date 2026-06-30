import { describe, expect, test } from 'bun:test';
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
});
