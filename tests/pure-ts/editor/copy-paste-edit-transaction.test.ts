import { beforeEach, describe, expect, test } from 'bun:test';

import { createEditorImageSession, useEditorStore } from '../../../src/store/useEditorStore';
import { publishAdjustmentSnapshot } from '../../../src/utils/adjustmentSnapshots';
import { INITIAL_ADJUSTMENTS } from '../../../src/utils/adjustments';
import {
  buildCopyPasteEditTransaction,
  classifyCopyPasteNativeCompletion,
} from '../../../src/utils/copyPasteEditTransaction';
import { legacyAdjustmentsToEditDocumentV2 } from '../../../src/utils/editDocumentV2';
import { buildEditTransactionPersistenceContext } from '../../../src/utils/editTransaction';

const targetPath = '/fixture/paste-target.ARW';
const session = createEditorImageSession({ generation: 19, path: targetPath, source: 'cache' });
const selectedImage = {
  exif: null,
  height: 3000,
  isRaw: true,
  isReady: true,
  metadata: null,
  originalUrl: null,
  path: targetPath,
  rawDevelopmentReport: null,
  thumbnailUrl: '',
  width: 4000,
};

describe('copy/paste edit transaction', () => {
  beforeEach(() => {
    const adjustments = { ...structuredClone(INITIAL_ADJUSTMENTS), brightness: 0.2, exposure: 0.1 };
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

  test('commits one copy/paste revision without replacing unrelated document fields', () => {
    const state = useEditorStore.getState();
    const request = buildCopyPasteEditTransaction(state, targetPath, { exposure: 0.75 }, 'paste-commit');
    const result = state.applyEditTransaction(request);
    const persistence = buildEditTransactionPersistenceContext(request, result);

    expect(result).toMatchObject({ nextAdjustmentRevision: 1, noOp: false, source: 'copy-paste' });
    expect(request.operations).toEqual([
      {
        nodeType: 'scene_global_color_tone',
        patch: { exposure: 0.75 },
        type: 'patch-edit-document-node',
      },
    ]);
    expect(result.afterEditDocumentV2.nodes.geometry).toEqual(result.beforeEditDocumentV2.nodes.geometry);
    expect(result.afterEditDocumentV2.nodes.scene_global_color_tone.params.exposure).toBe(0.75);
    expect(useEditorStore.getState().adjustments).toMatchObject({ brightness: 0.2, exposure: 0.75 });
    expect(useEditorStore.getState().history).toHaveLength(2);
    expect(useEditorStore.getState().lastEditApplicationReceipt).toMatchObject({
      adjustmentRevision: 1,
      persistence: 'commit',
      source: 'copy-paste',
      transactionId: 'paste-commit',
    });
    expect(classifyCopyPasteNativeCompletion(useEditorStore.getState(), targetPath, persistence)).toBe('current');

    useEditorStore.getState().undo();
    expect(useEditorStore.getState().adjustments).toMatchObject({ brightness: 0.2, exposure: 0.1 });
    expect(useEditorStore.getState().historyIndex).toBe(0);
  });

  test('preserves no-ops and rejects stale source, revision, session, and completion identities', () => {
    const state = useEditorStore.getState();
    const noOp = state.applyEditTransaction(
      buildCopyPasteEditTransaction(state, targetPath, { exposure: 0.1 }, 'paste-no-op'),
    );
    expect(noOp.noOp).toBe(true);
    expect(useEditorStore.getState().adjustmentRevision).toBe(0);
    expect(useEditorStore.getState().history).toHaveLength(1);
    expect(useEditorStore.getState().lastEditApplicationReceipt).toBeNull();
    expect(() =>
      buildCopyPasteEditTransaction(state, '/fixture/stale.ARW', { exposure: 1 }, 'paste-stale-source'),
    ).toThrow('copy_paste_transaction.stale_source');

    const request = buildCopyPasteEditTransaction(state, targetPath, { exposure: 0.5 }, 'paste-stale');
    const result = state.applyEditTransaction(request);
    const persistence = buildEditTransactionPersistenceContext(request, result);
    expect(
      classifyCopyPasteNativeCompletion(
        { ...useEditorStore.getState(), selectedImage: { path: '/fixture/new.ARW' } },
        targetPath,
        persistence,
      ),
    ).toBe('stale-source');
    expect(
      classifyCopyPasteNativeCompletion(
        { ...useEditorStore.getState(), imageSession: { id: 'editor-image-session:new' } },
        targetPath,
        persistence,
      ),
    ).toBe('stale-session');
    expect(
      classifyCopyPasteNativeCompletion(
        { ...useEditorStore.getState(), adjustmentRevision: persistence.nextAdjustmentRevision + 1 },
        targetPath,
        persistence,
      ),
    ).toBe('stale-revision');
    expect(
      classifyCopyPasteNativeCompletion(
        { ...useEditorStore.getState(), lastEditApplicationReceipt: null },
        targetPath,
        persistence,
      ),
    ).toBe('stale-transaction');

    const staleRevision = buildCopyPasteEditTransaction(
      useEditorStore.getState(),
      targetPath,
      { exposure: 0.9 },
      'paste-stale-revision',
    );
    useEditorStore.getState().applyEditTransaction({
      baseAdjustmentRevision: 1,
      history: 'single-entry',
      imageSessionId: session.id,
      operations: [{ patch: { contrast: 0.25 }, type: 'patch-adjustments' }],
      persistence: 'commit',
      source: 'manual-control',
      transactionId: 'newer-edit',
    });
    expect(() => useEditorStore.getState().applyEditTransaction(staleRevision)).toThrow(
      'edit_transaction.stale_base:1:2',
    );
  });
});
