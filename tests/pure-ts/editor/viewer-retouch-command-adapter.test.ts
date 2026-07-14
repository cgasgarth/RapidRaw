import { describe, expect, test } from 'bun:test';
import type { ViewerAdjustmentCommandServices } from '../../../src/components/panel/editor/viewerAdjustmentCommandService';
import { createViewerRetouchCommandAdapter } from '../../../src/components/panel/editor/viewerRetouchCommandAdapter';
import {
  createViewerRetouchHandlesController,
  type ViewerRetouchCurrentContext,
} from '../../../src/components/panel/editor/viewerRetouchHandlesController';
import type { RetouchRemoveSource } from '../../../src/utils/adjustments';

const current = (overrides: Partial<ViewerRetouchCurrentContext> = {}): ViewerRetouchCurrentContext => ({
  active: true,
  geometryEpoch: 4,
  imageSessionId: 'image-session:a',
  layerId: 'layer:1',
  layerRevision: 'layer-revision:7',
  mode: 'clone',
  sourceRevision: 'graph:9',
  toolId: 'retouch-handles',
  ...overrides,
});
const removeSource: RetouchRemoveSource = {
  generator: 'local_patch_fill_v1',
  generatorVersion: 1,
  searchRadiusMultiplier: 3,
  seed: 7,
  status: 'ready',
  targetMaskId: 'remove-target',
};

describe('viewer retouch command adapter', () => {
  test('routes exact clone and remove commands through the typed adjustment authority', () => {
    const calls: string[] = [];
    const adjustments: ViewerAdjustmentCommandServices = {
      appendPointColorSample: () => undefined,
      commitPointColorPicker: () => undefined,
      commitToneEqualizerPicker: () => undefined,
      updateSubMask: () => undefined,
      updateRetouchCloneHandle: (layerId, handle, point, size) =>
        calls.push(`clone:${layerId}:${handle}:${String(point.x)}:${String(size.width)}`),
      updateRetouchRemoveTarget: (layerId, source, point, size) =>
        calls.push(`remove:${layerId}:${source.targetMaskId}:${String(point.y)}:${String(size.height)}`),
    };
    const adapter = createViewerRetouchCommandAdapter(adjustments);

    const cloneController = createViewerRetouchHandlesController();
    const clone = cloneController.place(current(), true, { id: 1, pressure: 0, type: 'mouse' }, { x: 0.2, y: 0.3 });
    if (clone === null) throw new Error('expected clone command');
    expect(
      adapter.commit(clone, { current: current(), imageSize: { height: 600, width: 800 }, removeSource: null }),
    ).toMatchObject({ handle: 'sourcePoint', mode: 'clone', point: { x: 0.2, y: 0.3 } });

    const removeCurrent = current({ mode: 'remove' });
    const removeController = createViewerRetouchHandlesController();
    const remove = removeController.place(
      removeCurrent,
      false,
      { id: 2, pressure: 0.5, type: 'touch' },
      { x: 0.4, y: 0.6 },
    );
    if (remove === null) throw new Error('expected remove command');
    expect(
      adapter.commit(remove, {
        current: removeCurrent,
        imageSize: { height: 600, width: 800 },
        removeSource,
      }),
    ).toMatchObject({ handle: 'targetPoint', mode: 'remove', point: { x: 0.4, y: 0.6 } });
    expect(calls).toEqual(['clone:layer:1:sourcePoint:0.2:800', 'remove:layer:1:remove-target:0.6:600']);
  });

  test('rejects stale identity and missing remove authority without dispatching', () => {
    let dispatches = 0;
    const adjustments: ViewerAdjustmentCommandServices = {
      appendPointColorSample: () => undefined,
      commitPointColorPicker: () => undefined,
      commitToneEqualizerPicker: () => undefined,
      updateSubMask: () => undefined,
      updateRetouchCloneHandle: () => {
        dispatches += 1;
      },
      updateRetouchRemoveTarget: () => {
        dispatches += 1;
      },
    };
    const adapter = createViewerRetouchCommandAdapter(adjustments);
    const controller = createViewerRetouchHandlesController();
    const command = controller.place(current(), false, { id: 1, pressure: 0, type: 'pen' }, { x: 0.2, y: 0.3 });
    if (command === null) throw new Error('expected command');
    expect(
      adapter.commit(command, {
        current: current({ layerRevision: 'layer-revision:8' }),
        imageSize: { height: 600, width: 800 },
        removeSource: null,
      }),
    ).toBeNull();

    const removeCurrent = current({ mode: 'remove' });
    const removeController = createViewerRetouchHandlesController();
    const remove = removeController.place(
      removeCurrent,
      false,
      { id: 2, pressure: 0, type: 'mouse' },
      { x: 0.4, y: 0.6 },
    );
    if (remove === null) throw new Error('expected remove command');
    expect(
      adapter.commit(remove, {
        current: removeCurrent,
        imageSize: { height: 600, width: 800 },
        removeSource: null,
      }),
    ).toBeNull();
    expect(dispatches).toBe(0);
  });
});
