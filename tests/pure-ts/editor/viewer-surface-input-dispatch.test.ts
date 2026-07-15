import { describe, expect, test } from 'bun:test';
import { normalizeViewerSurfacePointerEvent } from '../../../src/components/panel/editor/viewerInputRouter';
import {
  createViewerInteractionCoordinator,
  type ViewerInteractionContext,
} from '../../../src/components/panel/editor/viewerInteractionCoordinator';
import {
  dispatchViewerSurfaceInput,
  type ViewerSurfaceInputHandler,
} from '../../../src/components/panel/editor/viewerSurfaceInputDispatch';

const context = (overrides: Partial<ViewerInteractionContext> = {}): ViewerInteractionContext => ({
  activeTool: 'point-color',
  focusContext: 'viewer',
  geometryEpoch: 7,
  imageSessionId: 'image:1',
  isTemporaryHand: false,
  pointerCount: 1,
  sourceIdentity: '/fixture/a.raw',
  sourceRevision: 'graph:1',
  toolId: 'point-color',
  zoomed: false,
  ...overrides,
});

const pointer = (
  type: 'lostpointercapture' | 'pointercancel' | 'pointerdown' | 'pointermove' | 'pointerup',
  pointerId = 4,
  targetTool?: 'compare-divider' | 'crop' | 'straighten',
  button = 0,
) =>
  normalizeViewerSurfacePointerEvent({
    button,
    clientX: 20,
    clientY: 30,
    pointerId,
    pointerType: 'mouse',
    pressure: 0,
    ...(targetTool === undefined ? {} : { targetTool }),
    type,
  });

describe('viewer surface input dispatch', () => {
  test('forwards an owned gesture to exactly one active tool while observers remain passive', () => {
    const calls: string[] = [];
    const tool =
      (name: string): ViewerSurfaceInputHandler =>
      (event) =>
        calls.push(`${name}:${event.type}`);
    const result = dispatchViewerSurfaceInput(createViewerInteractionCoordinator(), pointer('pointerdown'), context(), {
      lifecycle: [tool('brush-lifecycle')],
      observers: [tool('sampler')],
      tools: {
        'point-color': tool('point-color'),
        'tone-equalizer': tool('tone-equalizer'),
        'white-balance': tool('white-balance'),
      },
    });

    expect(result.routedTool).toBe('point-color');
    expect(result.transition.owner).toBe('active-tool');
    expect(calls).toEqual(['sampler:pointerdown', 'point-color:pointerdown']);
  });

  test('does not forward blocked or competing pointers to a tool', () => {
    const calls: string[] = [];
    const handler: ViewerSurfaceInputHandler = (event) => calls.push(event.type);
    const coordinator = createViewerInteractionCoordinator();
    const handlers = { lifecycle: [], observers: [], tools: { 'point-color': handler } };
    const blocked = dispatchViewerSurfaceInput(
      coordinator,
      pointer('pointerdown'),
      context({ focusContext: 'modal' }),
      handlers,
    );
    expect(blocked.routedTool).toBeNull();

    const activeCoordinator = createViewerInteractionCoordinator();
    dispatchViewerSurfaceInput(activeCoordinator, pointer('pointerdown'), context(), handlers);
    const competing = dispatchViewerSurfaceInput(activeCoordinator, pointer('pointerdown', 5), context(), handlers);
    expect(competing.routedTool).toBeNull();
    expect(calls).toEqual(['pointerdown']);
  });

  test('cancels Konva lifecycle owners once and the active surface tool through one path', () => {
    const calls: string[] = [];
    const lifecycle: ViewerSurfaceInputHandler = (event) => calls.push(`lifecycle:${event.type}`);
    const active: ViewerSurfaceInputHandler = (event) => calls.push(`active:${event.type}`);
    const coordinator = createViewerInteractionCoordinator();
    const current = context({ activeTool: 'brush', toolId: 'brush' });
    const handlers = {
      lifecycle: [lifecycle, lifecycle],
      observers: [],
      tools: { brush: active },
    };
    dispatchViewerSurfaceInput(coordinator, pointer('pointerdown'), current, handlers);
    calls.length = 0;
    const cancelled = dispatchViewerSurfaceInput(coordinator, { type: 'escape' }, current, handlers);

    expect(cancelled.transition.activeSession).toBeNull();
    expect(calls).toEqual(['lifecycle:escape', 'active:escape']);
  });

  test('preserves white-balance hover preview without creating pointer ownership', () => {
    const calls: string[] = [];
    const current = context({ activeTool: 'white-balance', toolId: 'white-balance' });
    const result = dispatchViewerSurfaceInput(createViewerInteractionCoordinator(), pointer('pointermove'), current, {
      lifecycle: [],
      observers: [],
      tools: { 'white-balance': (event) => calls.push(event.type) },
    });

    expect(result.transition.input.ignored).toBe(true);
    expect(result.transition.owner).toBeNull();
    expect(result.routedTool).toBe('white-balance');
    expect(calls).toEqual(['pointermove']);
  });

  test('keeps the target controller routed through release after canonical session cleanup', () => {
    const calls: string[] = [];
    const coordinator = createViewerInteractionCoordinator();
    const current = context({ activeTool: 'none', toolId: 'pan' });
    const handlers = {
      lifecycle: [],
      observers: [],
      tools: { 'compare-divider': (event: Parameters<ViewerSurfaceInputHandler>[0]) => calls.push(event.type) },
    };
    expect(
      dispatchViewerSurfaceInput(coordinator, pointer('pointerdown', 4, 'compare-divider'), current, handlers)
        .routedTool,
    ).toBe('compare-divider');
    expect(dispatchViewerSurfaceInput(coordinator, pointer('pointermove'), current, handlers).routedTool).toBe(
      'compare-divider',
    );
    expect(dispatchViewerSurfaceInput(coordinator, pointer('pointerup'), current, handlers).routedTool).toBe(
      'compare-divider',
    );
    expect(calls).toEqual(['pointerdown', 'pointermove', 'pointerup']);
  });

  test('routes semantic compare and straighten input to only the targeted controller', () => {
    const calls: string[] = [];
    const coordinator = createViewerInteractionCoordinator();
    const handler =
      (tool: string): ViewerSurfaceInputHandler =>
      (event) =>
        calls.push(`${tool}:${event.type}`);
    const handlers = {
      lifecycle: [],
      observers: [],
      tools: { 'compare-divider': handler('compare'), straighten: handler('straighten') },
    };
    dispatchViewerSurfaceInput(
      coordinator,
      { key: 'ArrowRight', shiftKey: false, targetTool: 'compare-divider', type: 'keydown' },
      context({ activeTool: 'none', toolId: 'pan' }),
      handlers,
    );
    dispatchViewerSurfaceInput(
      coordinator,
      { targetTool: 'straighten', type: 'escape' },
      context({ activeTool: 'straighten', toolId: 'straighten' }),
      handlers,
    );
    expect(calls).toEqual(['compare:keydown', 'straighten:escape']);
  });

  test('does not leak a middle-button pan gesture into a targeted tool controller', () => {
    const calls: string[] = [];
    const result = dispatchViewerSurfaceInput(
      createViewerInteractionCoordinator(),
      pointer('pointerdown', 4, 'crop', 1),
      context({ activeTool: 'crop', toolId: 'crop' }),
      {
        lifecycle: [],
        observers: [],
        tools: { crop: (event) => calls.push(event.type) },
      },
    );
    expect(result.transition.owner).toBe('viewer-pan');
    expect(result.transition.activeSession?.key.toolId).toBe('pan');
    expect(result.routedTool).toBeNull();
    expect(calls).toEqual([]);
  });
});
