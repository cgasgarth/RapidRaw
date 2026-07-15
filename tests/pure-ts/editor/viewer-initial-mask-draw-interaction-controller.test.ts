import { describe, expect, test } from 'bun:test';
import {
  createViewerInitialMaskDrawInteractionController,
  type ViewerInitialMaskDrawCurrentContext,
  type ViewerInitialMaskDrawSample,
} from '../../../src/components/panel/editor/viewerInitialMaskDrawInteractionController';

const context = (
  overrides: Partial<ViewerInitialMaskDrawCurrentContext> = {},
): ViewerInitialMaskDrawCurrentContext => ({
  active: true,
  geometryEpoch: 7,
  imageSessionId: 'image-session:12:a',
  maskId: 'mask:radial',
  sourceIdentity: '/private/image-a.arw',
  sourceRevision: 'graph:9',
  tool: 'radial',
  ...overrides,
});

const sample = (
  pointerId: number,
  viewX: number,
  viewY: number,
  imageX = viewX * 4,
  imageY = viewY * 4,
  pointerType: ViewerInitialMaskDrawSample['pointerType'] = 'mouse',
): ViewerInitialMaskDrawSample => ({
  imagePoint: { x: imageX, y: imageY },
  pointerId,
  pointerType,
  viewPoint: { x: viewX, y: viewY },
});

const settings = {
  baselineParameters: { feather: 0.5, isInitialDraw: true },
  imageSize: { height: 800, width: 1200 },
};

describe('viewer initial mask draw interaction controller', () => {
  test('owns one radial mouse gesture and emits one semantic commit', () => {
    const controller = createViewerInitialMaskDrawInteractionController();
    expect(controller.begin(context(), sample(3, 20, 30), settings)).toBe(true);
    expect(controller.begin(context(), sample(4, 0, 0), settings)).toBe(false);
    expect(controller.move(context(), sample(3, 70, 90))).toBe(true);
    expect(controller.move(context(), sample(3, 70, 90))).toBe(false);
    expect(controller.end(context(), 3, 'mouse')).toEqual([
      {
        key: {
          active: true,
          geometryEpoch: 7,
          imageSessionId: 'image-session:12:a',
          maskId: 'mask:radial',
          operationGeneration: 1,
          sourceIdentity: '/private/image-a.arw',
          sourceRevision: 'graph:9',
          tool: 'radial',
        },
        kind: 'commit-initial-mask',
        maskId: 'mask:radial',
        parameters: {
          centerX: 80,
          centerY: 120,
          feather: 0.5,
          radiusX: 200,
          radiusY: 240,
          rotation: 0,
        },
      },
    ]);
    expect(controller.end(context(), 3, 'mouse')).toEqual([]);
  });

  test('derives a linear draft and commit from the same image-space geometry', () => {
    const controller = createViewerInitialMaskDrawInteractionController();
    const linear = context({ maskId: 'mask:linear', tool: 'linear' });
    controller.begin(linear, sample(8, 50, 50, 500, 400, 'pen'), settings);
    controller.move(linear, sample(8, 90, 80, 700, 550, 'pen'));
    const overlay = controller.overlays()[0];
    expect(overlay).toMatchObject({
      geometryEpoch: 7,
      input: { pointerId: 8, pointerType: 'pen' },
      maskId: 'mask:linear',
      pointerPolicy: 'none',
      sessionKey: { operationGeneration: 1, tool: 'linear' },
      zOrder: 'active-tool',
    });
    expect(controller.end(linear, 8, 'pen')[0]?.parameters).toEqual(
      Object.fromEntries(Object.entries(overlay?.parameters ?? {}).filter(([name]) => name !== 'isInitialDraw')),
    );
  });

  test('uses deterministic default geometry for radial and linear clicks', () => {
    const radial = createViewerInitialMaskDrawInteractionController();
    radial.begin(context(), sample(1, 20, 20), settings);
    expect(radial.end(context(), 1, 'mouse')[0]?.parameters).toMatchObject({ radiusX: 100, radiusY: 100 });

    const linear = createViewerInitialMaskDrawInteractionController();
    const linearContext = context({ maskId: 'mask:linear', tool: 'linear' });
    linear.begin(linearContext, sample(2, 20, 20, 400, 300, 'touch'), settings);
    expect(linear.end(linearContext, 2, 'touch')[0]?.parameters).toMatchObject({
      endX: 240,
      endY: 300,
      range: 100,
      startX: 560,
      startY: 300,
    });
  });

  test('ignores unrelated move and release without stealing the gesture', () => {
    const controller = createViewerInitialMaskDrawInteractionController();
    controller.begin(context(), sample(12, 10, 20, 100, 200, 'touch'), settings);
    expect(controller.move(context(), sample(99, 80, 90, 800, 900, 'touch'))).toBe(false);
    expect(controller.end(context(), 99, 'touch')).toEqual([]);
    expect(controller.isActive()).toBe(true);
    expect(controller.end(context(), 12, 'touch')).toHaveLength(1);
  });

  test('retains its owned pointer beyond the stage boundary', () => {
    const controller = createViewerInitialMaskDrawInteractionController();
    controller.begin(context(), sample(13, 20, 20, 200, 200, 'touch'), settings);
    expect(controller.move(context(), sample(13, -12, 80, -120, 800, 'touch'))).toBe(true);
    expect(controller.isActive()).toBe(true);
    expect(controller.end(context(), 13, 'touch')).toHaveLength(1);
  });

  test('cancels every successor identity', () => {
    const successors = [
      context({ imageSessionId: 'image-session:13:b', sourceIdentity: '/private/image-b.arw' }),
      context({ imageSessionId: 'image-session:14:a' }),
      context({ sourceIdentity: '/private/image-c.arw' }),
      context({ sourceRevision: 'graph:10' }),
      context({ geometryEpoch: 8 }),
      context({ maskId: 'mask:other' }),
      context({ tool: 'linear' }),
      context({ active: false }),
    ];
    for (const successor of successors) {
      const controller = createViewerInitialMaskDrawInteractionController();
      controller.begin(context(), sample(1, 10, 10), settings);
      expect(controller.synchronize(successor)).toBe(true);
      expect(controller.overlays()).toEqual([]);
      expect(controller.end(context(), 1, 'mouse')).toEqual([]);
    }
  });

  test('does not revive a cancelled A session after an A to B to A replacement', () => {
    const controller = createViewerInitialMaskDrawInteractionController();
    const sourceA = context();
    const sourceB = context({
      imageSessionId: 'image-session:13:b',
      sourceIdentity: '/private/image-b.arw',
    });

    expect(controller.begin(sourceA, sample(17, 10, 10), settings)).toBe(true);
    expect(controller.move(sourceA, sample(17, 40, 40))).toBe(true);
    expect(controller.synchronize(sourceB)).toBe(true);
    expect(controller.synchronize(sourceA)).toBe(false);
    expect(controller.isActive()).toBe(false);
    expect(controller.overlays()).toEqual([]);
    expect(controller.end(sourceA, 17, 'mouse')).toEqual([]);
  });

  test('cancels pointer sessions without a commit', () => {
    const controller = createViewerInitialMaskDrawInteractionController();
    controller.begin(context(), sample(1, 10, 10), settings);
    controller.cancel();
    expect(controller.overlays()).toEqual([]);
    expect(controller.end(context(), 1, 'mouse')).toEqual([]);
  });

  test('rejects non-finite points and invalid image dimensions without corrupting a session', () => {
    const controller = createViewerInitialMaskDrawInteractionController();
    expect(controller.begin(context(), sample(1, Number.NaN, 10), settings)).toBe(false);
    expect(controller.begin(context(), sample(1, 10, 10), { ...settings, imageSize: { height: 0, width: 1 } })).toBe(
      false,
    );
    expect(controller.begin(context(), sample(1, 10, 10), settings)).toBe(true);
    expect(controller.move(context(), sample(1, 30, Number.POSITIVE_INFINITY))).toBe(false);
    expect(controller.end(context(), 1, 'mouse')).toHaveLength(1);
  });
});
