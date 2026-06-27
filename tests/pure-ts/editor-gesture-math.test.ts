import { expect, test } from 'bun:test';

import {
  applyPointerOverscrollResistance,
  applyWheelPanResistance,
  getRecentPanVelocity,
  getWheelPanDelta,
  getWheelZoomExponent,
  getWheelZoomMultiplier,
  isWheelZoomIntent,
  PAN_VELOCITY_RECENCY_MS,
  POINTER_OVERSCROLL_RESISTANCE,
  TRACKPAD_ZOOM_SPEED_FACTOR,
  WHEEL_PAN_RESISTANCE,
  WHEEL_ZOOM_SENSITIVITY,
} from '../../src/utils/editorGestureMath.ts';

test('wheel zoom intent keeps trackpad wheel events as pan unless pinching', () => {
  expect(isWheelZoomIntent({ altKey: false, ctrlKey: false, deltaX: 0, deltaY: 4, shiftKey: false }, false)).toBe(true);
  expect(isWheelZoomIntent({ altKey: false, ctrlKey: false, deltaX: 0, deltaY: 4, shiftKey: false }, true)).toBe(false);
  expect(isWheelZoomIntent({ altKey: false, ctrlKey: true, deltaX: 0, deltaY: 4, shiftKey: false }, true)).toBe(true);
});

test('wheel zoom multiplier and exponent preserve existing sensitivity', () => {
  expect(getWheelZoomMultiplier(false, 1.25)).toBe(1.25);
  expect(getWheelZoomMultiplier(true, 1.25)).toBe(1.25 * TRACKPAD_ZOOM_SPEED_FACTOR);
  expect(getWheelZoomExponent({ altKey: false, ctrlKey: false, deltaX: 0, deltaY: 10, shiftKey: false }, 2)).toBe(
    10 * WHEEL_ZOOM_SENSITIVITY * 2,
  );
});

test('wheel pan delta maps modifier keys for non-trackpad input', () => {
  const base = { ctrlKey: false, deltaX: 3, deltaY: 8 };

  expect(getWheelPanDelta({ ...base, altKey: false, shiftKey: false }, false)).toEqual({ dx: 3, dy: 8 });
  expect(getWheelPanDelta({ ...base, altKey: false, shiftKey: true }, false)).toEqual({ dx: 8, dy: 0 });
  expect(getWheelPanDelta({ ...base, altKey: true, shiftKey: false }, false)).toEqual({ dx: 0, dy: 8 });
  expect(getWheelPanDelta({ ...base, altKey: true, shiftKey: true }, false)).toEqual({ dx: 8, dy: 8 });
  expect(getWheelPanDelta({ ...base, altKey: true, shiftKey: true }, true)).toEqual({ dx: 3, dy: 8 });
});

test('pan resistance only softens overscroll past bounds', () => {
  const bounds = { maxX: 100, maxY: 80, minX: -100, minY: -80 };

  expect(applyWheelPanResistance(120, -100, bounds)).toEqual({
    x: 100 + 20 * WHEEL_PAN_RESISTANCE,
    y: -80 + -20 * WHEEL_PAN_RESISTANCE,
  });

  expect(applyPointerOverscrollResistance(-10, 12, { x: -120, y: 120 }, bounds)).toEqual({
    dx: -10 * POINTER_OVERSCROLL_RESISTANCE,
    dy: 12 * POINTER_OVERSCROLL_RESISTANCE,
  });
});

test('recent pan velocity ignores stale or invalid samples', () => {
  expect(
    getRecentPanVelocity(
      [
        { t: 100, x: 0, y: 0 },
        { t: 140, x: 20, y: -10 },
      ],
      140 + PAN_VELOCITY_RECENCY_MS - 1,
    ),
  ).toEqual({ vx: 0.5, vy: -0.25 });

  expect(
    getRecentPanVelocity(
      [
        { t: 100, x: 0, y: 0 },
        { t: 140, x: 20, y: -10 },
      ],
      140 + PAN_VELOCITY_RECENCY_MS,
    ),
  ).toEqual({ vx: 0, vy: 0 });

  expect(getRecentPanVelocity([{ t: 100, x: 0, y: 0 }], 100)).toEqual({ vx: 0, vy: 0 });
});
