import { beforeEach, describe, expect, test } from 'bun:test';

import { createEditorImageSession, useEditorStore } from '../../../src/store/useEditorStore';
import { publishAdjustmentSnapshot } from '../../../src/utils/adjustmentSnapshots';
import { INITIAL_ADJUSTMENTS } from '../../../src/utils/adjustments';
import {
  buildCopyPasteEditTransaction,
  buildCopyPastePersistenceCompensation,
  captureCopyPasteCompensationTarget,
  classifyCopyPasteNativeCompletion,
} from '../../../src/utils/copyPasteEditTransaction';
import { legacyAdjustmentsToEditDocumentV2, setEditDocumentV2NodeEnabled } from '../../../src/utils/editDocumentV2';
import {
  buildEditTransactionPersistenceContext,
  type EditTransactionRequest,
} from '../../../src/utils/editTransaction';

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
    useEditorStore.getState().hydrateEditorRenderAuthority({
      adjustmentRevision: 0,
      adjustmentSnapshot: publishAdjustmentSnapshot(null, adjustments, editDocumentV2),
      adjustments,
      editDocumentV2,
      editDocumentHistory: [editDocumentV2],
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

  test('compensates an exact native failure without overwriting a newer edit', () => {
    const enabledState = useEditorStore.getState();
    const disabledDocument = setEditDocumentV2NodeEnabled(enabledState.editDocumentV2, 'scene_curve', false);
    useEditorStore.setState({
      adjustmentSnapshot: publishAdjustmentSnapshot(
        enabledState.adjustmentSnapshot,
        enabledState.adjustments,
        disabledDocument,
      ),
      editDocumentHistory: [disabledDocument],
      editDocumentV2: disabledDocument,
    });
    const before = useEditorStore.getState();
    before.createHistoryCheckpoint('Before paste');
    const expectedHistory = structuredClone(useEditorStore.getState().history);
    const expectedCheckpoints = structuredClone(useEditorStore.getState().historyCheckpoints);
    const target = captureCopyPasteCompensationTarget(useEditorStore.getState(), targetPath);
    const request = buildCopyPasteEditTransaction(before, targetPath, { exposure: 0.75 }, 'paste-failure');
    const result = before.applyEditTransaction(request);
    const persistence = buildEditTransactionPersistenceContext(request, result);
    expect(useEditorStore.getState().history).toHaveLength(2);
    const compensation = buildCopyPastePersistenceCompensation(useEditorStore.getState(), persistence, target);

    expect(compensation).toMatchObject({
      baseAdjustmentRevision: 1,
      history: 'compensation',
      imageSessionId: session.id,
      persistence: 'native-committed',
      source: 'copy-paste',
      transactionId: 'paste-failure:compensate',
    });
    if (compensation === null) throw new Error('Expected exact native failure compensation.');
    if (compensation.compensationHistory === undefined) throw new Error('Expected compensation history authority.');
    const compensationOperation = compensation.operations[0];
    if (compensationOperation?.type !== 'replace-edit-authority') {
      throw new Error('Expected replacement authority for compensation.');
    }
    const reorderedCompensation = {
      ...compensation,
      operations: [
        {
          ...compensationOperation,
          editDocumentV2: {
            ...compensationOperation.editDocumentV2,
            nodes: Object.fromEntries(Object.entries(compensationOperation.editDocumentV2.nodes).reverse()),
          },
        },
      ],
    } satisfies EditTransactionRequest;
    const beforeMalformed = useEditorStore.getState();
    expect(() =>
      beforeMalformed.applyEditTransaction({
        ...compensation,
        compensationHistory: {
          ...compensation.compensationHistory,
          checkpoints: compensation.compensationHistory.checkpoints.map((checkpoint) => ({
            ...checkpoint,
            historyIndex: 99,
          })),
        },
        transactionId: 'paste-failure:malformed-compensation',
      }),
    ).toThrow('edit_transaction.invalid_compensation_history');
    expect(useEditorStore.getState()).toMatchObject({
      adjustmentRevision: beforeMalformed.adjustmentRevision,
      adjustments: { exposure: 0.75 },
      historyIndex: beforeMalformed.historyIndex,
      lastEditApplicationReceipt: { transactionId: 'paste-failure' },
    });
    expect(useEditorStore.getState().history).toEqual(beforeMalformed.history);
    expect(useEditorStore.getState().historyCheckpoints).toEqual(beforeMalformed.historyCheckpoints);
    const capturedEntry = target.history[0];
    const capturedCheckpoint = target.historyCheckpoints[0];
    if (capturedEntry === undefined || capturedCheckpoint === undefined) {
      throw new Error('Expected captured compensation history and checkpoint.');
    }
    capturedEntry.exposure = 4;
    capturedCheckpoint.historyIndex = 99;
    useEditorStore.getState().applyEditTransaction(reorderedCompensation);
    expect(useEditorStore.getState()).toMatchObject({
      adjustmentRevision: 2,
      adjustments: { brightness: 0.2, exposure: 0.1 },
      history: expectedHistory,
      historyCheckpoints: expectedCheckpoints,
      historyIndex: 0,
      lastEditApplicationReceipt: {
        adjustmentRevision: 2,
        persistence: 'native-committed',
        source: 'copy-paste',
        transactionId: 'paste-failure:compensate',
      },
    });
    expect(useEditorStore.getState().history).toEqual(expectedHistory);
    expect(useEditorStore.getState().historyCheckpoints).toEqual(expectedCheckpoints);
    expect(useEditorStore.getState().editDocumentV2.nodes.scene_curve.enabled).toBeFalse();
    expect(useEditorStore.getState().editDocumentHistory[0]?.nodes.scene_curve.enabled).toBeFalse();
    const compensatedRevision = useEditorStore.getState().adjustmentRevision;
    useEditorStore.getState().undo();
    useEditorStore.getState().redo();
    expect(useEditorStore.getState()).toMatchObject({
      adjustmentRevision: compensatedRevision,
      adjustments: { brightness: 0.2, exposure: 0.1 },
      history: expectedHistory,
      historyCheckpoints: expectedCheckpoints,
      historyIndex: 0,
      lastEditApplicationReceipt: { transactionId: 'paste-failure:compensate' },
    });
    expect(useEditorStore.getState().history).toEqual(expectedHistory);
    expect(useEditorStore.getState().historyCheckpoints).toEqual(expectedCheckpoints);

    const nextState = useEditorStore.getState();
    const nextTarget = captureCopyPasteCompensationTarget(nextState, targetPath);
    const nextRequest = buildCopyPasteEditTransaction(nextState, targetPath, { exposure: 0.5 }, 'paste-stale-failure');
    const nextResult = nextState.applyEditTransaction(nextRequest);
    const nextPersistence = buildEditTransactionPersistenceContext(nextRequest, nextResult);
    const newerState = useEditorStore.getState();
    newerState.applyEditTransaction({
      baseAdjustmentRevision: newerState.adjustmentRevision,
      history: 'single-entry',
      imageSessionId: session.id,
      operations: [{ patch: { contrast: 0.25 }, type: 'patch-adjustments' }],
      persistence: 'commit',
      source: 'manual-control',
      transactionId: 'newer-after-paste',
    });

    expect(buildCopyPastePersistenceCompensation(useEditorStore.getState(), nextPersistence, nextTarget)).toBeNull();
    expect(useEditorStore.getState().adjustments).toMatchObject({ contrast: 0.25, exposure: 0.5 });
  });
});
