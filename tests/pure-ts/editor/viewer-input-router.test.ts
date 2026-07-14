import { describe, expect, test } from 'bun:test';
import type { ResolveViewerInputInput } from '../../../src/components/panel/editor/viewerInputResolver';
import {
  createViewerInputRouter,
  initialViewerInputRouterState,
  reduceViewerInputRouter,
} from '../../../src/components/panel/editor/viewerInputRouter';

const input = (overrides: Partial<ResolveViewerInputInput> = {}): ResolveViewerInputInput => ({
  activeTool: 'none',
  button: 0,
  focusContext: 'viewer',
  isDragging: false,
  isTemporaryHand: false,
  pointerCount: 1,
  pointerType: 'mouse',
  zoomed: false,
  ...overrides,
});

describe('viewer input router', () => {
  test('gives one pointer explicit ownership and ignores a competing gesture', () => {
    const router = createViewerInputRouter();
    expect(router.dispatch({ type: 'pointerdown', pointerId: 1, input: input() }).state.owner).toBe('viewer-pan');
    expect(router.dispatch({ type: 'pointerdown', pointerId: 2, input: input() }).ignored).toBe(true);
    expect(router.dispatch({ type: 'pointerup', pointerId: 2 }).ignored).toBe(true);
    expect(router.dispatch({ type: 'pointerup', pointerId: 1 }).state).toEqual(initialViewerInputRouterState());
  });

  test('cancels ownership on blur, escape, and session replacement', () => {
    let state = initialViewerInputRouterState();
    state = reduceViewerInputRouter(state, { type: 'pointerdown', pointerId: 1, input: input() }).state;
    state = reduceViewerInputRouter(state, { type: 'blur' }).state;
    expect(state.activePointerId).toBeNull();
    state = reduceViewerInputRouter(state, {
      type: 'pointerdown',
      pointerId: 2,
      input: input({ activeTool: 'brush' }),
    }).state;
    state = reduceViewerInputRouter(state, { type: 'session-invalidated' }).state;
    expect(state.owner).toBeNull();
    expect(state.sessionGeneration).toBe(1);
  });

  test('blocks modal gestures without stealing the active pointer', () => {
    const transition = reduceViewerInputRouter(initialViewerInputRouterState(), {
      type: 'pointerdown',
      pointerId: 1,
      input: input({ focusContext: 'modal' }),
    });
    expect(transition.resolution?.owner).toBe('blocked');
    expect(transition.state.activePointerId).toBeNull();
  });

  test('releases ownership when the browser reports lost pointer capture', () => {
    let state = reduceViewerInputRouter(initialViewerInputRouterState(), {
      type: 'pointerdown',
      pointerId: 9,
      input: input({ activeTool: 'brush' }),
    }).state;

    const transition = reduceViewerInputRouter(state, { type: 'lostpointercapture', pointerId: 9 });
    expect(transition.ignored).toBe(false);
    expect(transition.state).toEqual(initialViewerInputRouterState());

    state = transition.state;
    expect(reduceViewerInputRouter(state, { type: 'pointerup', pointerId: 9 }).ignored).toBe(true);
  });

  test('retains normalized pointer samples for pressure-aware controllers', () => {
    const router = createViewerInputRouter();
    router.dispatch({
      type: 'pointerdown',
      pointerId: 11,
      input: input({ pointerType: 'pen' }),
      sample: { clientX: 12, clientY: 24, pointerType: 'pen', pressure: 0.35 },
    });
    expect(router.getState().lastPointerSample).toEqual({
      clientX: 12,
      clientY: 24,
      pointerType: 'pen',
      pressure: 0.35,
    });
    router.dispatch({
      type: 'pointermove',
      pointerId: 11,
      sample: { clientX: 18, clientY: 30, pointerType: 'pen', pressure: 0.8 },
    });
    expect(router.getState().lastPointerSample?.pressure).toBe(0.8);
    router.dispatch({ type: 'pointerup', pointerId: 11 });
    expect(router.getState().lastPointerSample).toBeNull();
  });
});
