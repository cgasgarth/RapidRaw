import { beforeEach, describe, expect, test } from 'bun:test';
import {
  createViewerRetouchHandlesController,
  type ViewerRetouchCurrentContext,
} from '../../../src/components/panel/editor/viewerRetouchHandlesController';
import { Mask, SubMaskMode } from '../../../src/components/panel/right/layers/Masks';
import { createEditorImageSession, useEditorStore } from '../../../src/store/useEditorStore';
import { publishAdjustmentSnapshot } from '../../../src/utils/adjustmentSnapshots';
import { INITIAL_ADJUSTMENTS, type MaskContainer } from '../../../src/utils/adjustments';
import { legacyAdjustmentsToEditDocumentV2 } from '../../../src/utils/editDocumentV2';
import {
  buildRetouchHandleEditTransaction,
  createRetouchLayerRevision,
} from '../../../src/utils/retouchHandleEditTransaction';

const sourcePath = '/fixture/retouch.ARW';
const sourceRevision = 'viewer-graph:retouch:1';
const geometryEpoch = 11;
const session = createEditorImageSession({ generation: 8, path: sourcePath, source: 'cache' });
const imageSize = { height: 3000, width: 4000 };
const layer = (): MaskContainer => ({
  adjustments: {},
  blendMode: 'normal',
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
      mode: SubMaskMode.Additive,
      opacity: 100,
      parameters: { centerX: 2000, centerY: 1500, radiusX: 40, radiusY: 40 },
      type: Mask.Radial,
      visible: true,
    },
  ],
  visible: true,
});
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
const context = (retouchLayer: MaskContainer, overrides: Partial<ViewerRetouchCurrentContext> = {}) => ({
  active: true,
  geometryEpoch,
  imageSessionId: session.id,
  layerId: retouchLayer.id,
  layerRevision: createRetouchLayerRevision(retouchLayer, imageSize),
  mode: 'heal' as const,
  sourceIdentity: sourcePath,
  sourceRevision,
  toolId: 'retouch-handles' as const,
  ...overrides,
});

describe('retouch handle edit transaction', () => {
  beforeEach(() => {
    const adjustments = { ...structuredClone(INITIAL_ADJUSTMENTS), exposure: 0.4, masks: [layer()] };
    const editDocumentV2 = legacyAdjustmentsToEditDocumentV2(adjustments);
    useEditorStore.getState().hydrateEditorRenderAuthority({
      adjustmentRevision: 0,
      adjustmentSnapshot: publishAdjustmentSnapshot(null, adjustments, editDocumentV2),
      adjustments,
      editDocumentV2,
      history: [adjustments],
      historyCheckpoints: [],
      historyIndex: 0,
      imageSession: session,
      lastEditApplicationReceipt: null,
      selectedImage,
    });
  });

  test('commits one exact target revision with persistence, render geometry parity, and Undo', () => {
    const retouchLayer = useEditorStore.getState().adjustments.masks[0]!;
    const controller = createViewerRetouchHandlesController();
    const command = controller.place(
      context(retouchLayer),
      false,
      { id: 7, pressure: 0.6, type: 'pen' },
      { x: 0.7, y: 0.6 },
    );
    if (command === null) throw new Error('expected retouch command');
    const result = useEditorStore
      .getState()
      .applyEditTransaction(
        buildRetouchHandleEditTransaction(
          { ...useEditorStore.getState(), geometryEpoch, sourceRevision },
          command,
          imageSize,
          'retouch-handle:commit',
        ),
      );
    expect(result).toMatchObject({ changedKeys: ['masks'], noOp: false, source: 'layer-command' });
    expect(result.after.masks[0]?.retouchCloneSource?.targetPoint).toEqual({ x: 0.7, y: 0.6 });
    expect(result.after.masks[0]?.subMasks[0]?.parameters).toMatchObject({ centerX: 2800, centerY: 1800 });
    expect(useEditorStore.getState().lastEditApplicationReceipt).toMatchObject({
      persistence: 'commit',
      transactionId: 'retouch-handle:commit',
    });
    expect(useEditorStore.getState().history).toHaveLength(2);
    useEditorStore.getState().undo();
    expect(useEditorStore.getState().adjustments.masks[0]?.retouchCloneSource?.targetPoint).toEqual({ x: 0.5, y: 0.5 });
    expect(useEditorStore.getState().adjustments.exposure).toBe(0.4);
  });

  test('rejects stale source, session, graph, geometry, layer revision, mode, and duplicates', () => {
    const state = { ...useEditorStore.getState(), geometryEpoch, sourceRevision };
    const retouchLayer = state.adjustments.masks[0]!;
    const controller = createViewerRetouchHandlesController();
    const command = controller.place(
      context(retouchLayer),
      true,
      { id: 1, pressure: 0, type: 'touch' },
      { x: 0.1, y: 0.2 },
    );
    if (command === null) throw new Error('expected retouch command');
    const build = (nextState: typeof state) =>
      buildRetouchHandleEditTransaction(nextState, command, imageSize, 'retouch-handle:stale');
    expect(() => build({ ...state, imageSession: { id: 'successor' } })).toThrow('stale_image_session');
    expect(() => build({ ...state, selectedImage: { path: '/fixture/other.ARW' } })).toThrow('stale_source');
    expect(() => build({ ...state, sourceRevision: 'viewer-graph:retouch:2' })).toThrow('stale_source_revision');
    expect(() => build({ ...state, geometryEpoch: geometryEpoch + 1 })).toThrow('stale_geometry');
    expect(() =>
      build({
        ...state,
        adjustments: {
          ...state.adjustments,
          masks: state.adjustments.masks.map((mask) => ({
            ...mask,
            retouchCloneSource:
              mask.retouchCloneSource === undefined
                ? undefined
                : { ...mask.retouchCloneSource, scale: mask.retouchCloneSource.scale + 0.1 },
          })),
        },
      }),
    ).toThrow('stale_layer_revision');
    expect(() =>
      build({
        ...state,
        adjustments: {
          ...state.adjustments,
          masks: state.adjustments.masks.map((mask) => ({ ...mask, opacity: 75 })),
        },
      }),
    ).toThrow('stale_layer_revision');
    expect(() =>
      build({
        ...state,
        adjustments: {
          ...state.adjustments,
          masks: state.adjustments.masks.map((mask) => ({
            ...mask,
            subMasks: [
              {
                ...structuredClone(mask.subMasks[0]!),
                id: 'target:replacement',
                parameters: { ...mask.subMasks[0]!.parameters, centerX: 100, centerY: 200 },
              },
              ...mask.subMasks,
            ],
          })),
        },
      }),
    ).toThrow('stale_layer_revision');
    expect(() =>
      build({
        ...state,
        adjustments: {
          ...state.adjustments,
          masks: state.adjustments.masks.map((mask) => ({ ...mask, retouchCloneSource: undefined })),
        },
      }),
    ).toThrow();
    expect(() =>
      build({ ...state, adjustments: { ...state.adjustments, masks: [retouchLayer, structuredClone(retouchLayer)] } }),
    ).toThrow('missing_or_duplicate_layer');
  });
});
