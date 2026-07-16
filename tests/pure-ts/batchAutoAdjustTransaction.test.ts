import { describe, expect, test } from 'bun:test';

import type { EditDocumentNodeTypeV2, EditDocumentV2 } from '../../packages/rawengine-schema/src/editDocumentV2';
import {
  type BatchAutoAdjustPathResultV1,
  batchAutoAdjustPathResultV1Schema,
  batchAutoAdjustResultV1Schema,
} from '../../src/schemas/batchAutoAdjustSchemas';
import { createEditorImageSession, useEditorStore } from '../../src/store/useEditorStore';
import { INITIAL_ADJUSTMENTS } from '../../src/utils/adjustments';
import {
  type BatchAutoAdjustSelectionIdentity,
  buildSelectedBatchAutoAdjustTransaction,
  resolveBatchAutoAdjustAcceptanceIdentity,
  resolveBatchAutoAdjustHydrationProtection,
  resolveBatchAutoAdjustReconciledHistoryBaseline,
  selectedBatchAutoAdjustDisposition,
  shouldCompensateBatchAutoAdjustPersistence,
} from '../../src/utils/batchAutoAdjustTransaction';
import { createDefaultEditDocumentV2, patchEditDocumentV2Node } from '../../src/utils/editDocumentV2';

const path = '/fixtures/batch-auto.raw';
const identity: BatchAutoAdjustSelectionIdentity = {
  adjustmentRevision: 0,
  imageSessionId: 'session-a',
  path,
};
const captured = createDefaultEditDocumentV2();
const accepted = patchEditDocumentV2Node(captured, 'scene_global_color_tone', { exposure: 0.65 });
const applied = batchAutoAdjustPathResultV1Schema.parse({
  contract: 'rapidraw.batch_auto_adjust.v1',
  path,
  receipt: {
    adjustmentDocumentRevision: `sha256:${'1'.repeat(64)}`,
    baseAdjustmentDocumentRevision: `sha256:${'0'.repeat(64)}`,
    editDocumentV2: accepted,
    engine: 'rapidraw.auto_adjust.v1',
    renderFingerprint: 'u64:1111111111111111',
    sourceIdentity: path,
    sourceRevision: `source-revision-v1:${'2'.repeat(64)}`,
    thumbnailRevision: 'thumbnail-revision-1',
    transactionId: 'blake3:batch-auto-adjust-1',
  },
  status: 'applied',
});

describe('Batch Auto Adjust current-document boundary', () => {
  test('builds one native-committed atomic replacement', () => {
    const transaction = buildSelectedBatchAutoAdjustTransaction({
      acceptedEditDocumentV2: accepted,
      captured: identity,
      current: identity,
      currentEditDocumentV2: captured,
      result: applied,
    });
    expect(transaction).toMatchObject({
      baseAdjustmentRevision: 0,
      imageSessionId: 'session-a',
      persistence: 'native-committed',
      transactionId: 'blake3:batch-auto-adjust-1',
    });
    expect(transaction?.operations).toMatchObject([
      { nodeType: 'scene_global_color_tone', patch: { exposure: 0.65 }, type: 'patch-edit-document-node' },
      { nodeType: 'detail_denoise_dehaze', type: 'patch-edit-document-node' },
      { nodeType: 'color_presence', type: 'patch-edit-document-node' },
      { nodeType: 'display_creative', type: 'patch-edit-document-node' },
      { nodeType: 'camera_input', type: 'patch-edit-document-node' },
      { nodeType: 'black_white_mixer', type: 'patch-edit-document-node' },
      { receipt: null, type: 'set-reference-match-application-receipt' },
    ]);
  });

  test('fails closed for failed, wrong-path, or missing current selections', () => {
    expect(
      acceptance(
        { ...identity, adjustmentRevision: 1, imageSessionId: 'successor-session' },
        {
          ...currentAdjustments,
          exposure: 0.8,
        },
      ),
    ).toBeNull();
  });

  test('accepts an unchanged A to B to successor-A session and targets its live revision', () => {
    const capturedAdjustments = structuredClone(INITIAL_ADJUSTMENTS);
    const successor = { ...identity, adjustmentRevision: 4, imageSessionId: 'successor-a' };
    const acceptance = resolveBatchAutoAdjustAcceptanceIdentity({
      captured: identity,
      capturedAdjustments,
      current: successor,
      currentAdjustments: structuredClone(capturedAdjustments),
    });
    expect(acceptance).toEqual(successor);
    const transaction = buildSelectedBatchAutoAdjustTransaction({
      acceptedAdjustments: { ...INITIAL_ADJUSTMENTS, exposure: 0.65 },
      captured: identity,
      current: acceptance,
      currentAdjustments: capturedAdjustments,
      currentEditDocumentV2: legacyAdjustmentsToEditDocumentV2(capturedAdjustments),
      result: applied,
    });
    expect(transaction).toMatchObject({ baseAdjustmentRevision: 4, imageSessionId: 'successor-a' });
  });

  test('reconciles an already-hydrated native result into one undoable successor boundary', () => {
    const capturedAdjustments = { ...structuredClone(INITIAL_ADJUSTMENTS), exposure: 0.55 };
    const acceptedAdjustments = { ...structuredClone(INITIAL_ADJUSTMENTS), exposure: 0.65 };
    const successorSession = createEditorImageSession({ generation: 5, path, source: 'cold-load' });
    const successor = { ...identity, adjustmentRevision: 4, imageSessionId: successorSession.id };
    const historyBaseline = resolveBatchAutoAdjustReconciledHistoryBaseline({
      acceptedAdjustments,
      captured: identity,
      capturedAdjustments,
      current: successor,
      currentAdjustments: acceptedAdjustments,
    });
    expect(historyBaseline).toEqual(capturedAdjustments);
    const historyEditDocumentBaseline = setEditDocumentV2NodeEnabled(
      legacyAdjustmentsToEditDocumentV2(capturedAdjustments),
      'scene_curve',
      false,
    );
    const acceptedEditDocument = setEditDocumentV2NodeEnabled(
      legacyAdjustmentsToEditDocumentV2(acceptedAdjustments),
      'scene_curve',
      false,
    );

    useEditorStore.getState().hydrateEditorRenderAuthority({
      adjustmentRevision: successor.adjustmentRevision,
      editDocumentV2: acceptedEditDocument,
      historyCheckpoints: [],
      historyIndex: 0,
      imageSession: successorSession,
      imageSessionId: successorSession.generation,
      history: [acceptedEditDocument],
    });
    const transaction = buildSelectedBatchAutoAdjustTransaction({
      acceptedAdjustments,
      captured: identity,
      current: successor,
      currentAdjustments: acceptedAdjustments,
      currentEditDocumentV2: acceptedEditDocument,
      ...(historyBaseline === null ? {} : { historyBaseline }),
      historyEditDocumentBaseline,
      result: applied,
    });
    if (transaction === null) throw new Error('Expected reconciled Batch Auto Adjust transaction.');
    const result = useEditorStore.getState().applyEditTransaction(transaction);
    expect(result.noOp).toBe(false);
    expect(result.before.nodes['scene_global_color_tone']?.params['exposure']).toBe(0.55);
    expect(result.after.nodes['scene_global_color_tone']?.params['exposure']).toBe(0.65);
    expect(requiredNode(result.after, 'scene_curve').enabled).toBeFalse();
    expect(
      useEditorStore.getState().history.map((entry) => entry.nodes['scene_global_color_tone']?.params['exposure']),
    ).toEqual([0.55, 0.65]);
    useEditorStore.getState().undo();
    expect(useEditorStore.getState().adjustmentSnapshot.value.exposure).toBe(0.55);
    expect(requiredNode(useEditorStore.getState().editDocumentV2, 'scene_curve').enabled).toBeFalse();
  });

  test('does not reconcile a captured session, another path, or a divergent successor edit', () => {
    const capturedAdjustments = { ...structuredClone(INITIAL_ADJUSTMENTS), exposure: 0.55 };
    const acceptedAdjustments = { ...structuredClone(INITIAL_ADJUSTMENTS), exposure: 0.65 };
    const resolve = (current: BatchAutoAdjustSelectionIdentity, currentAdjustments = acceptedAdjustments) =>
      resolveBatchAutoAdjustReconciledHistoryBaseline({
        acceptedAdjustments,
        captured: identity,
        capturedAdjustments,
        current,
        currentAdjustments,
      });

    expect(resolve(identity)).toBeNull();
    expect(resolve({ ...identity, imageSessionId: 'successor', path: '/fixtures/other.raw' })).toBeNull();
    expect(resolve({ ...identity, imageSessionId: 'successor' }, { ...acceptedAdjustments, exposure: 0.8 })).toBeNull();
  });

  test('rejects a deferred legacy history snapshot after newer mixer transactions', () => {
    const deferred = { ...structuredClone(INITIAL_ADJUSTMENTS), contrast: 8 };
    const deferredDocument = legacyAdjustmentsToEditDocumentV2(deferred);
    useEditorStore.getState().hydrateEditorRenderAuthority({
      editDocumentV2: deferredDocument,
      historyIndex: 0,
      history: [deferredDocument],
    });
    const deferredIdentity = {
      adjustmentRevision: useEditorStore.getState().adjustmentRevision,
      imageSessionId: session.id,
    };
    const enableIdentity = { ...identity, adjustmentRevision: deferredIdentity.adjustmentRevision };
    const enabled = {
      ...deferred,
      blackWhiteMixer: { ...deferred.blackWhiteMixer, enabled: true, process: 'continuous_sensitivity_v1' as const },
    };
    useEditorStore.getState().applyEditTransaction(
      buildSelectedBatchAutoAdjustTransaction({
        acceptedEditDocumentV2: accepted,
        captured: identity,
        current: null,
        currentEditDocumentV2: captured,
        result: applied,
      }) ??
        (() => {
          throw new Error('Expected enable transaction.');
        })(),
    );
    const responseState = useEditorStore.getState();
    const response = {
      ...responseState.adjustmentSnapshot.value,
      blackWhiteMixer: {
        ...responseState.adjustmentSnapshot.value.blackWhiteMixer,
        weights: { ...responseState.adjustmentSnapshot.value.blackWhiteMixer.weights, reds: 32 },
      },
    };
    responseState.applyEditTransaction({
      baseAdjustmentRevision: responseState.adjustmentRevision,
      history: 'single-entry',
      imageSessionId: session.id,
      operations: [
        {
          nodeType: 'black_white_mixer',
          patch: { blackWhiteMixer: response.blackWhiteMixer },
          type: 'patch-edit-document-node',
        },
      ],
      persistence: 'commit',
      source: 'manual-control',
      transactionId: 'black-white-response',
    });

    useEditorStore.getState().pushHistory(deferredIdentity);
    expect(useEditorStore.getState().history).toHaveLength(3);
    useEditorStore.getState().undo();
    expect(useEditorStore.getState().adjustmentSnapshot.value.blackWhiteMixer).toEqual(enabled.blackWhiteMixer);
  });

  test('accepts exact current and unchanged successor documents', () => {
    expect(
      resolveBatchAutoAdjustAcceptanceIdentity({
        captured: identity,
        capturedEditDocumentV2: captured,
        current: identity,
        currentEditDocumentV2: captured,
      }),
    ).toEqual(identity);
    const successor = { ...identity, adjustmentRevision: 4, imageSessionId: 'successor-a' };
    expect(
      resolveBatchAutoAdjustAcceptanceIdentity({
        captured: identity,
        capturedEditDocumentV2: captured,
        current: successor,
        currentEditDocumentV2: structuredClone(captured),
      }),
    ).toEqual(successor);
  });

  test('rejects a successor with a newer current-node edit', () => {
    expect(
      resolveBatchAutoAdjustAcceptanceIdentity({
        captured: identity,
        capturedEditDocumentV2: captured,
        current: { ...identity, adjustmentRevision: 1 },
        currentEditDocumentV2: patchEditDocumentV2Node(captured, 'scene_global_color_tone', { exposure: 0.8 }),
      }),
    ).toBeNull();
  });

  test('reconciles native hydration to the captured document baseline', () => {
    const successor = { ...identity, adjustmentRevision: 4, imageSessionId: 'successor-a' };
    expect(
      resolveBatchAutoAdjustReconciledHistoryBaseline({
        acceptedEditDocumentV2: accepted,
        captured: identity,
        capturedEditDocumentV2: captured,
        current: successor,
        currentEditDocumentV2: accepted,
      }),
    ).toBe(captured);
  });

  test('protects a same-path hydrated result by transaction identity', () => {
    expect(
      resolveBatchAutoAdjustHydrationProtection({
        captured: identity,
        current: { ...identity, imageSessionId: 'successor-a' },
        result: applied,
      }),
    ).toEqual({ sessionId: 'successor-a', transactionId: 'blake3:batch-auto-adjust-1' });
  });

  test('compensates only an unpersisted exact current document', () => {
    const input = {
      captured: identity,
      capturedEditDocumentV2: captured,
      current: identity,
      currentEditDocumentV2: captured,
    };
    expect(shouldCompensateBatchAutoAdjustPersistence({ ...input, barrierPersisted: false })).toBeTrue();
    expect(shouldCompensateBatchAutoAdjustPersistence({ ...input, barrierPersisted: true })).toBeFalse();
    expect(
      shouldCompensateBatchAutoAdjustPersistence({
        ...input,
        barrierPersisted: false,
        currentEditDocumentV2: accepted,
      }),
    ).toBeFalse();
  });
});
