import { describe, expect, test } from 'bun:test';
import { getImageTransformBounds } from '../../../src/utils/editorViewportBounds';

describe('editor viewport bounds', () => {
  test('keeps a fit-to-window portrait image centered in its rendered image rect', () => {
    const bounds = getImageTransformBounds({
      containerWidth: 1000,
      containerHeight: 700,
      renderSize: {
        width: 420,
        height: 700,
        offsetX: 290,
        offsetY: 0,
        scale: 0.175,
      },
      scale: 1,
    });

    expect(bounds).toEqual({ minX: 0, maxX: 0, minY: 0, maxY: 0 });
  });

  test('centers a zoomed image on the short axis and clamps panning on the long axis', () => {
    const bounds = getImageTransformBounds({
      containerWidth: 1000,
      containerHeight: 700,
      renderSize: {
        width: 420,
        height: 700,
        offsetX: 290,
        offsetY: 0,
        scale: 0.175,
      },
      scale: 2,
    });

    expect(bounds.minX).toBe(-500);
    expect(bounds.maxX).toBe(-500);
    expect(bounds.minY).toBe(-700);
    expect(bounds.maxY).toBeCloseTo(0);
  });
});
