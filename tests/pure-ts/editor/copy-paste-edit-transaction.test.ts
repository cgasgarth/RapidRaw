import { beforeEach, describe, expect, test } from 'bun:test';

import { createEditorImageSession, useEditorStore } from '../../../src/store/useEditorStore';
import { INITIAL_ADJUSTMENTS } from '../../../src/utils/adjustments';
import {
  buildCopyPasteEditTransaction,
  buildCopyPastePersistenceCompensation,
  captureCopyPasteCompensationTarget,
  classifyCopyPasteNativeCompletion,
} from '../../../src/utils/copyPasteEditTransaction';
import { selectEditDocumentNode } from '../../../src/utils/editDocumentSelectors';
import {
  copyEditDocumentV2Nodes,
  createDefaultEditDocumentV2,
  patchEditDocumentV2Node,
  setEditDocumentV2NodeEnabled,
} from '../../../src/utils/editDocumentV2';
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

const exposurePayload = (state: { editDocumentV2: ReturnType<typeof createDefaultEditDocumentV2> }, exposure: number) =>
  copyEditDocumentV2Nodes(patchEditDocumentV2Node(state.editDocumentV2, 'scene_global_color_tone', { exposure }), [
    'scene_global_color_tone',
  ]);

describe('copy/paste edit transaction', () => {
  beforeEach(() => {
    const adjustments = { ...structuredClone(INITIAL_ADJUSTMENTS), brightness: 0.2, exposure: 0.1 };
    const editDocumentV2 = patchEditDocumentV2Node(createDefaultEditDocumentV2(), 'scene_global_color_tone', {
      brightness: adjustments.brightness,
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

  test('commits one copy/paste revision without replacing unrelated document fields', () => {
    const state = useEditorStore.getState();
    const request = buildCopyPasteEditTransaction(state, targetPath, exposurePayload(state, 0.75), 'paste-commit');
    const result = state.applyEditTransaction(request);
    const persistence = buildEditTransactionPersistenceContext(request, result);

    expect(result).toMatchObject({ nextAdjustmentRevision: 1, noOp: false, source: 'copy-paste' });
    expect(request.operations).toMatchObject([
      {
        node: { enabled: true, params: { brightness: 0.2, exposure: 0.75 }, type: 'scene_global_color_tone' },
        nodeType: 'scene_global_color_tone',
        type: 'replace-edit-document-node',
      },
    ]);
    expect(result.after.nodes['geometry']).toEqual(result.before.nodes['geometry']);
    expect(result.after.nodes['scene_global_color_tone']?.params['exposure']).toBe(0.75);
    expect(useEditorStore.getState().editDocumentV2.nodes['scene_global_color_tone']!.params).toMatchObject({
      brightness: 0.2,
      exposure: 0.75,
    });
    expect(useEditorStore.getState().history).toHaveLength(2);
    expect(useEditorStore.getState().lastEditApplicationReceipt).toMatchObject({
      adjustmentRevision: 1,
      persistence: 'commit',
      source: 'copy-paste',
      transactionId: 'paste-commit',
    });
    expect(classifyCopyPasteNativeCompletion(useEditorStore.getState(), targetPath, persistence)).toBe('current');

    useEditorStore.getState().undo();
    expect(useEditorStore.getState().editDocumentV2.nodes['scene_global_color_tone']!.params).toMatchObject({
      brightness: 0.2,
      exposure: 0.1,
    });
    expect(useEditorStore.getState().historyIndex).toBe(0);
    useEditorStore.getState().redo();
    expect(useEditorStore.getState().editDocumentV2.nodes['scene_global_color_tone']!.params).toMatchObject({
      brightness: 0.2,
      exposure: 0.75,
    });
    expect(useEditorStore.getState().editDocumentV2.nodes['scene_global_color_tone']?.params['exposure']).toBe(0.75);
  });

  test('does not mutate an unselected sibling node in the same editor section', () => {
    const state = useEditorStore.getState();
    const sourceDocument = patchEditDocumentV2Node(
      patchEditDocumentV2Node(state.editDocumentV2, 'scene_global_color_tone', { exposure: 1.5 }),
      'camera_input',
      {
        whiteBalanceTechnical: {
          ...selectEditDocumentNode(state.editDocumentV2, 'camera_input').params['whiteBalanceTechnical'],
          kelvin: 7_200,
        },
      },
    );
    const source = copyEditDocumentV2Nodes(sourceDocument, ['scene_global_color_tone']);
    const cameraInputBefore = state.editDocumentV2.nodes['camera_input'];
    const result = state.applyEditTransaction(
      buildCopyPasteEditTransaction(state, targetPath, source, 'paste-selected-node'),
    );

    expect(result.after.nodes['scene_global_color_tone']?.params['exposure']).toBe(1.5);
    expect(result.after.nodes['camera_input']).toBe(cameraInputBefore);
    expect(result.after.nodes['camera_input']?.params['whiteBalanceTechnical']).toEqual(
      state.editDocumentV2.nodes['camera_input']!.params['whiteBalanceTechnical'],
    );
  });

  test('preserves no-ops and rejects stale source, revision, session, and completion identities', () => {
    const state = useEditorStore.getState();
    const noOp = state.applyEditTransaction(
      buildCopyPasteEditTransaction(state, targetPath, exposurePayload(state, 0.1), 'paste-no-op'),
    );
    expect(noOp.noOp).toBe(true);
    expect(useEditorStore.getState().adjustmentRevision).toBe(0);
    expect(useEditorStore.getState().history).toHaveLength(1);
    expect(useEditorStore.getState().lastEditApplicationReceipt).toBeNull();
    expect(() =>
      buildCopyPasteEditTransaction(state, '/fixture/stale.ARW', exposurePayload(state, 1), 'paste-stale-source'),
    ).toThrow('copy_paste_transaction.stale_source');

    const request = buildCopyPasteEditTransaction(state, targetPath, exposurePayload(state, 0.5), 'paste-stale');
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
      exposurePayload(useEditorStore.getState(), 0.9),
      'paste-stale-revision',
    );
    useEditorStore.getState().applyEditTransaction({
      baseAdjustmentRevision: 1,
      history: 'single-entry',
      imageSessionId: session.id,
      operations: [
        { nodeType: 'scene_global_color_tone', patch: { contrast: 0.25 }, type: 'patch-edit-document-node' },
      ],
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
    enabledState.hydrateEditorRenderAuthority({
      adjustmentRevision: enabledState.adjustmentRevision,
      editDocumentV2: disabledDocument,
      historyCheckpoints: enabledState.historyCheckpoints,
      historyIndex: enabledState.historyIndex,
      history: enabledState.history.map((entry, index) =>
        index === enabledState.historyIndex ? disabledDocument : entry,
      ),
    });
    const before = useEditorStore.getState();
    before.createHistoryCheckpoint('Before paste');
    const expectedHistory = structuredClone(useEditorStore.getState().history);
    const expectedCheckpoints = structuredClone(useEditorStore.getState().historyCheckpoints);
    const target = captureCopyPasteCompensationTarget(useEditorStore.getState(), targetPath);
    const request = buildCopyPasteEditTransaction(before, targetPath, exposurePayload(before, 0.75), 'paste-failure');
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
    const compensationHistory = compensation.compensationHistory;
    const compensationOperation = compensation.operations[0];
    if (compensationOperation?.type !== 'replace-edit-document') {
      throw new Error('Expected replacement document for compensation.');
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
          ...compensationHistory,
          checkpoints: compensationHistory.checkpoints.map((checkpoint) => ({
            ...checkpoint,
            historyIndex: 99,
          })),
        },
        transactionId: 'paste-failure:malformed-compensation',
      }),
    ).toThrow('edit_transaction.invalid_compensation_history');
    expect(useEditorStore.getState()).toMatchObject({
      adjustmentRevision: beforeMalformed.adjustmentRevision,
      historyIndex: beforeMalformed.historyIndex,
      lastEditApplicationReceipt: { transactionId: 'paste-failure' },
    });
    expect(useEditorStore.getState().editDocumentV2.nodes['scene_global_color_tone']!.params['exposure']).toBe(0.75);
    expect(useEditorStore.getState().history).toEqual(beforeMalformed.history);
    expect(useEditorStore.getState().historyCheckpoints).toEqual(beforeMalformed.historyCheckpoints);
    const capturedEntry = target.history[0];
    const capturedCheckpoint = target.historyCheckpoints[0];
    if (capturedEntry === undefined || capturedCheckpoint === undefined) {
      throw new Error('Expected captured compensation history and checkpoint.');
    }
    const capturedToneNode = capturedEntry.nodes['scene_global_color_tone'];
    if (capturedToneNode === undefined) throw new Error('Expected captured scene-global color/tone node.');
    capturedToneNode.params['exposure'] = 4;
    capturedCheckpoint.historyIndex = 99;
    useEditorStore.getState().applyEditTransaction(reorderedCompensation);
    expect(useEditorStore.getState()).toMatchObject({
      adjustmentRevision: 2,
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
    expect(useEditorStore.getState().editDocumentV2.nodes['scene_global_color_tone']?.params).toMatchObject({
      brightness: 0.2,
      exposure: 0.1,
    });
    expect(useEditorStore.getState().history).toEqual(expectedHistory);
    expect(useEditorStore.getState().historyCheckpoints).toEqual(expectedCheckpoints);
    expect(useEditorStore.getState().editDocumentV2.nodes['scene_curve']?.enabled).toBeFalse();
    expect(useEditorStore.getState().history[0]?.nodes['scene_curve']?.enabled).toBeFalse();
    const compensatedRevision = useEditorStore.getState().adjustmentRevision;
    useEditorStore.getState().undo();
    useEditorStore.getState().redo();
    expect(useEditorStore.getState()).toMatchObject({
      adjustmentRevision: compensatedRevision,
      history: expectedHistory,
      historyCheckpoints: expectedCheckpoints,
      historyIndex: 0,
      lastEditApplicationReceipt: { transactionId: 'paste-failure:compensate' },
    });
    expect(useEditorStore.getState().editDocumentV2.nodes['scene_global_color_tone']?.params).toMatchObject({
      brightness: 0.2,
      exposure: 0.1,
    });
    expect(useEditorStore.getState().history).toEqual(expectedHistory);
    expect(useEditorStore.getState().historyCheckpoints).toEqual(expectedCheckpoints);

    const nextState = useEditorStore.getState();
    const nextTarget = captureCopyPasteCompensationTarget(nextState, targetPath);
    const nextRequest = buildCopyPasteEditTransaction(
      nextState,
      targetPath,
      exposurePayload(nextState, 0.5),
      'paste-stale-failure',
    );
    const nextResult = nextState.applyEditTransaction(nextRequest);
    const nextPersistence = buildEditTransactionPersistenceContext(nextRequest, nextResult);
    const newerState = useEditorStore.getState();
    newerState.applyEditTransaction({
      baseAdjustmentRevision: newerState.adjustmentRevision,
      history: 'single-entry',
      imageSessionId: session.id,
      operations: [
        { nodeType: 'scene_global_color_tone', patch: { contrast: 0.25 }, type: 'patch-edit-document-node' },
      ],
      persistence: 'commit',
      source: 'manual-control',
      transactionId: 'newer-after-paste',
    });

    expect(buildCopyPastePersistenceCompensation(useEditorStore.getState(), nextPersistence, nextTarget)).toBeNull();
    expect(useEditorStore.getState().editDocumentV2.nodes['scene_global_color_tone']?.params).toMatchObject({
      contrast: 0.25,
      exposure: 0.5,
    });
  });
});
