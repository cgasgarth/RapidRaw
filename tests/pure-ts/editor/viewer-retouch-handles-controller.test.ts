import { describe, expect, test } from 'bun:test';
import {
  createViewerRetouchHandlesController,
  isViewerRetouchSessionCurrent,
  type ViewerRetouchCurrentContext,
} from '../../../src/components/panel/editor/viewerRetouchHandlesController';

const current = (overrides: Partial<ViewerRetouchCurrentContext> = {}): ViewerRetouchCurrentContext => ({
  active: true,
  geometryEpoch: 4,
  imageSessionId: 'image-session:12:a',
  layerId: 'layer:retouch',
  layerRevision: 'layer-revision:7',
  mode: 'clone',
  sourceRevision: 'graph:9',
  toolId: 'retouch-handles',
  ...overrides,
});
const pointer = (id = 7, type: 'mouse' | 'pen' | 'touch' = 'mouse', pressure = 0) => ({ id, pressure, type });

describe('viewer retouch handles controller', () => {
  test('uses the exact live overlay point for its clone command', () => {
    const controller = createViewerRetouchHandlesController();
    expect(controller.begin(current(), 'sourcePoint', pointer(), { x: 0.2, y: 0.3 })).toBe(true);
    expect(controller.move(pointer(7, 'pen', 0.7), { x: 0.25, y: 0.35 })).toBe(true);
    const overlay = controller.overlayOverride();
    const command = controller.end(current(), pointer(7, 'pen', 0.7), { x: 0.25, y: 0.35 });
    expect(command).toMatchObject({
      handle: 'sourcePoint',
      kind: 'update-clone-handle',
      point: { x: 0.25, y: 0.35 },
    });
    expect(overlay?.point).toEqual(command?.point);
    expect(overlay?.pointer).toEqual({ id: 7, pressure: 0.7, type: 'pen' });
  });

  test('maps Alt placement and remove placement to their semantic handles', () => {
    const clone = createViewerRetouchHandlesController();
    expect(clone.place(current(), true, pointer(2, 'touch', 0.5), { x: 0.1, y: 0.2 })).toMatchObject({
      handle: 'sourcePoint',
      kind: 'update-clone-handle',
    });
    const target = createViewerRetouchHandlesController();
    expect(target.place(current({ mode: 'heal' }), false, pointer(), { x: 0.7, y: 0.8 })).toMatchObject({
      handle: 'targetPoint',
      kind: 'update-clone-handle',
    });
    const remove = createViewerRetouchHandlesController();
    expect(remove.place(current({ mode: 'remove' }), true, pointer(), { x: 0.4, y: 0.6 })).toMatchObject({
      kind: 'update-remove-target',
      point: { x: 0.4, y: 0.6 },
    });
  });

  test('owns one pointer and one pending mutation', () => {
    const controller = createViewerRetouchHandlesController();
    controller.begin(current(), 'targetPoint', pointer(), { x: 0.2, y: 0.3 });
    expect(controller.begin(current(), 'sourcePoint', pointer(8), { x: 0.4, y: 0.5 })).toBe(false);
    expect(controller.move(pointer(8), { x: 0.6, y: 0.7 })).toBe(false);
    const command = controller.end(current(), pointer(), { x: 0.3, y: 0.4 });
    if (command === null) throw new Error('expected command');
    expect(controller.begin(current(), 'sourcePoint', pointer(8), { x: 0.4, y: 0.5 })).toBe(false);
    expect(controller.receive(command.key, current())).toBe(true);
    expect(controller.begin(current(), 'sourcePoint', pointer(8), { x: 0.4, y: 0.5 })).toBe(true);
  });

  test('rejects late success and failure across every identity dimension including A to B to A', () => {
    const successors = [
      current({ imageSessionId: 'image-session:13:b' }),
      current({ imageSessionId: 'image-session:14:a' }),
      current({ sourceRevision: 'graph:10' }),
      current({ geometryEpoch: 5 }),
      current({ layerId: 'layer:other' }),
      current({ layerRevision: 'layer-revision:8' }),
      current({ mode: 'heal' }),
      current({ active: false }),
    ];
    for (const successor of successors) {
      const controller = createViewerRetouchHandlesController();
      const command = controller.place(current(), false, pointer(), { x: 0.2, y: 0.3 });
      if (command === null) throw new Error('expected command');
      expect(isViewerRetouchSessionCurrent(command.key, successor)).toBe(false);
      expect(controller.receive(command.key, successor)).toBe(false);

      const failed = createViewerRetouchHandlesController();
      const failedCommand = failed.place(current(), false, pointer(), { x: 0.2, y: 0.3 });
      if (failedCommand === null) throw new Error('expected command');
      expect(failed.fail(failedCommand.key, successor)).toBe(false);
    }
  });

  test('cancels active and pending interactions for capture loss, blur, Escape, and unmount', () => {
    for (const _reason of ['lostpointercapture', 'pointercancel', 'blur', 'escape', 'unmount']) {
      const controller = createViewerRetouchHandlesController();
      controller.begin(current(), 'sourcePoint', pointer(), { x: 0.2, y: 0.3 });
      controller.cancel();
      expect(controller.overlayOverride()).toBeNull();
      expect(controller.end(current(), pointer(), { x: 0.4, y: 0.5 })).toBeNull();
      expect(controller.place(current(), false, pointer(), { x: 0.4, y: 0.5 })).not.toBeNull();
      controller.cancel();
      expect(controller.begin(current(), 'targetPoint', pointer(), { x: 0.6, y: 0.7 })).toBe(true);
    }
  });
});
