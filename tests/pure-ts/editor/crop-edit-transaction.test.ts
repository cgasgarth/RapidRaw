import { beforeEach, describe, expect, test } from 'bun:test';
import {
  type EditDocumentGeometryCropV2,
  editDocumentGeometryV2Schema,
} from '../../../packages/rawengine-schema/src/editDocumentV2';
import type { CropStraightenSessionIdentity } from '../../../src/components/panel/editor/cropStraightenController';
import { createEditorImageSession, useEditorStore } from '../../../src/store/useEditorStore';
import { publishAdjustmentSnapshot } from '../../../src/utils/adjustmentSnapshots';
import { INITIAL_ADJUSTMENTS } from '../../../src/utils/adjustments';
import { buildCropEditTransaction } from '../../../src/utils/cropEditTransaction';
import { createDefaultEditDocumentV2, patchEditDocumentV2Node } from '../../../src/utils/editDocumentV2';

const sourcePath = '/fixture/crop-target.ARW';
const sourceRevision = 'viewer-graph:crop:1';
const operationGeneration = 23;
const session = createEditorImageSession({ generation: 23, path: sourcePath, source: 'cache' });
const identity = (overrides: Partial<CropStraightenSessionIdentity> = {}): CropStraightenSessionIdentity => ({
  geometryEpoch: 7,
  imageSessionId: session.id,
  operationGeneration,
  sourceIdentity: sourcePath,
  sourceRevision,
  tool: 'crop',
  ...overrides,
});
const crop: EditDocumentGeometryCropV2 = {
  height: 0.6,
  unit: 'normalized',
  width: 0.6,
  x: 0.1,
  y: 0.1,
};
const selectedImage = {
  exif: null,
  height: 3000,
  isRaw: true,
  isReady: true,
  metadata: null,
  originalUrl: null,
  path: sourcePath,
  rawDevelopmentReport: null,
  thumbnailUrl: '',
  width: 4000,
};
const transactionState = () => ({
  ...useEditorStore.getState(),
  operationGeneration,
  sourceRevision,
});

describe('crop edit transaction', () => {
  beforeEach(() => {
    const adjustments = { ...structuredClone(INITIAL_ADJUSTMENTS), exposure: 0.4 };
    const editDocumentV2 = patchEditDocumentV2Node(createDefaultEditDocumentV2(), 'scene_global_color_tone', {
      exposure: adjustments.exposure,
    });
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

  test('commits one geometry-node revision while preserving unrelated nodes and Undo', () => {
    const state = useEditorStore.getState();
    const request = buildCropEditTransaction(transactionState(), identity(), crop, 'crop-commit');
    const result = state.applyEditTransaction(request);

    expect(request.operations).toEqual([{ nodeType: 'geometry', patch: { crop }, type: 'patch-edit-document-node' }]);
    expect(result).toMatchObject({
      changedKeys: ['crop'],
      nextAdjustmentRevision: 1,
      noOp: false,
      source: 'geometry-tool',
    });
    expect(result.afterEditDocumentV2.nodes['scene_global_color_tone']).toEqual(
      result.beforeEditDocumentV2.nodes['scene_global_color_tone'],
    );
    const geometry = editDocumentGeometryV2Schema.parse(result.afterEditDocumentV2.nodes['geometry']?.params);
    expect(geometry.crop).toEqual(crop);
    expect(result.afterEditDocumentV2.geometry).toEqual(geometry);
    expect(result.invalidatedStages).toContain('geometry');
    expect(useEditorStore.getState().history).toHaveLength(2);
    expect(useEditorStore.getState().lastEditApplicationReceipt).toMatchObject({
      adjustmentRevision: 1,
      persistence: 'commit',
      source: 'geometry-tool',
    });
    expect(useEditorStore.getState().adjustmentSnapshot.editDocumentV2).toBe(useEditorStore.getState().editDocumentV2);

    useEditorStore.getState().undo();
    expect(useEditorStore.getState().editDocumentV2.geometry.crop).toBeNull();
    expect(useEditorStore.getState().editDocumentV2.nodes['scene_global_color_tone']!.params['exposure']).toBe(0.4);
  });

  test('preserves exact no-ops and rejects stale source, session, graph, generation, tool, and revision', () => {
    useEditorStore.getState().hydrateEditorRenderAuthority((state) => {
      const editDocumentV2 = patchEditDocumentV2Node(state.editDocumentV2, 'geometry', { crop });
      return {
        adjustmentRevision: state.adjustmentRevision,
        editDocumentV2,
        history: [editDocumentV2],
        historyIndex: 0,
      };
    });
    const state = useEditorStore.getState();
    const noOp = state.applyEditTransaction(
      buildCropEditTransaction(transactionState(), identity(), crop, 'crop-no-op'),
    );
    expect(noOp.noOp).toBe(true);
    expect(useEditorStore.getState().adjustmentRevision).toBe(0);
    expect(useEditorStore.getState().history).toHaveLength(1);
    expect(useEditorStore.getState().lastEditApplicationReceipt).toBeNull();

    const staleCases: Array<[CropStraightenSessionIdentity, string]> = [
      [identity({ sourceIdentity: '/fixture/stale.ARW' }), 'crop_transaction.stale_source'],
      [identity({ imageSessionId: 'editor-image-session:stale' }), 'crop_transaction.stale_session'],
      [identity({ sourceRevision: 'viewer-graph:stale' }), 'crop_transaction.stale_graph'],
      [identity({ operationGeneration: operationGeneration - 1 }), 'crop_transaction.stale_generation'],
      [identity({ tool: 'straighten' }), 'crop_transaction.invalid_tool'],
    ];
    for (const [staleIdentity, error] of staleCases) {
      expect(() => buildCropEditTransaction(transactionState(), staleIdentity, crop, 'crop-stale')).toThrow(error);
    }

    const nextCrop = { ...crop, width: crop.width - 100 };
    const staleRevision = buildCropEditTransaction(transactionState(), identity(), nextCrop, 'crop-stale-revision');
    state.applyEditTransaction({
      baseAdjustmentRevision: 0,
      history: 'single-entry',
      imageSessionId: session.id,
      operations: [{ patch: { exposure: 0.5 }, type: 'patch-adjustments' }],
      persistence: 'commit',
      source: 'manual-control',
      transactionId: 'newer-edit',
    });
    expect(() => useEditorStore.getState().applyEditTransaction(staleRevision)).toThrow(
      'edit_transaction.stale_base:0:1',
    );
  });
});
