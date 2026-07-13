import { describe, expect, test } from 'bun:test';
import {
  getImageSpacePointAtViewportPoint,
  getImageTransformBounds,
  getImageViewportRect,
  reconcileViewportTransform,
} from '../../../src/utils/editorViewportBounds';
import { resolveEditorZoom } from '../../../src/utils/editorZoom';

describe('editor viewport bounds', () => {
  test('resolves Fit, 50%, 100%, and 200% into authoritative rendered frame geometry', () => {
    const renderSize = { width: 1200, height: 800, offsetX: 0, offsetY: 0, scale: 0.2 };
    const resolveScale = (devicePixelsPerImagePixel: number) =>
      resolveEditorZoom({
        devicePixelRatio: 2,
        mode: { devicePixelsPerImagePixel, kind: 'ratio' },
        renderSize,
        sourceSize: { width: 6000, height: 4000 },
        viewportSize: { width: 1200, height: 800 },
      }).transformScale;

    expect(getImageViewportRect(renderSize, { scale: 1, positionX: 0, positionY: 0 })).toEqual({
      height: 800,
      width: 1200,
      x: 0,
      y: 0,
    });
    expect(getImageViewportRect(renderSize, { scale: resolveScale(0.5), positionX: -150, positionY: -100 })).toEqual({
      height: 1000,
      width: 1500,
      x: -150,
      y: -100,
    });
    expect(getImageViewportRect(renderSize, { scale: resolveScale(1), positionX: -900, positionY: -600 })).toEqual({
      height: 2000,
      width: 3000,
      x: -900,
      y: -600,
    });
    const twoHundredPercent = getImageViewportRect(renderSize, {
      scale: resolveScale(2),
      positionX: -2400,
      positionY: -1600,
    });
    expect(twoHundredPercent).toEqual({ height: 4000, width: 6000, x: -2400, y: -1600 });
    expect(twoHundredPercent.width).toBeGreaterThan(1200);
    expect(twoHundredPercent.height).toBeGreaterThan(800);
  });

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

  test('preserves an explicit pointer image anchor while ratio zoom rescales with the viewport', () => {
    const previous = {
      containerWidth: 1000,
      containerHeight: 700,
      renderSize: {
        width: 1000,
        height: 562.5,
        offsetX: 0,
        offsetY: 68.75,
        scale: 0.1666666667,
      },
    };
    const current = {
      containerWidth: 760,
      containerHeight: 700,
      renderSize: {
        width: 760,
        height: 427.5,
        offsetX: 0,
        offsetY: 136.25,
        scale: 0.1266666667,
      },
    };
    const transform = { scale: 2, positionX: -400, positionY: -200 };
    const previousPointer = { x: 240, y: 210 };
    const focalPoint = getImageSpacePointAtViewportPoint({
      snapshot: previous,
      transform,
      viewportPoint: previousPointer,
    });
    const next = reconcileViewportTransform({
      contextChanged: false,
      current,
      focalPoint,
      mode: { devicePixelsPerImagePixel: 1, kind: 'ratio' },
      previous,
      targetScale: 3,
      transform,
      viewportAnchor: { x: 240, y: 210 },
    });
    const nextPointer = getImageSpacePointAtViewportPoint({
      snapshot: current,
      transform: next,
      viewportPoint: { x: 240, y: 210 },
    });

    expect(next.scale).toBe(3);
    expect(nextPointer.x).toBeCloseTo(focalPoint.x);
    expect(nextPointer.y).toBeCloseTo(focalPoint.y);
  });

  test('recomputes Fit instead of carrying a stale focal point or pan', () => {
    const transform = reconcileViewportTransform({
      contextChanged: false,
      current: {
        containerWidth: 800,
        containerHeight: 600,
        renderSize: { width: 800, height: 450, offsetX: 0, offsetY: 75, scale: 0.2 },
      },
      focalPoint: { x: 0.13, y: 0.87 },
      mode: { kind: 'fit' },
      previous: {
        containerWidth: 1000,
        containerHeight: 600,
        renderSize: { width: 1000, height: 562.5, offsetX: 0, offsetY: 18.75, scale: 0.25 },
      },
      targetScale: 2,
      transform: { scale: 2, positionX: -700, positionY: -250 },
      viewportAnchor: { x: 100, y: 500 },
    });

    expect(transform).toEqual({ scale: 1, positionX: 0, positionY: 0 });
  });

  test('uses the Navigator-selected image point when its viewport anchor is the center', () => {
    const current = {
      containerWidth: 900,
      containerHeight: 600,
      renderSize: { width: 900, height: 600, offsetX: 0, offsetY: 0, scale: 0.3 },
    };
    const transform = reconcileViewportTransform({
      contextChanged: false,
      current,
      focalPoint: { x: 0.6, y: 0.4 },
      mode: { kind: 'fill' },
      previous: current,
      targetScale: 1.5,
      transform: { scale: 1.25, positionX: -100, positionY: -50 },
      viewportAnchor: { x: 450, y: 300 },
    });
    const pointAtCenter = getImageSpacePointAtViewportPoint({
      snapshot: current,
      transform,
      viewportPoint: { x: 450, y: 300 },
    });

    expect(pointAtCenter.x).toBeCloseTo(0.6);
    expect(pointAtCenter.y).toBeCloseTo(0.4);
  });

  test('resets a ratio transform to the new centered geometry on source generation changes', () => {
    const current = {
      containerWidth: 800,
      containerHeight: 600,
      renderSize: { width: 800, height: 600, offsetX: 0, offsetY: 0, scale: 0.2 },
    };
    const transform = reconcileViewportTransform({
      contextChanged: true,
      current,
      mode: { devicePixelsPerImagePixel: 2, kind: 'ratio' },
      previous: {
        containerWidth: 1000,
        containerHeight: 700,
        renderSize: { width: 1000, height: 700, offsetX: 0, offsetY: 0, scale: 0.25 },
      },
      targetScale: 2,
      transform: { scale: 4, positionX: -1600, positionY: -800 },
    });

    expect(transform.scale).toBe(2);
    expect(
      getImageSpacePointAtViewportPoint({
        snapshot: current,
        transform,
        viewportPoint: { x: 400, y: 300 },
      }),
    ).toEqual({ x: 0.5, y: 0.5 });
  });
});
