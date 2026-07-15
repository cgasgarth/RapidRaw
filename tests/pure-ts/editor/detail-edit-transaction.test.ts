import { beforeEach, describe, expect, test } from 'bun:test';

import { createEditorImageSession, useEditorStore } from '../../../src/store/useEditorStore';
import { publishAdjustmentSnapshot } from '../../../src/utils/adjustmentSnapshots';
import { DetailsAdjustment, INITIAL_ADJUSTMENTS } from '../../../src/utils/adjustments';
import {
  buildDetailEditTransaction,
  DETAIL_NODE_ADJUSTMENTS,
  type DetailCommitIdentity,
  isDetailNodeAdjustment,
} from '../../../src/utils/detailEditTransaction';
import { legacyAdjustmentsToEditDocumentV2 } from '../../../src/utils/editDocumentV2';

const sourcePath = '/fixture/detail-controls.ARW';
const session = createEditorImageSession({ generation: 14, path: sourcePath, source: 'cache' });
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
const identity = (overrides: Partial<DetailCommitIdentity> = {}): DetailCommitIdentity => ({
  adjustmentRevision: 0,
  imageSessionId: session.id,
  sourceIdentity: sourcePath,
  ...overrides,
});

describe('detail edit transaction', () => {
  beforeEach(() => {
    const adjustments = { ...structuredClone(INITIAL_ADJUSTMENTS), exposure: 0.4, flipHorizontal: true };
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

  test('commits one Detail-node sharpness revision while preserving tone, geometry, and Undo', () => {
    const state = useEditorStore.getState();
    const request = buildDetailEditTransaction(state, identity(), 'sharpness', 25, 'detail-sharpness');
    const result = state.applyEditTransaction(request);

    expect(request.operations).toEqual([
      { nodeType: 'detail_denoise_dehaze', patch: { sharpness: 25 }, type: 'patch-edit-document-node' },
    ]);
    expect(result).toMatchObject({
      changedKeys: ['sharpness'],
      nextAdjustmentRevision: 1,
      noOp: false,
      source: 'manual-control',
    });
    expect(result.afterEditDocumentV2.nodes.geometry).toEqual(result.beforeEditDocumentV2.nodes.geometry);
    expect(result.afterEditDocumentV2.nodes.scene_global_color_tone).toEqual(
      result.beforeEditDocumentV2.nodes.scene_global_color_tone,
    );
    expect(result.afterEditDocumentV2.nodes.detail_denoise_dehaze.params.sharpness).toBe(25);
    expect(useEditorStore.getState().history).toHaveLength(2);
    expect(useEditorStore.getState().lastEditApplicationReceipt).toMatchObject({
      adjustmentRevision: 1,
      persistence: 'commit',
      source: 'manual-control',
    });

    useEditorStore.getState().undo();
    expect(useEditorStore.getState().adjustments.sharpness).toBe(0);
    expect(useEditorStore.getState().adjustments.exposure).toBe(0.4);
    expect(useEditorStore.getState().adjustments.flipHorizontal).toBe(true);
  });

  test('owns the migrated Detail keys, exact no-ops, and stale source/session/revision rejection', () => {
    const state = useEditorStore.getState();
    for (const field of DETAIL_NODE_ADJUSTMENTS) {
      expect(isDetailNodeAdjustment(field)).toBeTrue();
      expect(buildDetailEditTransaction(state, identity(), field, 0, `detail-${field}`).operations).toEqual([
        { nodeType: 'detail_denoise_dehaze', patch: { [field]: 0 }, type: 'patch-edit-document-node' },
      ]);
    }
    for (const field of [
      DetailsAdjustment.DeblurStrength,
      DetailsAdjustment.SharpnessThreshold,
      DetailsAdjustment.Structure,
    ]) {
      expect(isDetailNodeAdjustment(field)).toBeFalse();
    }

    const noOp = state.applyEditTransaction(buildDetailEditTransaction(state, identity(), 'sharpness', 0, 'no-op'));
    expect(noOp.noOp).toBe(true);
    expect(useEditorStore.getState().adjustmentRevision).toBe(0);
    expect(useEditorStore.getState().history).toHaveLength(1);
    expect(useEditorStore.getState().lastEditApplicationReceipt).toBeNull();

    expect(() =>
      buildDetailEditTransaction(
        state,
        identity({ sourceIdentity: '/fixture/stale.ARW' }),
        'sharpness',
        1,
        'stale-source',
      ),
    ).toThrow('detail_transaction.stale_source');
    expect(() =>
      buildDetailEditTransaction(
        state,
        identity({ imageSessionId: 'editor-image-session:stale' }),
        'sharpness',
        1,
        'stale-session',
      ),
    ).toThrow('detail_transaction.stale_session');
    expect(() =>
      buildDetailEditTransaction(state, identity({ adjustmentRevision: 1 }), 'sharpness', 1, 'stale-revision'),
    ).toThrow('detail_transaction.stale_revision');
  });
});
