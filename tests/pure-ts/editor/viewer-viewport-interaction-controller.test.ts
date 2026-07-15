import { describe, expect, test } from 'bun:test';
import {
  createViewerViewportInteractionController,
  isViewerViewportSessionCurrent,
  type ViewerViewportCurrentContext,
  type ViewerViewportInputEvent,
} from '../../../src/components/panel/editor/viewerViewportInteractionController';

const bounds = { maxX: 100, maxY: 80, minX: -100, minY: -80 };

const context = (overrides: Partial<ViewerViewportCurrentContext> = {}): ViewerViewportCurrentContext => ({
  activeTool: 'none',
  geometryEpoch: 1,
  getBounds: () => bounds,
  imageSessionId: 'session-a',
  inputMode: 'mouse',
  maxScale: 4,
  minScale: 0.25,
  sourceIdentity: 'a.raw',
  sourceRevision: 'graph-1',
  surface: { height: 600, left: 100, top: 50, width: 800 },
  transform: { positionX: 0, positionY: 0, scale: 1 },
  zoomSpeedMultiplier: 1,
  ...overrides,
});

const pointer = (
  type: 'pointerdown' | 'pointermove' | 'pointerup',
  overrides: Partial<Extract<ViewerViewportInputEvent, { type: typeof type }>> = {},
): Extract<ViewerViewportInputEvent, { type: typeof type }> =>
  ({
    button: 0,
    clientX: 500,
    clientY: 350,
    pointerId: 1,
    pointerType: 'mouse',
    time: 100,
    type,
    ...overrides,
  }) as Extract<ViewerViewportInputEvent, { type: typeof type }>;

describe('viewer viewport interaction controller', () => {
  test('wheel zoom keeps the pointer anchor, clamps scale, and publishes semantic zoom', () => {
    const controller = createViewerViewportInteractionController();
    const result = controller.dispatch(context({ maxScale: 1.5 }), {
      altKey: false,
      clientX: 700,
      clientY: 450,
      ctrlKey: false,
      deltaX: 0,
      deltaY: -1000,
      shiftKey: false,
      type: 'wheel',
    });

    expect(result.transform).toEqual({ positionX: -100, positionY: -80, scale: 1.5 });
    expect(result.focalPoint).toEqual({ source: 'pointer', x: 600, y: 400 });
    expect(result.semanticZoomScale).toBe(1.5);
    expect(result.sessionKey?.toolId).toBe('viewer-viewport');
    expect(result.cancelMotion).toBe(true);
  });

  test('trackpad wheel pans with resistance and never changes semantic zoom', () => {
    const controller = createViewerViewportInteractionController();
    const result = controller.dispatch(
      context({ inputMode: 'trackpad', transform: { positionX: 95, positionY: 75, scale: 2 } }),
      {
        altKey: false,
        clientX: 500,
        clientY: 350,
        ctrlKey: false,
        deltaX: -30,
        deltaY: -20,
        shiftKey: false,
        type: 'wheel',
      },
    );

    expect(result.transform).toEqual({ positionX: 112.5, positionY: 87.5, scale: 2 });
    expect(result.semanticZoomScale).toBeNull();
    expect(result.wheelSnap).toBe(true);
  });

  test('two touch pointers own a keyed pinch and clamp the anchored transform', () => {
    const controller = createViewerViewportInteractionController();
    const initial = context();
    controller.dispatch(initial, pointer('pointerdown', { clientX: 400, pointerId: 1, pointerType: 'touch' }));
    const second = controller.dispatch(
      initial,
      pointer('pointerdown', { clientX: 600, pointerId: 2, pointerType: 'touch' }),
    );
    expect(second.state.activePointerCount).toBe(2);
    expect(second.sessionKey?.operationGeneration).toBe(1);

    const moved = controller.dispatch(
      initial,
      pointer('pointermove', { clientX: 700, pointerId: 2, pointerType: 'touch', time: 120 }),
    );
    expect(moved.transform).toEqual({ positionX: -100, positionY: -80, scale: 1.5 });
    expect(moved.semanticZoomScale).toBe(1.5);
    expect(moved.state.isDragging).toBe(true);
  });

  test('temporary hand owns mouse pan and blur, Escape, capture loss, and unmount cleanly cancel', () => {
    for (const cancellation of ['blur', 'escape', 'unmount'] as const) {
      const controller = createViewerViewportInteractionController();
      controller.dispatch(context({ activeTool: 'crop' }), { active: true, type: 'temporary-hand' });
      const down = controller.dispatch(context({ activeTool: 'crop' }), pointer('pointerdown'));
      expect(down.capturePointerId).toBe(1);
      const moved = controller.dispatch(
        context({ activeTool: 'crop' }),
        pointer('pointermove', { clientX: 520, clientY: 370, time: 120 }),
      );
      expect(moved.transform).toEqual({ positionX: 20, positionY: 20, scale: 1 });
      const cancelled = controller.dispatch(context({ activeTool: 'crop' }), {
        reason: cancellation,
        type: 'cancel',
      });
      expect(cancelled.state).toEqual({
        activePointerCount: 0,
        isDragging: false,
        isMiddleMousePanning: false,
        isPanning: false,
        temporaryHand: false,
      });
    }

    const controller = createViewerViewportInteractionController();
    controller.dispatch(context(), pointer('pointerdown'));
    const lost = controller.dispatch(context(), { pointerId: 1, type: 'lostpointercapture' });
    expect(lost.cancelMotion).toBe(true);
    expect(lost.state.activePointerCount).toBe(0);
  });

  test('image A to B to A and geometry replacement invalidate old sessions', () => {
    const controller = createViewerViewportInteractionController();
    const first = controller.dispatch(context(), pointer('pointerdown'));
    const firstKey = first.sessionKey;
    expect(firstKey).not.toBeNull();

    const imageB = context({ imageSessionId: 'session-b', sourceIdentity: 'b.raw' });
    const invalidated = controller.synchronize(imageB);
    expect(invalidated.cancelMotion).toBe(true);
    expect(invalidated.state.activePointerCount).toBe(0);
    expect(firstKey && isViewerViewportSessionCurrent(firstKey, imageB)).toBe(false);

    const second = controller.dispatch(context(), pointer('pointerdown', { pointerId: 2 }));
    expect(second.sessionKey?.operationGeneration).toBe(2);
    expect(second.sessionKey).not.toEqual(firstKey);
    expect(controller.synchronize(context({ geometryEpoch: 2 })).state.activePointerCount).toBe(0);
  });

  test('pointer release emits bounded momentum only for a current viewer drag', () => {
    const controller = createViewerViewportInteractionController();
    controller.dispatch(context(), pointer('pointerdown'));
    controller.dispatch(context(), pointer('pointermove', { clientX: 510, time: 100 }));
    controller.dispatch(
      context({ transform: { positionX: 10, positionY: 0, scale: 2 } }),
      pointer('pointermove', { clientX: 530, time: 120 }),
    );
    const released = controller.dispatch(
      context({ transform: { positionX: 30, positionY: 0, scale: 2 } }),
      pointer('pointerup', { clientX: 530, time: 121 }),
    );
    expect(released.physics).toEqual({ vx: 1, vy: 0 });
    expect(released.state.isPanning).toBe(false);
    expect(released.focalPoint).toEqual({ source: 'center', x: 400, y: 300 });
  });
});
