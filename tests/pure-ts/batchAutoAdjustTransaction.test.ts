import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

import {
  type BatchAutoAdjustPathResultV1,
  batchAutoAdjustPathResultV1Schema,
  batchAutoAdjustResultV1Schema,
} from '../../src/schemas/batchAutoAdjustSchemas';
import { createEditorImageSession, useEditorStore } from '../../src/store/useEditorStore';
import { publishAdjustmentSnapshot } from '../../src/utils/adjustmentSnapshots';
import { INITIAL_ADJUSTMENTS } from '../../src/utils/adjustments';
import {
  type BatchAutoAdjustSelectionIdentity,
  buildSelectedBatchAutoAdjustTransaction,
  resolveBatchAutoAdjustAcceptanceIdentity,
  selectedBatchAutoAdjustDisposition,
  shouldCompensateBatchAutoAdjustPersistence,
} from '../../src/utils/batchAutoAdjustTransaction';

const path = '/fixtures/batch-auto.raw';
const session = createEditorImageSession({ generation: 4, path, source: 'cache' });
const identity: BatchAutoAdjustSelectionIdentity = {
  adjustmentRevision: 0,
  imageSessionId: session.id,
  path,
};
const applied = batchAutoAdjustPathResultV1Schema.parse({
  contract: 'rapidraw.batch_auto_adjust.v1',
  path,
  receipt: {
    baseAdjustmentDocumentRevision: `sha256:${'0'.repeat(64)}`,
    adjustmentDocumentRevision: `sha256:${'1'.repeat(64)}`,
    adjustments: { exposure: 0.65 },
    engine: 'rapidraw.legacy_auto_adjust.v1',
    renderFingerprint: 'u64:1111111111111111',
    sourceIdentity: path,
    sourceRevision: `source-revision-v1:${'2'.repeat(64)}`,
    thumbnailRevision: 'thumbnail-revision-1',
    transactionId: 'blake3:batch-auto-adjust-1',
  },
  status: 'applied',
});

beforeEach(() => {
  const adjustments = structuredClone(INITIAL_ADJUSTMENTS);
  useEditorStore.setState({
    adjustmentRevision: 0,
    adjustmentSnapshot: publishAdjustmentSnapshot(null, adjustments),
    adjustments,
    history: [adjustments],
    historyCheckpoints: [],
    historyIndex: 0,
    imageSession: session,
    imageSessionId: session.generation,
    lastEditApplicationReceipt: null,
  });
});

afterEach(() => {
  useEditorStore.setState({ imageSession: null, imageSessionId: 1 });
});

describe('Batch Auto Adjust transaction boundary', () => {
  test('validates accepted, no-op, and per-path failure receipts', () => {
    const noOp: BatchAutoAdjustPathResultV1 = { ...applied, status: 'no_op' };
    const failed = {
      contract: 'rapidraw.batch_auto_adjust.v1',
      errorCode: 'decode_failed',
      errorMessage: 'Unable to decode source',
      path: '/fixtures/failed.raw',
      status: 'failed',
    };

    expect(batchAutoAdjustResultV1Schema.parse([applied, noOp, failed])).toHaveLength(3);
    expect(() =>
      batchAutoAdjustPathResultV1Schema.parse({
        ...applied,
        receipt: { ...applied.receipt, adjustmentDocumentRevision: 'unsealed' },
      }),
    ).toThrow();
  });

  test('builds one native-committed transaction for the unchanged selected identity', () => {
    const acceptedAdjustments = { ...INITIAL_ADJUSTMENTS, exposure: 0.65 };
    const transaction = buildSelectedBatchAutoAdjustTransaction({
      acceptedAdjustments,
      captured: identity,
      current: identity,
      result: applied,
    });

    expect(transaction).toMatchObject({
      baseAdjustmentRevision: 0,
      history: 'single-entry',
      imageSessionId: session.id,
      persistence: 'native-committed',
      source: 'auto-edit',
      transactionId: 'blake3:batch-auto-adjust-1',
    });
    if (transaction === null) throw new Error('Expected selected Batch Auto Adjust transaction.');
    const result = useEditorStore.getState().applyEditTransaction(transaction);
    const state = useEditorStore.getState();
    expect(result.noOp).toBe(false);
    expect(state.adjustments.exposure).toBe(0.65);
    expect(state.history).toHaveLength(2);
    expect(state.historyIndex).toBe(1);
    expect(state.lastEditApplicationReceipt).toMatchObject({
      persistence: 'native-committed',
      transactionId: 'blake3:batch-auto-adjust-1',
    });
  });

  test('fails closed after selection, image session, or revision changes', () => {
    const currentAdjustments = structuredClone(INITIAL_ADJUSTMENTS);
    const acceptance = (current: BatchAutoAdjustSelectionIdentity | null, adjustments = currentAdjustments) =>
      resolveBatchAutoAdjustAcceptanceIdentity({
        captured: identity,
        capturedAdjustments: currentAdjustments,
        current,
        currentAdjustments: adjustments,
      });

    expect(acceptance({ ...identity, path: '/fixtures/other.raw' })).toBeNull();
    expect(acceptance(null)).toBeNull();
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
      result: applied,
    });
    expect(transaction).toMatchObject({ baseAdjustmentRevision: 4, imageSessionId: 'successor-a' });
  });

  test('distinguishes a path switch from a newer same-path edit before native commit', () => {
    expect(selectedBatchAutoAdjustDisposition(identity, identity)).toBe('apply-selected');
    expect(selectedBatchAutoAdjustDisposition(identity, { ...identity, adjustmentRevision: 1 })).toBe('reject-stale');
    expect(selectedBatchAutoAdjustDisposition(identity, { ...identity, imageSessionId: 'new-session' })).toBe(
      'commit-target-only',
    );
    expect(selectedBatchAutoAdjustDisposition(identity, { ...identity, path: '/fixtures/other.raw' })).toBe(
      'commit-target-only',
    );
    expect(selectedBatchAutoAdjustDisposition(identity, null)).toBe('commit-target-only');
  });

  test('uncommitted prepared result creates no editor transaction or history boundary', () => {
    const request = buildSelectedBatchAutoAdjustTransaction({
      acceptedAdjustments: structuredClone(INITIAL_ADJUSTMENTS),
      captured: identity,
      current: identity,
      result: { ...applied, status: 'prepared' },
    });

    expect(request).toBeNull();
    expect(useEditorStore.getState().history).toHaveLength(1);
    expect(useEditorStore.getState().adjustmentRevision).toBe(0);
  });

  test('requeues only an unpersisted exact captured session after barrier failure', () => {
    const capturedAdjustments = { ...INITIAL_ADJUSTMENTS, exposure: 0.55 };
    const shouldCompensate = (
      barrierPersisted: boolean,
      current: BatchAutoAdjustSelectionIdentity | null,
      currentAdjustments = capturedAdjustments,
    ) =>
      shouldCompensateBatchAutoAdjustPersistence({
        barrierPersisted,
        captured: identity,
        capturedAdjustments,
        current,
        currentAdjustments,
      });

    // A failed pending/immediate barrier has no durable copy, so retry once.
    expect(shouldCompensate(false, identity)).toBe(true);
    // Prepare and commit failures happen after the successful barrier save.
    expect(shouldCompensate(true, identity)).toBe(false);
    expect(shouldCompensate(true, identity)).toBe(false);
    // Never write captured A state through a successor session or newer edit.
    expect(shouldCompensate(false, { ...identity, imageSessionId: 'successor-a' })).toBe(false);
    expect(
      shouldCompensate(false, { ...identity, adjustmentRevision: 1 }, { ...capturedAdjustments, exposure: 0.8 }),
    ).toBe(false);
    expect(shouldCompensate(false, { ...identity, path: '/fixtures/b.raw' })).toBe(false);
  });
});
