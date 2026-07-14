import { describe, expect, test } from 'bun:test';
import { resolveEffectiveBrushTool } from '../../../src/components/panel/editor/imageCanvasContracts';
import { normalizeViewerSurfacePointerEvent } from '../../../src/components/panel/editor/viewerInputRouter';
import {
  createViewerInteractionCoordinator,
  type ViewerInteractionContext,
} from '../../../src/components/panel/editor/viewerInteractionCoordinator';

const context = (overrides: Partial<ViewerInteractionContext> = {}): ViewerInteractionContext => ({
  activeTool: 'brush',
  focusContext: 'viewer',
  geometryEpoch: 4,
  imageSessionId: 'image-session:12:a',
  isTemporaryHand: false,
  pointerCount: 1,
  sourceRevision: 'graph:9',
  toolId: 'brush',
  zoomed: false,
  ...overrides,
});

const pointer = (
  type: 'lostpointercapture' | 'pointercancel' | 'pointerdown' | 'pointermove' | 'pointerup',
  overrides: Partial<Parameters<typeof normalizeViewerSurfacePointerEvent>[0]> = {},
) =>
  normalizeViewerSurfacePointerEvent({
    clientX: 20,
    clientY: 30,
    pointerId: 7,
    pointerType: 'mouse',
    pressure: 0,
    type,
    ...overrides,
  });

describe('viewer interaction coordinator', () => {
  test('routes mouse, touch, and pressure-bearing pen through one owned session model', () => {
    for (const [pointerType, pressure] of [
      ['mouse', 0],
      ['touch', 0.5],
      ['pen', 0.75],
    ] as const) {
      const coordinator = createViewerInteractionCoordinator();
      const started = coordinator.dispatch(pointer('pointerdown', { pointerType, pressure }), context());
      expect(started.owner).toBe('active-tool');
      expect(started.toolCommand).toMatchObject({
        kind: 'begin',
        session: { lastPointerSample: { pointerType, pressure } },
      });
      const moved = coordinator.dispatch(
        pointer('pointermove', { clientX: 25, clientY: 40, pointerType, pressure: Math.min(1, pressure + 0.2) }),
        context(),
      );
      expect(moved.activeSession?.lastPointerSample).toMatchObject({ clientX: 25, clientY: 40, pointerType });
      expect(coordinator.dispatch(pointer('pointerup', { pointerType }), context()).activeSession).toBeNull();
    }
  });

  test('enforces one pointer owner and exposes capture policy from the canonical router', () => {
    const coordinator = createViewerInteractionCoordinator();
    const panContext = context({ activeTool: 'none', toolId: 'pan' });
    const first = coordinator.dispatch(pointer('pointerdown'), panContext);
    expect(first.owner).toBe('viewer-pan');
    expect(first.shouldCapturePointer).toBe(true);

    const competing = coordinator.dispatch(pointer('pointerdown', { pointerId: 8 }), panContext);
    expect(competing.forwardToTool).toBe(false);
    expect(competing.input.ignored).toBe(true);
    expect(competing.toolCommand).toBeNull();
    expect(coordinator.dispatch(pointer('pointerup', { pointerId: 8 }), panContext).owner).toBe('viewer-pan');
    expect(coordinator.dispatch(pointer('pointerup'), panContext).owner).toBeNull();
  });

  test('cancels the exact session on pointer cancellation and lost capture', () => {
    for (const releaseType of ['pointercancel', 'lostpointercapture'] as const) {
      const coordinator = createViewerInteractionCoordinator();
      coordinator.dispatch(pointer('pointerdown'), context());
      const cancelled = coordinator.dispatch(pointer(releaseType), context());
      expect(cancelled.toolCommand).toMatchObject({ kind: 'cancel', pointerId: 7 });
      expect(cancelled.activeSession).toBeNull();
      expect(cancelled.owner).toBeNull();
      expect(coordinator.dispatch(pointer('pointerup'), context()).forwardToTool).toBe(false);
    }
  });

  test('does not forward the stale capture-loss event emitted after pointer release', () => {
    const coordinator = createViewerInteractionCoordinator();
    const pickerContext = context({ activeTool: 'point-color', toolId: 'point-color' });
    coordinator.dispatch(pointer('pointerdown'), pickerContext);
    expect(coordinator.dispatch(pointer('pointerup'), pickerContext).forwardToTool).toBe(true);
    const staleCaptureLoss = coordinator.dispatch(pointer('lostpointercapture'), pickerContext);
    expect(staleCaptureLoss.input.ignored).toBe(true);
    expect(staleCaptureLoss.forwardToTool).toBe(false);
    expect(staleCaptureLoss.toolCommand).toBeNull();
  });

  test('uses the same deterministic cleanup path for blur, Escape, and unmount', () => {
    for (const reason of ['blur', 'escape', 'dispose'] as const) {
      const coordinator = createViewerInteractionCoordinator();
      coordinator.dispatch(pointer('pointerdown'), context());
      const cancelled =
        reason === 'dispose' ? coordinator.dispose() : coordinator.dispatch({ type: reason }, context()).toolCommand;
      expect(cancelled).toMatchObject({ kind: 'cancel', pointerId: 7 });
      expect(coordinator.snapshot()).toEqual({ activeSession: null, owner: null });
    }
  });

  test('invalidates active work on every currentness identity dimension, including A to B to A', () => {
    const successors: ViewerInteractionContext[] = [
      context({ geometryEpoch: 5 }),
      context({ sourceRevision: 'graph:10' }),
      context({ imageSessionId: 'image-session:13:b' }),
      context({ imageSessionId: 'image-session:14:a' }),
      context({ activeTool: 'crop', toolId: 'crop' }),
      context({ toolId: 'mask' }),
    ];
    for (const successor of successors) {
      const coordinator = createViewerInteractionCoordinator();
      coordinator.dispatch(pointer('pointerdown'), context());
      expect(coordinator.synchronize(successor)).toMatchObject({ kind: 'cancel', pointerId: 7 });
      expect(coordinator.snapshot()).toEqual({ activeSession: null, owner: null });
      expect(coordinator.synchronize(successor)).toBeNull();
    }
  });

  test('preserves second-stroke Alt inversion and unique generations for mouse and pen', () => {
    const coordinator = createViewerInteractionCoordinator();
    const firstSession = coordinator.dispatch(pointer('pointerdown'), context()).activeSession;
    expect(firstSession?.lastPointerSample?.altKey).toBe(false);
    expect(resolveEffectiveBrushTool('brush', firstSession?.lastPointerSample?.altKey ?? false)).toBe('brush');
    coordinator.dispatch(pointer('pointerup'), context());
    const secondSession = coordinator.dispatch(
      pointer('pointerdown', { altKey: true, pointerId: 8, pointerType: 'pen', pressure: 0.6 }),
      context(),
    ).activeSession;
    expect(secondSession?.lastPointerSample).toMatchObject({ altKey: true, pointerType: 'pen', pressure: 0.6 });
    expect(resolveEffectiveBrushTool('brush', secondSession?.lastPointerSample?.altKey ?? false)).toBe('eraser');
    expect(firstSession?.key.operationGeneration).toBe(1);
    expect(secondSession?.key.operationGeneration).toBe(2);
  });

  test('does not start or forward a blocked gesture', () => {
    const coordinator = createViewerInteractionCoordinator();
    const blocked = coordinator.dispatch(pointer('pointerdown'), context({ focusContext: 'modal' }));
    expect(blocked.input.resolution?.owner).toBe('blocked');
    expect(blocked.activeSession).toBeNull();
    expect(blocked.forwardToTool).toBe(false);
    expect(blocked.shouldCapturePointer).toBe(false);
  });
});
