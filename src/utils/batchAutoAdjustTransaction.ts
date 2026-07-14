import type { BatchAutoAdjustPathResultV1 } from '../schemas/batchAutoAdjustSchemas';
import type { Adjustments } from './adjustments';
import { areAdjustmentsEqual } from './adjustmentsSnapshot';
import type { EditTransactionRequest } from './editTransaction';

export interface BatchAutoAdjustSelectionIdentity {
  adjustmentRevision: number;
  imageSessionId: string;
  path: string;
}

export interface BatchAutoAdjustPersistenceCompensationInput {
  barrierPersisted: boolean;
  captured: BatchAutoAdjustSelectionIdentity;
  capturedAdjustments: Adjustments;
  current: BatchAutoAdjustSelectionIdentity | null;
  currentAdjustments: Adjustments | null;
}

export const shouldCompensateBatchAutoAdjustPersistence = ({
  barrierPersisted,
  captured,
  capturedAdjustments,
  current,
  currentAdjustments,
}: BatchAutoAdjustPersistenceCompensationInput): boolean =>
  !barrierPersisted &&
  current !== null &&
  currentAdjustments !== null &&
  current.path === captured.path &&
  current.imageSessionId === captured.imageSessionId &&
  current.adjustmentRevision === captured.adjustmentRevision &&
  areAdjustmentsEqual(currentAdjustments, capturedAdjustments);

export type SelectedBatchAutoAdjustDisposition = 'apply-selected' | 'commit-target-only' | 'reject-stale';

export const selectedBatchAutoAdjustDisposition = (
  captured: BatchAutoAdjustSelectionIdentity,
  current: BatchAutoAdjustSelectionIdentity | null,
): SelectedBatchAutoAdjustDisposition => {
  if (current?.path !== captured.path) return 'commit-target-only';
  if (current.imageSessionId !== captured.imageSessionId) return 'commit-target-only';
  return current.adjustmentRevision === captured.adjustmentRevision ? 'apply-selected' : 'reject-stale';
};

export const resolveBatchAutoAdjustAcceptanceIdentity = ({
  captured,
  capturedAdjustments,
  current,
  currentAdjustments,
}: {
  captured: BatchAutoAdjustSelectionIdentity;
  capturedAdjustments: Adjustments;
  current: BatchAutoAdjustSelectionIdentity | null;
  currentAdjustments: Adjustments | null;
}): BatchAutoAdjustSelectionIdentity | null => {
  if (current === null || currentAdjustments === null || current.path !== captured.path) return null;
  if (
    current.imageSessionId === captured.imageSessionId &&
    current.adjustmentRevision === captured.adjustmentRevision
  ) {
    return current;
  }
  return areAdjustmentsEqual(currentAdjustments, capturedAdjustments) ? current : null;
};

interface SelectedBatchAutoAdjustInput {
  acceptedAdjustments: Adjustments;
  captured: BatchAutoAdjustSelectionIdentity;
  current: BatchAutoAdjustSelectionIdentity | null;
  result: BatchAutoAdjustPathResultV1;
}

export const buildSelectedBatchAutoAdjustTransaction = ({
  acceptedAdjustments,
  captured,
  current,
  result,
}: SelectedBatchAutoAdjustInput): EditTransactionRequest | null => {
  if (
    (result.status !== 'applied' && result.status !== 'no_op') ||
    result.path !== captured.path ||
    current === null ||
    current.path !== captured.path
  ) {
    return null;
  }

  return {
    baseAdjustmentRevision: current.adjustmentRevision,
    history: 'single-entry',
    imageSessionId: current.imageSessionId,
    operations: [{ adjustments: acceptedAdjustments, type: 'replace-adjustments' }],
    persistence: 'native-committed',
    source: 'auto-edit',
    transactionId: result.receipt.transactionId,
  };
};
