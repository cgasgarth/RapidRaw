import { beforeEach, describe, expect, test } from 'bun:test';
import type { Crop } from 'react-image-crop';

import type { CropStraightenSessionIdentity } from '../../../src/components/panel/editor/cropStraightenController';
import { createEditorImageSession, useEditorStore } from '../../../src/store/useEditorStore';
import { publishAdjustmentSnapshot } from '../../../src/utils/adjustmentSnapshots';
import { INITIAL_ADJUSTMENTS } from '../../../src/utils/adjustments';
import { buildCropEditTransaction } from '../../../src/utils/cropEditTransaction';
import { legacyAdjustmentsToEditDocumentV2 } from '../../../src/utils/editDocumentV2';

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
const crop: Crop = { height: 1800, unit: 'px', width: 2400, x: 400, y: 300 };
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
    const editDocumentV2 = legacyAdjustmentsToEditDocumentV2(adjustments);
    useEditorStore.setState({
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
    expect(result.afterEditDocumentV2.nodes.scene_global_color_tone).toEqual(
      result.beforeEditDocumentV2.nodes.scene_global_color_tone,
    );
    expect(result.afterEditDocumentV2.nodes.geometry.params.crop).toEqual(crop);
    expect(result.invalidatedStages).toContain('geometry');
    expect(useEditorStore.getState().history).toHaveLength(2);
    expect(useEditorStore.getState().lastEditApplicationReceipt).toMatchObject({
      adjustmentRevision: 1,
      persistence: 'commit',
      source: 'geometry-tool',
    });

    useEditorStore.getState().undo();
    expect(useEditorStore.getState().adjustments.crop).toBeNull();
    expect(useEditorStore.getState().adjustments.exposure).toBe(0.4);
  });

  test('preserves exact no-ops and rejects stale source, session, graph, generation, tool, and revision', () => {
    useEditorStore.setState((state) => {
      const adjustments = { ...state.adjustments, crop };
      const editDocumentV2 = legacyAdjustmentsToEditDocumentV2(adjustments);
      return {
        adjustmentSnapshot: publishAdjustmentSnapshot(state.adjustmentSnapshot, adjustments, editDocumentV2),
        adjustments,
        editDocumentV2,
        history: [adjustments],
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
