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
});
