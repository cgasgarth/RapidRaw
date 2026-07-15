import { describe, expect, test } from 'bun:test';
import {
  createViewerMaskShapeInteractionController,
  isViewerMaskShapeKeyCurrent,
  type ViewerMaskShapeCurrentContext,
} from '../../../src/components/panel/editor/viewerMaskShapeInteractionController';

const context = (overrides: Partial<ViewerMaskShapeCurrentContext> = {}): ViewerMaskShapeCurrentContext => ({
  active: true,
  containerId: 'layer:1',
  containerKind: 'masks',
  geometryEpoch: 7,
  imageSessionId: 'image-session:A:1',
  sourceIdentity: '/fixture/A.ARW',
  sourceRevision: 'graph:A:1',
  ...overrides,
});
const target = { containerId: 'layer:1', containerKind: 'masks' as const, subMaskId: 'radial:1' };
const pointer = { pointerId: 14, pointerType: 'pen' as const };

describe('viewer mask shape interaction controller', () => {
  test('publishes a declarative draft and one semantic command for the exact keyed session', () => {
    const controller = createViewerMaskShapeInteractionController();
    const key = controller.begin(context(), target, pointer, 'mask-shape:1');
    expect(key).toEqual({
      ...target,
      geometryEpoch: 7,
      imageSessionId: 'image-session:A:1',
      operationId: 'mask-shape:1',
      pointerId: 14,
      pointerType: 'pen',
      sourceIdentity: '/fixture/A.ARW',
      sourceRevision: 'graph:A:1',
    });

    const patch = { parameters: { centerX: 180, centerY: 220 } };
    const overlay = controller.preview(context(), target.subMaskId, patch);
    expect(overlay).toEqual({ key, patch, pointerPolicy: 'capture', zOrder: 'tool-geometry' });
    expect(controller.overlays()).toEqual([overlay]);
    patch.parameters.centerX = 999;
    expect(controller.overlays()[0]?.patch.parameters).toEqual({ centerX: 180, centerY: 220 });

    expect(controller.commit(context(), target.subMaskId, overlay?.patch ?? {})).toEqual({
      key,
      patch: { parameters: { centerX: 180, centerY: 220 } },
      subMaskId: target.subMaskId,
      type: 'commit-mask-shape',
    });
    expect(controller.end(context())).toBe(key);
    expect(controller.isActive()).toBe(false);
  });

  test('rejects wrong containers, wrong mask ids, and concurrent pointer ownership', () => {
    const controller = createViewerMaskShapeInteractionController();
    expect(
      controller.begin(context(), { ...target, containerId: 'layer:other' }, pointer, 'mask-shape:wrong'),
    ).toBeNull();
    const key = controller.begin(context(), target, pointer, 'mask-shape:owner');
    expect(key).not.toBeNull();
    expect(
      controller.begin(context(), target, { pointerId: 15, pointerType: 'touch' }, 'mask-shape:stolen'),
    ).toBeNull();
    expect(controller.preview(context(), 'radial:other', { opacity: 20 })).toBeNull();
    expect(controller.commit(context(), 'radial:other', { opacity: 20 })).toBeNull();
    expect(controller.cancel()).toBe(key);
  });

  test('invalidates on every source/session/graph/geometry/container key dimension', () => {
    const replacements: Partial<ViewerMaskShapeCurrentContext>[] = [
      { active: false },
      { containerId: 'layer:2' },
      { containerKind: 'aiPatches' },
      { geometryEpoch: 8 },
      { imageSessionId: 'image-session:B:1' },
      { sourceIdentity: '/fixture/B.ARW' },
      { sourceRevision: 'graph:A:2' },
    ];
    for (const [index, replacement] of replacements.entries()) {
      const controller = createViewerMaskShapeInteractionController();
      const key = controller.begin(context(), target, pointer, `mask-shape:${String(index)}`);
      expect(key).not.toBeNull();
      expect(controller.synchronize(context(replacement))).toBe(key);
      expect(controller.isActive()).toBe(false);
    }
  });

  test('never revives predecessor A after A to B to successor A', () => {
    const controller = createViewerMaskShapeInteractionController();
    const predecessor = controller.begin(context(), target, pointer, 'mask-shape:A:old');
    if (predecessor === null) throw new Error('expected predecessor session');
    expect(controller.preview(context(), target.subMaskId, { opacity: 55 })).not.toBeNull();
    expect(
      controller.synchronize(context({ imageSessionId: 'image-session:B:1', sourceIdentity: '/fixture/B.ARW' })),
    ).toBe(predecessor);
    const successorA = context({ imageSessionId: 'image-session:A:2', sourceRevision: 'graph:A:2' });
    expect(isViewerMaskShapeKeyCurrent(predecessor, successorA)).toBe(false);
    expect(controller.preview(successorA, target.subMaskId, { opacity: 40 })).toBeNull();
    expect(controller.commit(successorA, target.subMaskId, { opacity: 40 })).toBeNull();

    const successorKey = controller.begin(
      successorA,
      target,
      { pointerId: 22, pointerType: 'touch' },
      'mask-shape:A:new',
    );
    expect(successorKey?.imageSessionId).toBe('image-session:A:2');
    expect(controller.commit(successorA, target.subMaskId, { opacity: 40 })?.key).toBe(successorKey);
  });

  test('cancel removes the draft without manufacturing a command or accepting late input', () => {
    const controller = createViewerMaskShapeInteractionController();
    const key = controller.begin(context(), target, pointer, 'mask-shape:cancel');
    expect(controller.preview(context(), target.subMaskId, { opacity: 65 })).not.toBeNull();
    expect(controller.cancel()).toBe(key);
    expect(controller.overlays()).toEqual([]);
    expect(controller.commit(context(), target.subMaskId, { opacity: 65 })).toBeNull();
    expect(controller.end(context())).toBeNull();
  });
});
