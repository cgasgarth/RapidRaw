import { describe, expect, test } from 'bun:test';

import { batchAutoAdjustPathResultV1Schema } from '../../src/schemas/batchAutoAdjustSchemas';
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
      buildSelectedBatchAutoAdjustTransaction({
        acceptedEditDocumentV2: accepted,
        captured: identity,
        current: null,
        currentEditDocumentV2: captured,
        result: applied,
      }),
    ).toBeNull();
    expect(selectedBatchAutoAdjustDisposition(identity, null)).toBe('commit-target-only');
    expect(selectedBatchAutoAdjustDisposition(identity, { ...identity, adjustmentRevision: 1 })).toBe('reject-stale');
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
