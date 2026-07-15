import { beforeEach, describe, expect, test } from 'bun:test';

import { createEditorImageSession, useEditorStore } from '../../../src/store/useEditorStore';
import { publishAdjustmentSnapshot } from '../../../src/utils/adjustmentSnapshots';
import { INITIAL_ADJUSTMENTS } from '../../../src/utils/adjustments';
import { legacyAdjustmentsToEditDocumentV2 } from '../../../src/utils/editDocumentV2';
import { buildHistoryNavigationEditTransaction } from '../../../src/utils/historyNavigationEditTransaction';

const path = '/tmp/history-navigation.ARW';

const commitExposure = (exposure: number, transactionId: string) => {
  const state = useEditorStore.getState();
  return state.applyEditTransaction({
    baseAdjustmentRevision: state.adjustmentRevision,
    history: 'single-entry',
    imageSessionId: state.imageSession?.id ?? '',
    operations: [{ patch: { exposure }, type: 'patch-adjustments' }],
    persistence: 'commit',
    source: 'manual-control',
    transactionId,
  });
};

describe('history navigation edit transaction', () => {
  beforeEach(() => {
    const adjustments = structuredClone(INITIAL_ADJUSTMENTS);
    const editDocumentV2 = legacyAdjustmentsToEditDocumentV2(adjustments);
    useEditorStore.setState({
      adjustmentRevision: 0,
      adjustmentSnapshot: publishAdjustmentSnapshot(null, adjustments, editDocumentV2),
      adjustments,
      editDocumentV2,
      finalPreviewUrl: null,
      history: [adjustments],
      historyCheckpoints: [],
      historyIndex: 0,
      imageSession: createEditorImageSession({ generation: 42, path, source: 'cache' }),
      imageSessionId: 42,
      lastEditApplicationReceipt: null,
      navigatorPreviewArtifact: null,
      selectedImage: null,
      transformedOriginalUrl: null,
      uncroppedAdjustedPreviewUrl: null,
    });
  });

  test('routes undo, redo, and indexed jumps through revisioned history transactions', () => {
    commitExposure(0.75, 'exposure-075');
    const beforeSecond = useEditorStore.getState();
    beforeSecond.applyEditTransaction({
      baseAdjustmentRevision: beforeSecond.adjustmentRevision,
      history: 'single-entry',
      imageSessionId: beforeSecond.imageSession?.id ?? '',
      operations: [{ patch: { contrast: 18 }, type: 'patch-adjustments' }],
      persistence: 'commit',
      source: 'manual-control',
      transactionId: 'contrast-18',
    });

    useEditorStore.setState({
      finalPreviewUrl: 'blob:stale-final',
      transformedOriginalUrl: 'blob:stale-transform',
      uncroppedAdjustedPreviewUrl: 'blob:stale-uncropped',
    });
    useEditorStore.getState().undo();
    let state = useEditorStore.getState();
    expect(state.adjustmentRevision).toBe(3);
    expect(state.history).toHaveLength(3);
    expect(state.historyIndex).toBe(1);
    expect(state.adjustments.exposure).toBe(0.75);
    expect(state.adjustments.contrast).toBe(0);
    expect(state.lastEditApplicationReceipt).toMatchObject({
      adjustmentRevision: 3,
      baseAdjustmentRevision: 2,
      changedKeys: ['contrast'],
      imageSessionId: state.imageSession?.id,
      persistence: 'commit',
      source: 'history',
    });
    expect(state.finalPreviewUrl).toBeNull();
    expect(state.transformedOriginalUrl).toBeNull();
    expect(state.uncroppedAdjustedPreviewUrl).toBeNull();

    state.redo();
    state = useEditorStore.getState();
    expect(state.adjustmentRevision).toBe(4);
    expect(state.historyIndex).toBe(2);
    expect(state.adjustments.contrast).toBe(18);
    expect(state.lastEditApplicationReceipt).toMatchObject({
      adjustmentRevision: 4,
      baseAdjustmentRevision: 3,
      source: 'history',
    });

    state.goToHistoryIndex(0);
    state = useEditorStore.getState();
    expect(state.adjustmentRevision).toBe(5);
    expect(state.historyIndex).toBe(0);
    expect(state.adjustments.exposure).toBe(0);
    expect(state.adjustments.contrast).toBe(0);
    expect(state.lastEditApplicationReceipt).toMatchObject({
      adjustmentRevision: 5,
      baseAdjustmentRevision: 4,
      changedKeys: expect.arrayContaining(['contrast', 'exposure']),
      source: 'history',
    });
  });

  test('moves across duplicate history entries as an exact no-op without persistence authority or pixel invalidation', () => {
    const adjustments = useEditorStore.getState().adjustments;
    useEditorStore.setState({
      adjustmentRevision: 7,
      finalPreviewUrl: 'blob:current-preview',
      history: [adjustments, structuredClone(adjustments)],
      historyIndex: 1,
      lastEditApplicationReceipt: null,
    });

    useEditorStore.getState().undo();
    const state = useEditorStore.getState();
    expect(state.historyIndex).toBe(0);
    expect(state.adjustmentRevision).toBe(7);
    expect(state.lastEditApplicationReceipt).toBeNull();
    expect(state.finalPreviewUrl).toBe('blob:current-preview');
  });

  test('rejects invalid targets and target metadata on non-navigation transactions', () => {
    const state = useEditorStore.getState();
    expect(() => buildHistoryNavigationEditTransaction(state, -1, 'invalid-history')).toThrow(
      'edit_transaction.invalid_history_target:-1',
    );
    expect(() =>
      state.applyEditTransaction({
        baseAdjustmentRevision: state.adjustmentRevision,
        history: 'none',
        historyTargetIndex: 0,
        imageSessionId: state.imageSession?.id ?? '',
        operations: [{ patch: { exposure: 1 }, type: 'patch-adjustments' }],
        persistence: 'commit',
        source: 'history',
        transactionId: 'misclassified-history',
      }),
    ).toThrow('edit_transaction.history_target_requires_navigation');
  });
});
