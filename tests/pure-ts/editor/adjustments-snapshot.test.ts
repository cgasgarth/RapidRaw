import { describe, expect, test } from 'bun:test';
import { INITIAL_ADJUSTMENTS } from '../../../src/utils/adjustments';
import { areAdjustmentsEqual } from '../../../src/utils/adjustmentsSnapshot';

describe('adjustment snapshots', () => {
  test('treats identical adjustment payloads as unchanged', () => {
    expect(areAdjustmentsEqual(INITIAL_ADJUSTMENTS, structuredClone(INITIAL_ADJUSTMENTS))).toBe(true);
  });

  test('treats an edit as changed', () => {
    expect(
      areAdjustmentsEqual(INITIAL_ADJUSTMENTS, {
        ...INITIAL_ADJUSTMENTS,
        exposure: INITIAL_ADJUSTMENTS.exposure + 0.25,
      }),
    ).toBe(false);
  });
});
