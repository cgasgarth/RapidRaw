import { beforeEach, describe, expect, test } from 'bun:test';

import { createEditorImageSession, useEditorStore } from '../../../src/store/useEditorStore';
import { publishAdjustmentSnapshot } from '../../../src/utils/adjustmentSnapshots';
import { DetailsAdjustment, INITIAL_ADJUSTMENTS } from '../../../src/utils/adjustments';
import {
  buildDetailEditTransaction,
  DETAIL_BOOLEAN_NODE_ADJUSTMENTS,
  DETAIL_NODE_ADJUSTMENTS,
  DETAIL_NUMBER_NODE_ADJUSTMENTS,
  type DetailCommitIdentity,
  isDetailBooleanNodeAdjustment,
  isDetailNodeAdjustment,
  isDetailNumberNodeAdjustment,
} from '../../../src/utils/detailEditTransaction';
import { legacyAdjustmentsToEditDocumentV2 } from '../../../src/utils/editDocumentV2';
import {
  EditorPersistenceEffectRunner,
  type EditorPersistenceExecution,
} from '../../../src/utils/editorPersistenceEffectRunner';
import { hydrateImageOpenEditDocumentV2 } from '../../../src/utils/imageOpenAdjustmentHydration';

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
    for (const field of DETAIL_NUMBER_NODE_ADJUSTMENTS) {
      expect(isDetailNodeAdjustment(field)).toBeTrue();
      expect(isDetailNumberNodeAdjustment(field)).toBeTrue();
      expect(buildDetailEditTransaction(state, identity(), field, 0, `detail-${field}`).operations).toEqual([
        { nodeType: 'detail_denoise_dehaze', patch: { [field]: 0 }, type: 'patch-edit-document-node' },
      ]);
    }
    for (const field of DETAIL_BOOLEAN_NODE_ADJUSTMENTS) {
      expect(isDetailNodeAdjustment(field)).toBeTrue();
      expect(isDetailBooleanNodeAdjustment(field)).toBeTrue();
      expect(buildDetailEditTransaction(state, identity(), field, true, `detail-${field}`).operations).toEqual([
        { nodeType: 'detail_denoise_dehaze', patch: { [field]: true }, type: 'patch-edit-document-node' },
      ]);
    }
    expect(DETAIL_NODE_ADJUSTMENTS).toContain(DetailsAdjustment.DeblurEnabled);
    expect(DETAIL_NODE_ADJUSTMENTS).toContain(DetailsAdjustment.DeblurSigmaPx);
    expect(DETAIL_NODE_ADJUSTMENTS).toContain(DetailsAdjustment.DeblurStrength);
    expect(DETAIL_NODE_ADJUSTMENTS).toContain(DetailsAdjustment.SharpnessThreshold);

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

  test('commits local contrast through node authority and Undo restores the lowered state', () => {
    const state = useEditorStore.getState();
    const beforeDetail = state.editDocumentV2.nodes.detail_denoise_dehaze;
    const beforeTone = state.editDocumentV2.nodes.scene_global_color_tone;
    const result = state.applyEditTransaction(
      buildDetailEditTransaction(state, identity(), DetailsAdjustment.LocalContrastRadiusPx, 42, 'local-radius'),
    );

    expect(result.changedKeys).toEqual(['localContrastRadiusPx']);
    expect(result.afterEditDocumentV2.nodes.detail_denoise_dehaze.params.localContrastRadiusPx).toBe(42);
    expect(result.afterEditDocumentV2.nodes.detail_denoise_dehaze).not.toBe(beforeDetail);
    expect(result.afterEditDocumentV2.nodes.scene_global_color_tone).toBe(beforeTone);
    expect(useEditorStore.getState().adjustments.localContrastRadiusPx).toBe(42);

    useEditorStore.getState().undo();
    expect(useEditorStore.getState().adjustments.localContrastRadiusPx).toBe(24);
    expect(useEditorStore.getState().editDocumentV2.nodes.detail_denoise_dehaze.params.localContrastRadiusPx).toBe(24);
  });

  test('carries sharpness-threshold node authority through Undo, Redo, save execution, and reopen', async () => {
    const before = useEditorStore.getState();
    const beforeDocument = before.editDocumentV2;
    before.applyEditTransaction(
      buildDetailEditTransaction(before, identity(), DetailsAdjustment.SharpnessThreshold, 42, 'save-threshold'),
    );
    expect(useEditorStore.getState().editDocumentV2.nodes.detail_denoise_dehaze.params.sharpnessThreshold).toBe(42);
    expect(useEditorStore.getState().editDocumentV2.extensions.legacyAdjustments).not.toHaveProperty(
      'sharpnessThreshold',
    );
    useEditorStore.getState().undo();
    expect(useEditorStore.getState().editDocumentV2.nodes.detail_denoise_dehaze.params.sharpnessThreshold).toBe(15);
    useEditorStore.getState().redo();
    expect(useEditorStore.getState().editDocumentV2.nodes.detail_denoise_dehaze.params.sharpnessThreshold).toBe(42);
    const committed = useEditorStore.getState();
    const executions: EditorPersistenceExecution[] = [];
    const runner = new EditorPersistenceEffectRunner({
      clearTimer: () => {},
      execute: async (execution) => {
        executions.push(execution);
        return { path: execution.path, sidecarRevision: `sha256:${'a'.repeat(64)}` };
      },
      onAccepted: () => {},
      setTimer: (callback) => {
        callback();
        return 0;
      },
    });
    runner.installSession({
      adjustmentRevision: 0,
      adjustments: { ...committed.adjustments, sharpnessThreshold: 15 },
      editDocumentV2: beforeDocument,
      imageSessionId: session.id,
      path: sourcePath,
      sessionGeneration: session.generation,
    });
    if (committed.lastEditApplicationReceipt === null) throw new Error('missing committed detail receipt');
    runner.submitCommitted({
      adjustmentRevision: committed.adjustmentRevision,
      adjustments: committed.adjustments,
      editDocumentV2: committed.editDocumentV2,
      imageSessionId: session.id,
      interactionActive: false,
      multiSelection: null,
      path: sourcePath,
      receipt: committed.lastEditApplicationReceipt,
      sessionGeneration: session.generation,
    });
    await Promise.resolve();
    await Promise.resolve();

    expect(executions).toHaveLength(1);
    expect(executions[0]?.editDocumentV2.nodes.detail_denoise_dehaze.params.sharpnessThreshold).toBe(42);
    const reopened = hydrateImageOpenEditDocumentV2(
      { adjustments: executions[0]?.adjustments, editDocumentV2: executions[0]?.editDocumentV2 },
      executions[0]?.adjustments ?? committed.adjustments,
    );
    expect(reopened.nodes.detail_denoise_dehaze.params.sharpnessThreshold).toBe(42);
    expect(reopened).toEqual(committed.editDocumentV2);
  });

  test('commits through the canonical selected-image fallback session', () => {
    useEditorStore.setState({
      finalPreviewUrl: 'blob:fallback-detail-before',
      imageSession: null,
      imageSessionId: 24,
    });
    const state = useEditorStore.getState();
    const fallbackIdentity: DetailCommitIdentity = {
      adjustmentRevision: state.adjustmentRevision,
      imageSessionId: 'editor-image-session:24',
      sourceIdentity: sourcePath,
    };
    const result = state.applyEditTransaction(
      buildDetailEditTransaction(state, fallbackIdentity, 'sharpness', 18, 'fallback-detail'),
    );
    expect(result).toMatchObject({ changedKeys: ['sharpness'], noOp: false });
    expect(useEditorStore.getState().lastEditApplicationReceipt).toMatchObject({
      imageSessionId: fallbackIdentity.imageSessionId,
      transactionId: 'fallback-detail',
    });
    expect(useEditorStore.getState().history).toHaveLength(2);
    expect(useEditorStore.getState().finalPreviewUrl).toBeNull();
    useEditorStore.getState().undo();
    expect(useEditorStore.getState().adjustments.sharpness).toBe(0);
    expect(() =>
      buildDetailEditTransaction({ ...state, imageSessionId: 25 }, fallbackIdentity, 'sharpness', 20, 'stale-fallback'),
    ).toThrow('detail_transaction.stale_session');
  });
});
