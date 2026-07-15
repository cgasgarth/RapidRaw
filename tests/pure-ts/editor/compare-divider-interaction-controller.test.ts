import { describe, expect, test } from 'bun:test';
import {
  type CompareDividerCurrentContext,
  type CompareDividerPointerSample,
  compareDividerPointerSampleFromSurface,
  createCompareDividerInteractionController,
  createCompareDividerOverlayDescriptor,
  resolveCompareDividerPointerPosition,
} from '../../../src/components/panel/editor/compareDividerInteractionController';

const context = (overrides: Partial<CompareDividerCurrentContext> = {}): CompareDividerCurrentContext => ({
  active: true,
  geometryEpoch: 4,
  imageRect: { height: 300, offsetX: 25, offsetY: 50, scale: 1, width: 600 },
  imageSessionId: 'image-session:12:a',
  orientation: 'vertical',
  position: 0.5,
  sourceIdentity: '/private/image-a.arw',
  sourceRevision: 'graph:9',
  ...overrides,
});

const pointer = (
  pointerId: number,
  pointerType: CompareDividerPointerSample['pointerType'],
  clientX = 400,
  clientY = 250,
): CompareDividerPointerSample => ({
  clientX,
  clientY,
  imageBounds: { height: 300, left: 100, top: 100, width: 600 },
  pointerId,
  pointerType,
});

describe('compare divider interaction controller', () => {
  test('emits keyed semantic positions for one mouse gesture and rejects another pointer owner', () => {
    const controller = createCompareDividerInteractionController();
    const [begin] = controller.dispatch(context(), { ...pointer(7, 'mouse', 220), type: 'pointerdown' });
    expect(begin).toMatchObject({
      key: {
        geometryEpoch: 4,
        imageSessionId: 'image-session:12:a',
        operationGeneration: 1,
        orientation: 'vertical',
        sourceIdentity: '/private/image-a.arw',
        sourceRevision: 'graph:9',
        toolId: 'compare-divider',
      },
      kind: 'set-position',
      position: 0.2,
    });
    expect(controller.dispatch(context(), { ...pointer(8, 'mouse', 580), type: 'pointermove' })).toEqual([]);
    expect(controller.dispatch(context(), { ...pointer(7, 'mouse', 580), type: 'pointermove' })).toMatchObject([
      { key: begin?.key, kind: 'set-position', position: 0.8 },
    ]);
    controller.dispatch(context(), { ...pointer(7, 'mouse'), type: 'pointerup' });
    expect(controller.isActive()).toBe(false);
  });

  test('supports touch and deterministically stops after lost capture or pointer cancellation', () => {
    for (const cancellation of ['lostpointercapture', 'pointercancel'] as const) {
      const controller = createCompareDividerInteractionController();
      expect(controller.dispatch(context(), { ...pointer(3, 'touch', 160), type: 'pointerdown' })).toMatchObject([
        { kind: 'set-position', position: 0.1 },
      ]);
      expect(controller.isActive()).toBe(true);
      expect(controller.dispatch(context(), { ...pointer(3, 'touch'), type: cancellation })).toEqual([]);
      expect(controller.isActive()).toBe(false);
      expect(controller.dispatch(context(), { ...pointer(3, 'touch', 580), type: 'pointermove' })).toEqual([]);
    }
  });

  test('invalidates active input on every source/session/revision/geometry successor, including A to B to A', () => {
    const successors = [
      context({ imageSessionId: 'image-session:13:b', sourceIdentity: '/private/image-b.arw' }),
      context({ imageSessionId: 'image-session:14:a' }),
      context({ sourceIdentity: '/private/image-c.arw' }),
      context({ sourceRevision: 'graph:10' }),
      context({ geometryEpoch: 5 }),
      context({ orientation: 'horizontal' }),
      context({ active: false }),
    ];
    for (const successor of successors) {
      const controller = createCompareDividerInteractionController();
      controller.dispatch(context(), { ...pointer(1, 'pen'), type: 'pointerdown' });
      expect(controller.dispatch(successor, { ...pointer(1, 'pen', 580), type: 'pointermove' })).toEqual([]);
      expect(controller.isActive()).toBe(false);
    }
  });

  test('maps horizontal and vertical bounds, clamps endpoints, and rejects empty geometry', () => {
    expect(resolveCompareDividerPointerPosition('vertical', pointer(1, 'mouse', 700))).toBe(0.95);
    expect(resolveCompareDividerPointerPosition('horizontal', pointer(1, 'mouse', 0, 175))).toBe(0.25);
    expect(
      resolveCompareDividerPointerPosition('vertical', {
        ...pointer(1, 'mouse'),
        imageBounds: { height: 300, left: 100, top: 100, width: 0 },
      }),
    ).toBeNull();
  });

  test('emits keyboard and reset commands without placing interaction policy in the overlay', () => {
    const controller = createCompareDividerInteractionController();
    expect(controller.dispatch(context(), { key: 'ArrowRight', shiftKey: false, type: 'keydown' })).toMatchObject([
      { kind: 'set-position', position: 0.51 },
    ]);
    expect(controller.dispatch(context(), { key: 'ArrowLeft', shiftKey: true, type: 'keydown' })).toMatchObject([
      { kind: 'set-position', position: 0.4 },
    ]);
    expect(controller.dispatch(context(), { key: 'Home', shiftKey: false, type: 'keydown' })).toMatchObject([
      { kind: 'set-position', position: 0.05 },
    ]);
    expect(controller.dispatch(context(), { key: 'End', shiftKey: false, type: 'keydown' })).toMatchObject([
      { kind: 'set-position', position: 0.95 },
    ]);
    expect(controller.dispatch(context(), { key: 'PageDown', shiftKey: false, type: 'keydown' })).toEqual([]);
    expect(controller.dispatch(context(), { type: 'reset' })).toMatchObject([{ kind: 'reset' }]);
  });

  test('publishes a declarative overlay from the same geometry and session identity as commands', () => {
    expect(createCompareDividerOverlayDescriptor(context({ position: 0.25 }))).toEqual({
      accessibility: { maximumPercent: 95, minimumPercent: 5, orientation: 'vertical', valuePercent: 25 },
      geometry: { clipPath: 'inset(0 75% 0 0)', height: 300, left: 175, top: 50, width: 1 },
      geometryEpoch: 4,
      id: 'compare-divider',
      pointerPolicy: 'capture',
      sessionFingerprint: '["image-session:12:a","/private/image-a.arw","graph:9",4,"vertical",true,"compare-divider"]',
      zOrder: 'viewer-hud',
    });
  });

  test('maps canonical surface coordinates through layout scaling into the descriptor image geometry', () => {
    const current = context({ imageRect: { height: 300, offsetX: 25, offsetY: 50, scale: 1, width: 600 } });
    const sample = compareDividerPointerSampleFromSurface(
      {
        altKey: false,
        button: 0,
        clientX: 450,
        clientY: 300,
        ctrlKey: false,
        metaKey: false,
        pointerId: 17,
        pointerType: 'pen',
        pressure: 0.7,
        shiftKey: false,
        surfaceRect: { height: 800, layoutHeight: 400, layoutWidth: 800, width: 1600, x: 0, y: 0 },
        type: 'pointerdown',
      },
      current.imageRect,
    );
    expect(sample).toEqual({
      clientX: 450,
      clientY: 300,
      imageBounds: { height: 600, left: 50, top: 100, width: 1200 },
      pointerId: 17,
      pointerType: 'pen',
    });
    expect(sample === null ? null : resolveCompareDividerPointerPosition('vertical', sample)).toBeCloseTo(1 / 3, 8);
    expect(createCompareDividerOverlayDescriptor(current).geometry.left).toBe(325);
  });

  test('blur and Escape tear down the exact active gesture idempotently', () => {
    for (const type of ['blur', 'escape'] as const) {
      const controller = createCompareDividerInteractionController();
      controller.dispatch(context(), { ...pointer(2, 'touch'), type: 'pointerdown' });
      expect(controller.isActive()).toBeTrue();
      expect(controller.dispatch(context(), { type })).toEqual([]);
      expect(controller.isActive()).toBeFalse();
      expect(controller.dispatch(context(), { ...pointer(2, 'touch'), type: 'pointermove' })).toEqual([]);
    }
  });
});
