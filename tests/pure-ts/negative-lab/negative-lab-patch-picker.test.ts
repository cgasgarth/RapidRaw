import { describe, expect, test } from 'bun:test';

import { buildNegativeLabPickedPatchRect } from '../../../src/utils/negativeLabPatchPicker.ts';

const bounds = { height: 400, left: 100, top: 50, width: 800 };

const expectRectCloseTo = (
  received: ReturnType<typeof buildNegativeLabPickedPatchRect>,
  expected: NonNullable<ReturnType<typeof buildNegativeLabPickedPatchRect>>,
) => {
  expect(received).not.toBeNull();
  expect(received?.height).toBeCloseTo(expected.height);
  expect(received?.width).toBeCloseTo(expected.width);
  expect(received?.x).toBeCloseTo(expected.x);
  expect(received?.y).toBeCloseTo(expected.y);
};

describe('negative lab patch picker', () => {
  test('normalizes forward and reverse drags', () => {
    expectRectCloseTo(buildNegativeLabPickedPatchRect({ x: 180, y: 90 }, { x: 340, y: 210 }, bounds), {
      height: 0.3,
      width: 0.2,
      x: 0.1,
      y: 0.1,
    });
    expectRectCloseTo(buildNegativeLabPickedPatchRect({ x: 340, y: 210 }, { x: 180, y: 90 }, bounds), {
      height: 0.3,
      width: 0.2,
      x: 0.1,
      y: 0.1,
    });
  });

  test('clamps to image bounds and minimum size', () => {
    expectRectCloseTo(buildNegativeLabPickedPatchRect({ x: 0, y: 0 }, { x: 101, y: 51 }, bounds), {
      height: 0.02,
      width: 0.02,
      x: 0,
      y: 0,
    });
    expectRectCloseTo(buildNegativeLabPickedPatchRect({ x: 890, y: 440 }, { x: 1200, y: 700 }, bounds), {
      height: 0.025,
      width: 0.02,
      x: 0.98,
      y: 0.975,
    });
  });

  test('rejects invalid image bounds', () => {
    expect(buildNegativeLabPickedPatchRect({ x: 1, y: 1 }, { x: 2, y: 2 }, { ...bounds, width: 0 })).toBeNull();
    expect(buildNegativeLabPickedPatchRect({ x: Number.NaN, y: 1 }, { x: 2, y: 2 }, bounds)).toBeNull();
  });
});
