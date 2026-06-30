import { expect, test } from 'bun:test';

import { getSliderEventNumber } from '../../../src/components/adjustments/adjustmentSliderValue.ts';

test('getSliderEventNumber accepts string and numeric slider event values', () => {
  expect(getSliderEventNumber({ target: { value: '12.5' } })).toBe(12.5);
  expect(getSliderEventNumber({ target: { value: -3 } })).toBe(-3);
});
