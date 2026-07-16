import type { EditDocumentV2 } from '../../packages/rawengine-schema/src/editDocumentV2';
import type { BatchAutoAdjustPathResultV1 } from '../schemas/batchAutoAdjustSchemas';
import type { Adjustments } from './adjustments';
import { areAdjustmentsEqual } from './adjustmentsSnapshot';
import { buildAdjustmentMutationOperations, type EditTransactionRequest } from './editTransaction';

export interface BatchAutoAdjustSelectionIdentity {
  adjustmentRevision: number;
  imageSessionId: string;
  path: string;
}

export type BatchAutoAdjustSessionSource = 'cache' | 'cold-load';

export interface BatchAutoAdjustSuccessorBaseline {
  adjustments: Adjustments;
  identity: BatchAutoAdjustSelectionIdentity;
  source: BatchAutoAdjustSessionSource;
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

export interface BatchAutoAdjustHydrationProtection {
  sessionId: string;
  transactionId: string;
}

export const resolveBatchAutoAdjustHydrationProtection = ({
  captured,
  current,
  result,
}: {
  captured: BatchAutoAdjustSelectionIdentity;
  current: BatchAutoAdjustSelectionIdentity | null;
  result: BatchAutoAdjustPathResultV1;
}): BatchAutoAdjustHydrationProtection | null =>
  (result.status === 'applied' || result.status === 'no_op') &&
  result.path === captured.path &&
  current?.path === captured.path
    ? { sessionId: current.imageSessionId, transactionId: result.receipt.transactionId }
    : null;

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
  currentSource = null,
  successorBaseline = null,
}: {
  captured: BatchAutoAdjustSelectionIdentity;
  capturedAdjustments: Adjustments;
  current: BatchAutoAdjustSelectionIdentity | null;
  currentAdjustments: Adjustments | null;
  currentSource?: BatchAutoAdjustSessionSource | null;
  successorBaseline?: BatchAutoAdjustSuccessorBaseline | null;
}): BatchAutoAdjustSelectionIdentity | null => {
  if (current === null || currentAdjustments === null || current.path !== captured.path) return null;
  if (
    current.imageSessionId === captured.imageSessionId &&
    current.adjustmentRevision === captured.adjustmentRevision
  ) {
    return current;
  }
  if (areAdjustmentsEqual(currentAdjustments, capturedAdjustments)) return current;
  return successorBaseline !== null &&
    currentSource === successorBaseline.source &&
    current.path === successorBaseline.identity.path &&
    current.imageSessionId === successorBaseline.identity.imageSessionId &&
    current.adjustmentRevision === successorBaseline.identity.adjustmentRevision &&
    areAdjustmentsEqual(currentAdjustments, successorBaseline.adjustments)
    ? current
    : null;
};

interface SelectedBatchAutoAdjustInput {
  acceptedAdjustments: Adjustments;
  captured: BatchAutoAdjustSelectionIdentity;
  current: BatchAutoAdjustSelectionIdentity | null;
  currentAdjustments: Adjustments;
  currentEditDocumentV2: EditDocumentV2;
  historyBaseline?: Adjustments;
  historyEditDocumentBaseline?: EditDocumentV2;
  result: BatchAutoAdjustPathResultV1;
}

export const buildSelectedBatchAutoAdjustTransaction = ({
  acceptedAdjustments,
  captured,
  current,
  currentAdjustments,
  currentEditDocumentV2,
  historyBaseline,
  historyEditDocumentBaseline,
  result,
}: SelectedBatchAutoAdjustInput): EditTransactionRequest | null => {
  if ((historyBaseline === undefined) !== (historyEditDocumentBaseline === undefined)) {
    throw new Error('batch_auto_adjust.history_authority_incomplete');
  }
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
    operations: buildAdjustmentMutationOperations(currentAdjustments, acceptedAdjustments, currentEditDocumentV2),
    persistence: 'native-committed',
    ...(historyBaseline === undefined || historyEditDocumentBaseline === undefined
      ? {}
      : {
          nativeCommittedHistoryBaseline: historyEditDocumentBaseline,
        }),
    source: 'auto-edit',
    transactionId: result.receipt.transactionId,
  };
};

export const resolveBatchAutoAdjustReconciledHistoryBaseline = ({
  acceptedAdjustments,
  captured,
  capturedAdjustments,
  current,
  currentAdjustments,
}: {
  acceptedAdjustments: Adjustments;
  captured: BatchAutoAdjustSelectionIdentity;
  capturedAdjustments: Adjustments;
  current: BatchAutoAdjustSelectionIdentity | null;
  currentAdjustments: Adjustments | null;
}): Adjustments | null =>
  current !== null &&
  currentAdjustments !== null &&
  current.path === captured.path &&
  current.imageSessionId !== captured.imageSessionId &&
  areAdjustmentsEqual(currentAdjustments, acceptedAdjustments)
    ? capturedAdjustments
    : null;
