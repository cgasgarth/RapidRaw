import { describe, expect, test } from 'bun:test';
import { getImageTransformBounds, reconcileViewportTransform } from '../../../src/utils/editorViewportBounds';

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

  test('keeps fit zoom at identity when a portrait panel resizes', () => {
    const transform = reconcileViewportTransform({
      contextChanged: false,
      previous: {
        containerWidth: 1000,
        containerHeight: 700,
        renderSize: {
          width: 420,
          height: 700,
          offsetX: 290,
          offsetY: 0,
          scale: 0.175,
        },
      },
      current: {
        containerWidth: 820,
        containerHeight: 700,
        renderSize: {
          width: 420,
          height: 700,
          offsetX: 200,
          offsetY: 0,
          scale: 0.175,
        },
      },
      transform: { scale: 1, positionX: 0, positionY: 0 },
    });

    expect(transform).toEqual({ scale: 1, positionX: 0, positionY: 0 });
  });

  test('preserves the same image center while zoomed during panel resize', () => {
    const transform = reconcileViewportTransform({
      contextChanged: false,
      previous: {
        containerWidth: 1000,
        containerHeight: 700,
        renderSize: {
          width: 1000,
          height: 562.5,
          offsetX: 0,
          offsetY: 68.75,
          scale: 0.1666666667,
        },
      },
      current: {
        containerWidth: 760,
        containerHeight: 700,
        renderSize: {
          width: 760,
          height: 427.5,
          offsetX: 0,
          offsetY: 136.25,
          scale: 0.1266666667,
        },
      },
      transform: { scale: 2, positionX: -400, positionY: -200 },
    });

    expect(transform.scale).toBe(2);
    expect(transform.positionX).toBeCloseTo(-304);
    expect(transform.positionY).toBeCloseTo(-272.5);
  });

  test('resets manual zoom and pan when image context changes', () => {
    const transform = reconcileViewportTransform({
      contextChanged: true,
      previous: {
        containerWidth: 1000,
        containerHeight: 700,
        renderSize: {
          width: 1000,
          height: 562.5,
          offsetX: 0,
          offsetY: 68.75,
          scale: 0.1666666667,
        },
      },
      current: {
        containerWidth: 700,
        containerHeight: 1000,
        renderSize: {
          width: 666.6666667,
          height: 1000,
          offsetX: 16.6666667,
          offsetY: 0,
          scale: 0.1666666667,
        },
      },
      transform: { scale: 2.5, positionX: -300, positionY: -120 },
    });

    expect(transform).toEqual({ scale: 1, positionX: 0, positionY: 0 });
  });
});
