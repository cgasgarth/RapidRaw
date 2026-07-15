import { describe, expect, test } from 'bun:test';

import {
  createViewerWhiteBalanceInteractionController,
  resolveViewerWhiteBalanceCropPoint,
  type ViewerWhiteBalanceInteractionContext,
} from '../../../src/components/panel/editor/viewerWhiteBalanceInteractionController';

const context = (
  overrides: Partial<ViewerWhiteBalanceInteractionContext> = {},
): ViewerWhiteBalanceInteractionContext => ({
  active: true,
  cropSize: { height: 400, width: 800 },
  geometryEpoch: 7,
  imageSessionId: 'session:alaska',
  previewIdentity: 'preview:42',
  sourceIdentity: 'source:alaska.RAF:42',
  sourceRevision: 'graph:42',
  ...overrides,
});

describe('viewer white-balance interaction controller', () => {
  test('owns one exact preview or commit request at a time', () => {
    const controller = createViewerWhiteBalanceInteractionController();
    const preview = controller.beginPreview(context(), { x: 120.5, y: 80 }, 3);
    expect(controller.beginGesture(context(), { x: 240, y: 160 }, 4)).toBe(true);
    const commit = controller.completeGesture(context(), 4);

    expect(preview?.identity.intent).toBe('preview');
    expect(commit).toEqual({
      cropSize: { height: 400, width: 800 },
      identity: {
        geometryEpoch: 7,
        imageSessionId: 'session:alaska',
        intent: 'commit',
        operationGeneration: 2,
        pointerId: 4,
        previewIdentity: 'preview:42',
        sourceIdentity: 'source:alaska.RAF:42',
        sourceRevision: 'graph:42',
      },
      imagePoint: { x: 240, y: 160 },
    });
    expect(controller.accept(preview!.identity, context())).toBe(false);
    expect(controller.accept(commit!.identity, context())).toBe(true);
    expect(controller.accept(commit!.identity, context())).toBe(false);
  });

  test('rejects every stale identity dimension and explicit cancellation', () => {
    const variants: Partial<ViewerWhiteBalanceInteractionContext>[] = [
      { active: false },
      { cropSize: { height: 401, width: 800 } },
      { geometryEpoch: 8 },
      { imageSessionId: 'session:other' },
      { previewIdentity: 'preview:other' },
      { sourceIdentity: 'source:other' },
      { sourceRevision: 'graph:other' },
    ];
    for (const replacement of variants) {
      const controller = createViewerWhiteBalanceInteractionController();
      const request = controller.beginPreview(context(), { x: 10, y: 20 }, 7);
      expect(request).not.toBeNull();
      controller.synchronize(context(replacement));
      expect(controller.accept(request!.identity, context(replacement))).toBe(false);
    }

    const controller = createViewerWhiteBalanceInteractionController();
    const request = controller.beginPreview(context(), { x: 10, y: 20 }, 7);
    controller.cancel();
    expect(controller.accept(request!.identity, context())).toBe(false);
  });

  test('never revives a delayed A result after A to B to A replacement', () => {
    const controller = createViewerWhiteBalanceInteractionController();
    expect(controller.beginGesture(context(), { x: 10, y: 20 }, 7)).toBe(true);
    const delayedA = controller.completeGesture(context(), 7);
    controller.synchronize(context({ imageSessionId: 'session:B', sourceIdentity: 'source:B' }));
    controller.synchronize(context());
    expect(controller.beginGesture(context(), { x: 30, y: 40 }, 8)).toBe(true);
    const currentA = controller.completeGesture(context(), 8);

    expect(controller.accept(delayedA!.identity, context())).toBe(false);
    expect(controller.accept(currentA!.identity, context())).toBe(true);
  });

  test('rejects invalid crop points and inactive contexts', () => {
    const controller = createViewerWhiteBalanceInteractionController();
    expect(controller.beginPreview(context(), { x: -1, y: 10 }, 7)).toBeNull();
    expect(controller.beginPreview(context(), { x: 800, y: 401 }, 7)).toBeNull();
    expect(controller.beginGesture(context({ active: false }), { x: 1, y: 1 }, 7)).toBe(false);
    expect(controller.beginGesture(context({ previewIdentity: '' }), { x: 1, y: 1 }, 7)).toBe(false);
  });

  test('does not request a commit until a valid matching pointerup', () => {
    const controller = createViewerWhiteBalanceInteractionController();
    expect(controller.beginGesture(context(), { x: 10, y: 20 }, 31)).toBe(true);
    expect(controller.pending()).toBeNull();
    expect(controller.completeGesture(context(), 32)).toBeNull();
    controller.cancel();
    expect(controller.completeGesture(context(), 31)).toBeNull();

    expect(controller.beginGesture(context(), { x: 20, y: 30 }, 33)).toBe(true);
    const completed = controller.completeGesture(context(), 33);
    expect(completed?.identity.intent).toBe('commit');
    expect(controller.beginPreview(context(), { x: 25, y: 35 }, 33)).toBeNull();
    expect(controller.cancelPreview()).toBe(false);
    expect(controller.handleLostPointerCapture(33)).toBe(false);
    expect(controller.accept(completed!.identity, context())).toBe(true);
  });

  test('cancels preview work without cancelling a causal pointerup commit', () => {
    const controller = createViewerWhiteBalanceInteractionController();
    const preview = controller.beginPreview(context(), { x: 15, y: 25 }, 41);
    expect(preview).not.toBeNull();
    expect(controller.cancelPreview()).toBe(true);
    expect(controller.accept(preview!.identity, context())).toBe(false);

    expect(controller.beginGesture(context(), { x: 35, y: 45 }, 42)).toBe(true);
    const commit = controller.completeGesture(context(), 42);
    expect(commit).not.toBeNull();
    expect(controller.cancelPreview()).toBe(false);
    expect(controller.pending()).toEqual(commit!.identity);
    expect(controller.accept(commit!.identity, context())).toBe(true);
  });

  test('cancels a down gesture before any fast sample can persist', () => {
    const controller = createViewerWhiteBalanceInteractionController();
    expect(controller.beginGesture(context(), { x: 20, y: 30 }, 32)).toBe(true);
    expect(controller.pending()).toBeNull();
    expect(controller.handleLostPointerCapture(32)).toBe(true);
    expect(controller.completeGesture(context(), 32)).toBeNull();
  });

  test('maps CSS-scaled Fit, Fill, zoom, and resized surfaces to the same crop point', () => {
    const cases = [
      {
        clientPoint: { x: 610, y: 410 },
        displayedImageRect: { height: 300, width: 400, x: 100, y: 50 },
        surfaceRect: { height: 800, layoutHeight: 400, layoutWidth: 640, width: 1280, x: 10, y: 10 },
      },
      {
        clientPoint: { x: 330, y: 200 },
        displayedImageRect: { height: 500, width: 800, x: -80, y: -50 },
        surfaceRect: { height: 400, layoutHeight: 400, layoutWidth: 640, width: 640, x: 10, y: 0 },
      },
      {
        clientPoint: { x: 810, y: 620 },
        displayedImageRect: { height: 600, width: 800, x: 0, y: 0 },
        surfaceRect: { height: 600, layoutHeight: 600, layoutWidth: 800, width: 800, x: 410, y: 320 },
      },
    ];

    for (const item of cases) {
      expect(
        resolveViewerWhiteBalanceCropPoint({
          ...item,
          cropSize: { height: 400, width: 800 },
        }),
      ).toEqual({ x: 400, y: 200 });
    }
  });
});
