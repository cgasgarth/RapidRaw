import { beforeEach, describe, expect, test } from 'bun:test';

import { editDocumentLayerV2Schema } from '../../../packages/rawengine-schema/src/editDocumentV2';
import {
  createViewerRetouchHandlesController,
  type ViewerRetouchCurrentContext,
} from '../../../src/components/panel/editor/viewerRetouchHandlesController';
import { createEditorImageSession, useEditorStore } from '../../../src/store/useEditorStore';
import { selectEditDocumentMasks, selectEditDocumentNode } from '../../../src/utils/editDocumentSelectors';
import { createDefaultEditDocumentV2, patchEditDocumentV2Node } from '../../../src/utils/editDocumentV2';
import {
  buildRetouchHandleEditTransaction,
  createRetouchLayerRevision,
} from '../../../src/utils/retouchHandleEditTransaction';

const sourcePath = '/fixture/retouch.ARW';
const sourceRevision = 'viewer-graph:retouch:1';
const geometryEpoch = 11;
const imageSize = { height: 3000, width: 4000 };
const session = createEditorImageSession({ generation: 8, path: sourcePath, source: 'cache' });
const selectedImage = {
  exif: null,
  height: imageSize.height,
  isRaw: true,
  isReady: true,
  metadata: null,
  originalUrl: null,
  path: sourcePath,
  rawDevelopmentReport: null,
  thumbnailUrl: '',
  width: imageSize.width,
};

const currentLayer = editDocumentLayerV2Schema.parse({
  adjustments: {},
  blendMode: 'normal',
  editNodeSchemaVersion: 1,
  editNodes: {
    basic: { enabled: true },
    color: { enabled: true },
    curves: { enabled: true },
    details: { enabled: true },
  },
  id: 'layer:retouch',
  invert: false,
  name: 'Retouch layer',
  opacity: 100,
  retouchCloneSource: {
    featherRadiusPx: 10,
    radiusPx: 40,
    retouchMode: 'heal',
    rotationDegrees: 0,
    scale: 1,
    sourcePoint: { x: 0.2, y: 0.3 },
    targetPoint: { x: 0.5, y: 0.5 },
  },
  subMasks: [
    {
      id: 'target:1',
      invert: false,
      mode: 'additive',
      opacity: 100,
      parameters: { centerX: 2000, centerY: 1500, radiusX: 40, radiusY: 40 },
      type: 'radial',
      visible: true,
    },
  ],
  visible: true,
});

const context = (layer: ReturnType<typeof selectEditDocumentMasks>[number]): ViewerRetouchCurrentContext => ({
  active: true,
  geometryEpoch,
  imageSessionId: session.id,
  layerId: layer.id,
  layerRevision: createRetouchLayerRevision(layer, imageSize),
  mode: 'heal',
  sourceIdentity: sourcePath,
  sourceRevision,
  toolId: 'retouch-handles',
});

describe('retouch handle current-document transaction', () => {
  beforeEach(() => {
    const editDocumentV2 = patchEditDocumentV2Node(
      patchEditDocumentV2Node(createDefaultEditDocumentV2(), 'scene_global_color_tone', { exposure: 0.4 }),
      'layers',
      { masks: [currentLayer] },
    );
    useEditorStore.getState().hydrateEditorRenderAuthority({
      adjustmentRevision: 0,
      editDocumentV2,
      historyCheckpoints: [],
      historyIndex: 0,
      imageSession: session,
      lastEditApplicationReceipt: null,
      selectedImage,
      history: [editDocumentV2],
    });
  });

  test('commits one exact target revision and Undo preserves unrelated tone', () => {
    const layer = selectEditDocumentMasks(useEditorStore.getState().editDocumentV2)[0];
    if (layer === undefined) throw new Error('Expected current retouch layer.');
    const command = createViewerRetouchHandlesController().place(
      context(layer),
      false,
      { id: 7, pressure: 0.6, type: 'pen' },
      { x: 0.7, y: 0.6 },
    );
    if (command === null) throw new Error('Expected retouch command.');
    const state = useEditorStore.getState();
    const result = state.applyEditTransaction(
      buildRetouchHandleEditTransaction(
        { ...state, geometryEpoch, sourceRevision },
        command,
        imageSize,
        'retouch-handle:commit',
      ),
    );
    expect(result.changedKeys).toEqual(['nodes.layers.params.masks']);
    expect(selectEditDocumentMasks(result.after)[0]?.retouchCloneSource?.targetPoint).toEqual({ x: 0.7, y: 0.6 });
    useEditorStore.getState().undo();
    expect(
      selectEditDocumentMasks(useEditorStore.getState().editDocumentV2)[0]?.retouchCloneSource?.targetPoint,
    ).toEqual({
      x: 0.5,
      y: 0.5,
    });
    expect(
      selectEditDocumentNode(useEditorStore.getState().editDocumentV2, 'scene_global_color_tone').params['exposure'],
    ).toBe(0.4);
  });

  test('rejects stale session and source identities before mutation', () => {
    const state = { ...useEditorStore.getState(), geometryEpoch, sourceRevision };
    const layer = selectEditDocumentMasks(state.editDocumentV2)[0];
    if (layer === undefined) throw new Error('Expected current retouch layer.');
    const command = createViewerRetouchHandlesController().place(
      context(layer),
      true,
      { id: 1, pressure: 0, type: 'touch' },
      { x: 0.1, y: 0.2 },
    );
    if (command === null) throw new Error('Expected retouch command.');
    expect(() =>
      buildRetouchHandleEditTransaction(
        { ...state, imageSession: { ...session, id: 'successor' } },
        command,
        imageSize,
        'stale',
      ),
    ).toThrow('stale_image_session');
    expect(() =>
      buildRetouchHandleEditTransaction(
        { ...state, selectedImage: { ...selectedImage, path: '/other.raw' } },
        command,
        imageSize,
        'stale',
      ),
    ).toThrow('stale_source');
  });
});
