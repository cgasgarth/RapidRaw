import { describe, expect, test } from 'bun:test';
import {
  createViewerParametricMaskTargetInteractionController,
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

describe('viewer parametric mask target interaction controller', () => {
  test('emits one source-bound semantic Color target command', () => {
    const controller = createViewerParametricMaskTargetInteractionController();
    expect(
      controller.activate(context(), { imagePoint: { x: 812, y: 614 }, pointerId: 4, pointerType: 'mouse' }, settings),
    ).toEqual({
      key: { ...context(), operationGeneration: 1 },
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
  });

  test('supports Luminance touch and increments operation identity', () => {
    const controller = createViewerParametricMaskTargetInteractionController();
    const luminance = context({ maskId: 'mask:luminance', tool: 'luminance' });
    const first = controller.activate(
      luminance,
      { imagePoint: { x: 100, y: 200 }, pointerId: 9, pointerType: 'touch' },
      settings,
    );
    const second = controller.activate(
      luminance,
      { imagePoint: { x: 300, y: 400 }, pointerId: 10, pointerType: 'pen' },
      settings,
    );
    expect(first).toMatchObject({
      key: { operationGeneration: 1, tool: 'luminance' },
    });
    expect(second).toMatchObject({
      key: { operationGeneration: 2, tool: 'luminance' },
      parameters: { targetX: 300, targetY: 400 },
    });
  });

  test('rejects inactive and non-finite inputs without consuming a generation', () => {
    const controller = createViewerParametricMaskTargetInteractionController();
    expect(
      controller.activate(
        context({ active: false }),
        { imagePoint: { x: 1, y: 2 }, pointerId: 1, pointerType: 'mouse' },
        settings,
      ),
    ).toBeNull();
    expect(
      controller.activate(
        context(),
        { imagePoint: { x: Number.NaN, y: 2 }, pointerId: 1, pointerType: 'mouse' },
        settings,
      ),
    ).toBeNull();
    expect(
      controller.activate(
        context(),
        { imagePoint: { x: 1, y: 2 }, pointerId: 1, pointerType: 'mouse' },
        { ...settings, rotation: Number.POSITIVE_INFINITY },
      ),
    ).toBeNull();
    expect(
      controller.activate(context(), { imagePoint: { x: 1, y: 2 }, pointerId: 1, pointerType: 'mouse' }, settings)?.key
        .operationGeneration,
    ).toBe(1);
  });

  test('captures exact A to B to A source, graph, geometry, and tool identities', () => {
    const controller = createViewerParametricMaskTargetInteractionController();
    const sourceA = context();
    const sourceB = context({
      geometryEpoch: 8,
      imageSessionId: 'image-session:13:b',
      maskId: 'mask:luminance',
      sourceIdentity: '/private/image-b.arw',
      sourceRevision: 'graph:10',
      tool: 'luminance',
    });
    const sample = { imagePoint: { x: 5, y: 6 }, pointerId: 1, pointerType: 'mouse' as const };
    expect(controller.activate(sourceA, sample, settings)?.key).toEqual({ ...sourceA, operationGeneration: 1 });
    expect(controller.activate(sourceB, sample, settings)?.key).toEqual({ ...sourceB, operationGeneration: 2 });
    expect(controller.activate(sourceA, sample, settings)?.key).toEqual({ ...sourceA, operationGeneration: 3 });
  });
});
