import { describe, expect, test } from 'bun:test';
import {
  createViewerObjectPromptInteractionController,
  type ViewerObjectPromptCurrentContext,
  type ViewerObjectPromptSample,
} from '../../../src/components/panel/editor/viewerObjectPromptInteractionController';
import { readObjectPromptCanvasState } from '../../../src/utils/mask/objectMaskPromptCanvas';

const context = (overrides: Partial<ViewerObjectPromptCurrentContext> = {}): ViewerObjectPromptCurrentContext => ({
  active: true,
  geometryEpoch: 7,
  imageSessionId: 'image-session:12:a',
  maskId: 'mask:object',
  mode: 'foreground_point',
  sourceIdentity: '/private/image-a.arw',
  sourceRevision: 'graph:9',
  tool: 'object-prompt',
  ...overrides,
});

const sample = (
  x: number,
  y: number,
  pointerType: ViewerObjectPromptSample['pointerType'] = 'mouse',
): ViewerObjectPromptSample => ({ imagePoint: { x, y }, pointerId: 4, pointerType });

describe('viewer Object Prompt interaction controller', () => {
  test('emits keyed foreground and background point commands for mouse and touch', () => {
    const controller = createViewerObjectPromptInteractionController();
    const foreground = controller.activate(context(), sample(0.25, 0.4), { promptMode: 'foreground_point' });
    expect(foreground).toMatchObject({
      key: { ...context(), operationGeneration: 1 },
      kind: 'commit-object-prompt',
    });
    expect(readObjectPromptCanvasState(foreground?.parameters).pointPrompts).toEqual([
      { label: 'foreground', x: 0.25, y: 0.4 },
    ]);

    const backgroundContext = context({ mode: 'background_point' });
    const background = controller.activate(backgroundContext, sample(0.7, 0.8, 'touch'), {
      ...foreground?.parameters,
      promptMode: 'background_point',
    });
    expect(background?.key).toEqual({ ...backgroundContext, operationGeneration: 2 });
    expect(readObjectPromptCanvasState(background?.parameters).pointPrompts.at(-1)).toEqual({
      label: 'background',
      x: 0.7,
      y: 0.8,
    });
  });

  test('commits the pending anchor and completed box as two exact semantic operations', () => {
    const controller = createViewerObjectPromptInteractionController();
    const boxContext = context({ mode: 'box' });
    const anchor = controller.activate(boxContext, sample(0.8, 0.75, 'pen'), { promptMode: 'box' });
    expect(readObjectPromptCanvasState(anchor?.parameters)).toMatchObject({
      boxPrompt: null,
      pendingBoxAnchor: { x: 0.8, y: 0.75 },
    });
    const box = controller.activate(boxContext, sample(0.2, 0.25, 'pen'), anchor?.parameters ?? {});
    expect(box?.key.operationGeneration).toBe(2);
    const completed = readObjectPromptCanvasState(box?.parameters);
    expect(completed).toMatchObject({
      boxPrompt: { height: 0.5, x: 0.2, y: 0.25 },
      pendingBoxAnchor: null,
    });
    expect(completed.boxPrompt?.width).toBeCloseTo(0.6);
  });

  test('rejects inactive, stale-mode, non-finite, and off-image samples without consuming identity', () => {
    const controller = createViewerObjectPromptInteractionController();
    expect(controller.activate(context({ active: false }), sample(0.2, 0.3), {})).toBeNull();
    expect(
      controller.activate(context({ mode: 'box' }), sample(0.2, 0.3), { promptMode: 'foreground_point' }),
    ).toBeNull();
    expect(controller.activate(context(), sample(Number.NaN, 0.3), {})).toBeNull();
    expect(controller.activate(context(), sample(-0.1, 0.3), {})).toBeNull();
    expect(controller.activate(context(), sample(0.2, 1.1), {})).toBeNull();
    expect(controller.activate(context(), sample(0.2, 0.3), {})?.key.operationGeneration).toBe(1);
  });

  test('captures exact A to B to A source, graph, geometry, mode, and mask identities', () => {
    const controller = createViewerObjectPromptInteractionController();
    const sourceA = context();
    const sourceB = context({
      geometryEpoch: 8,
      imageSessionId: 'image-session:13:b',
      maskId: 'mask:other',
      mode: 'background_point',
      sourceIdentity: '/private/image-b.arw',
      sourceRevision: 'graph:10',
    });
    expect(controller.activate(sourceA, sample(0.1, 0.2), {})?.key).toEqual({ ...sourceA, operationGeneration: 1 });
    expect(controller.activate(sourceB, sample(0.2, 0.3), { promptMode: 'background_point' })?.key).toEqual({
      ...sourceB,
      operationGeneration: 2,
    });
    expect(controller.activate(sourceA, sample(0.3, 0.4), {})?.key).toEqual({ ...sourceA, operationGeneration: 3 });
  });
});
