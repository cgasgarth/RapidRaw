import { describe, expect, test } from 'bun:test';
import {
  createViewerParametricMaskTargetInteractionController,
  isViewerParametricMaskTargetKeyCurrent,
  type ViewerParametricMaskTargetCurrentContext,
} from '../../../src/components/panel/editor/viewerParametricMaskTargetInteractionController';

const context = (
  overrides: Partial<ViewerParametricMaskTargetCurrentContext> = {},
): ViewerParametricMaskTargetCurrentContext => ({
  active: true,
  geometryEpoch: 7,
  imageSessionId: 'image-session:12:a',
  maskId: 'mask:color',
  sourceIdentity: '/private/image-a.arw',
  sourceRevision: 'graph:9',
  tool: 'color',
  ...overrides,
});

const settings = {
  baselineParameters: { isInitialDraw: true, range: 0.25 },
  flipHorizontal: true,
  flipVertical: false,
  orientationSteps: 3,
  rotation: 1.5,
};
const mouse = { imagePoint: { x: 812, y: 614 }, pointerId: 4, pointerType: 'mouse' as const };

describe('viewer parametric mask target interaction controller', () => {
  test('publishes a declarative target then emits one exact source-bound semantic command on owned release', () => {
    const controller = createViewerParametricMaskTargetInteractionController();
    const overlay = controller.begin(context(), mouse, settings);
    expect(overlay).toEqual({
      id: 'parametric-mask-target:image-session:12:a:1',
      imagePoint: { x: 812, y: 614 },
      key: { ...context(), operationGeneration: 1, pointerId: 4, pointerType: 'mouse' },
      pointerPolicy: 'capture',
      zOrder: 'tool-geometry',
    });
    expect(controller.overlays()).toEqual([overlay]);
    expect(controller.end(context(), 99, 'mouse')).toBeNull();
    expect(controller.isActive()).toBeTrue();
    expect(controller.end(context(), 4, 'mouse')).toEqual({
      key: { ...context(), operationGeneration: 1, pointerId: 4, pointerType: 'mouse' },
      parameters: {
        flipHorizontal: true,
        flipVertical: false,
        orientationSteps: 3,
        range: 0.25,
        rotation: 1.5,
        targetX: 812,
        targetY: 614,
      },
    });
    expect(controller.end(context(), 4, 'mouse')).toBeNull();
    expect(controller.overlays()).toEqual([]);
  });

  test('supports touch then pen as separate operation generations', () => {
    const controller = createViewerParametricMaskTargetInteractionController();
    const luminance = context({ maskId: 'mask:luminance', tool: 'luminance' });
    expect(
      controller.begin(luminance, { imagePoint: { x: 100, y: 200 }, pointerId: 9, pointerType: 'touch' }, settings)?.key
        .operationGeneration,
    ).toBe(1);
    expect(controller.end(luminance, 9, 'touch')?.parameters).toMatchObject({ targetX: 100, targetY: 200 });
    expect(
      controller.begin(luminance, { imagePoint: { x: 300, y: 400 }, pointerId: 10, pointerType: 'pen' }, settings)?.key,
    ).toMatchObject({ operationGeneration: 2, pointerId: 10, pointerType: 'pen', tool: 'luminance' });
  });

  test('rejects inactive, non-finite, invalid-pointer, and concurrent inputs without consuming a generation', () => {
    const controller = createViewerParametricMaskTargetInteractionController();
    expect(controller.begin(context({ active: false }), mouse, settings)).toBeNull();
    expect(controller.begin(context(), { ...mouse, imagePoint: { x: Number.NaN, y: 2 } }, settings)).toBeNull();
    expect(controller.begin(context(), { ...mouse, pointerId: 0 }, settings)).toBeNull();
    expect(controller.begin(context(), mouse, { ...settings, rotation: Number.POSITIVE_INFINITY })).toBeNull();
    expect(controller.begin(context(), mouse, settings)?.key.operationGeneration).toBe(1);
    expect(controller.begin(context(), { ...mouse, pointerId: 5 }, settings)).toBeNull();
  });

  test('invalidates every exact key dimension and never revives predecessor A after A to B to successor A', () => {
    const dimensions: Array<Partial<ViewerParametricMaskTargetCurrentContext>> = [
      { active: false },
      { geometryEpoch: 8 },
      { imageSessionId: 'successor-session' },
      { maskId: 'successor-mask' },
      { sourceIdentity: '/private/image-b.arw' },
      { sourceRevision: 'graph:10' },
      { tool: 'luminance' },
    ];
    for (const replacement of dimensions) {
      const controller = createViewerParametricMaskTargetInteractionController();
      const overlay = controller.begin(context(), mouse, settings);
      expect(overlay).not.toBeNull();
      if (overlay === null) throw new Error('Expected an active target descriptor.');
      expect(isViewerParametricMaskTargetKeyCurrent(overlay.key, context(replacement))).toBeFalse();
      expect(controller.synchronize(context(replacement))).toEqual(overlay.key);
      expect(controller.end(context(), 4, 'mouse')).toBeNull();
    }

    const controller = createViewerParametricMaskTargetInteractionController();
    const predecessor = controller.begin(context(), mouse, settings);
    expect(controller.synchronize(context({ imageSessionId: 'image-session:13:b' }))).toEqual(predecessor?.key ?? null);
    expect(controller.synchronize(context())).toBeNull();
    expect(controller.end(context(), 4, 'mouse')).toBeNull();
    expect(controller.begin(context(), mouse, settings)?.key.operationGeneration).toBe(2);
  });

  test('cancel removes the draft and rejects late release without a command', () => {
    const controller = createViewerParametricMaskTargetInteractionController();
    const overlay = controller.begin(context(), mouse, settings);
    expect(controller.cancel()).toEqual(overlay?.key ?? null);
    expect(controller.overlays()).toEqual([]);
    expect(controller.end(context(), 4, 'mouse')).toBeNull();
  });
});
