import { describe, expect, test } from 'bun:test';
import {
  createViewerAiMaskBoxInteractionController,
  type ViewerAiMaskBoxCurrentContext,
  type ViewerAiMaskBoxSample,
} from '../../../src/components/panel/editor/viewerAiMaskBoxInteractionController';

const context = (overrides: Partial<ViewerAiMaskBoxCurrentContext> = {}): ViewerAiMaskBoxCurrentContext => ({
  active: true,
  containerFamily: 'masks',
  containerId: 'layer:1',
  geometryEpoch: 7,
  imageSessionId: 'image-session:12:a',
  maskId: 'subject:1',
  sourceIdentity: '/private/image-a.arw',
  sourceRevision: 'graph:9',
  tool: 'ai-subject',
  ...overrides,
});

const sample = (
  pointerId: number,
  viewX: number,
  viewY: number,
  imageX = viewX * 4,
  imageY = viewY * 4,
  pointerType: ViewerAiMaskBoxSample['pointerType'] = 'mouse',
): ViewerAiMaskBoxSample => ({
  imagePoint: { x: imageX, y: imageY },
  pointerId,
  pointerType,
  viewPoint: { x: viewX, y: viewY },
});

describe('viewer AI mask box interaction controller', () => {
  test('owns one mouse drag and emits one keyed semantic command from the rendered overlay geometry', () => {
    const controller = createViewerAiMaskBoxInteractionController();
    expect(controller.begin(context(), sample(3, 20, 30), { feather: 0.4 })).toBe(true);
    expect(controller.begin(context(), sample(4, 0, 0), {})).toBe(false);
    expect(controller.move(context(), sample(3, 70, 90))).toBe(true);
    const overlay = controller.overlays()[0];
    expect(overlay).toMatchObject({
      end: { imagePoint: { x: 280, y: 360 }, viewPoint: { x: 70, y: 90 } },
      input: { pointerId: 3, pointerType: 'mouse' },
      maskId: 'subject:1',
      pointerPolicy: 'none',
      sessionKey: { operationGeneration: 1, tool: 'ai-subject' },
      start: { imagePoint: { x: 80, y: 120 }, viewPoint: { x: 20, y: 30 } },
      zOrder: 'active-tool',
    });
    expect(controller.end(context(), 3, 'mouse')).toEqual([
      {
        endPoint: { x: 280, y: 360 },
        key: {
          active: true,
          containerFamily: 'masks',
          containerId: 'layer:1',
          geometryEpoch: 7,
          imageSessionId: 'image-session:12:a',
          maskId: 'subject:1',
          operationGeneration: 1,
          sourceIdentity: '/private/image-a.arw',
          sourceRevision: 'graph:9',
          tool: 'ai-subject',
        },
        kind: 'commit-ai-mask-box',
        maskId: 'subject:1',
        parameters: { endX: 280, endY: 360, feather: 0.4, startX: 80, startY: 120 },
        startPoint: { x: 80, y: 120 },
      },
    ]);
    expect(controller.end(context(), 3, 'mouse')).toEqual([]);
  });

  test('normalizes a click to one image point and supports touch and pen ownership', () => {
    for (const [pointerId, pointerType] of [
      [8, 'touch'],
      [9, 'pen'],
    ] as const) {
      const controller = createViewerAiMaskBoxInteractionController();
      const quickErase = context({ maskId: 'erase:1', tool: 'quick-eraser' });
      expect(controller.begin(quickErase, sample(pointerId, 10, 10, 100, 200, pointerType), {})).toBe(true);
      expect(controller.move(quickErase, sample(pointerId, 13, 12, 130, 220, pointerType))).toBe(true);
      expect(controller.end(quickErase, pointerId, pointerType)[0]).toMatchObject({
        endPoint: { x: 100, y: 200 },
        parameters: { endX: 100, endY: 200, startX: 100, startY: 200 },
        startPoint: { x: 100, y: 200 },
      });
    }
  });

  test('ignores unrelated pointers without stealing or double-committing the owned gesture', () => {
    const controller = createViewerAiMaskBoxInteractionController();
    controller.begin(context(), sample(12, 10, 20, 100, 200, 'touch'), {});
    expect(controller.move(context(), sample(99, 80, 90, 800, 900, 'touch'))).toBe(false);
    expect(controller.end(context(), 99, 'touch')).toEqual([]);
    expect(controller.isActive()).toBe(true);
    expect(controller.end(context(), 12, 'touch')).toHaveLength(1);
    expect(controller.end(context(), 12, 'touch')).toEqual([]);
  });

  test('cancels every successor identity and never revives A after A to B to A', () => {
    const successors = [
      context({ imageSessionId: 'image-session:13:b' }),
      context({ containerId: 'layer:2' }),
      context({ containerFamily: 'aiPatches' }),
      context({ sourceIdentity: '/private/image-b.arw' }),
      context({ sourceRevision: 'graph:10' }),
      context({ geometryEpoch: 8 }),
      context({ maskId: 'subject:2' }),
      context({ tool: 'quick-eraser' }),
      context({ active: false }),
    ];
    for (const successor of successors) {
      const controller = createViewerAiMaskBoxInteractionController();
      controller.begin(context(), sample(1, 10, 10), {});
      expect(controller.synchronize(successor)).toBe(true);
      expect(controller.overlays()).toEqual([]);
      expect(controller.synchronize(context())).toBe(false);
      expect(controller.end(context(), 1, 'mouse')).toEqual([]);
    }
  });

  test('cancel and invalid coordinates never produce a command', () => {
    const controller = createViewerAiMaskBoxInteractionController();
    expect(controller.begin(context(), sample(1, Number.NaN, 10), {})).toBe(false);
    expect(controller.begin(context(), sample(1, 10, 10), {})).toBe(true);
    expect(controller.move(context(), sample(1, 30, Number.POSITIVE_INFINITY))).toBe(false);
    controller.cancel();
    expect(controller.end(context(), 1, 'mouse')).toEqual([]);
  });
});
