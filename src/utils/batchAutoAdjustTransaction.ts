import type { EditDocumentV2 } from '../../packages/rawengine-schema/src/editDocumentV2';
import type { BatchAutoAdjustPathResultV1 } from '../schemas/batchAutoAdjustSchemas';
import { areEditDocumentsEqual } from './adjustmentsSnapshot';
import { buildAutoEditTransactionRequest, selectAutoEditAdjustmentProposal } from './autoEditTransaction';
import type { EditTransactionRequest } from './editTransaction';

export interface BatchAutoAdjustSelectionIdentity {
  adjustmentRevision: number;
  imageSessionId: string;
  path: string;
}

export type BatchAutoAdjustSessionSource = 'cache' | 'cold-load';

export interface BatchAutoAdjustSuccessorBaseline {
  editDocumentV2: EditDocumentV2;
  identity: BatchAutoAdjustSelectionIdentity;
  source: BatchAutoAdjustSessionSource;
}

export interface BatchAutoAdjustPersistenceCompensationInput {
  barrierPersisted: boolean;
  captured: BatchAutoAdjustSelectionIdentity;
  capturedEditDocumentV2: EditDocumentV2;
  current: BatchAutoAdjustSelectionIdentity | null;
  currentEditDocumentV2: EditDocumentV2 | null;
}

export const shouldCompensateBatchAutoAdjustPersistence = ({
  barrierPersisted,
  captured,
  capturedEditDocumentV2,
  current,
  currentEditDocumentV2,
}: BatchAutoAdjustPersistenceCompensationInput): boolean =>
  !barrierPersisted &&
  current !== null &&
  currentEditDocumentV2 !== null &&
  current.path === captured.path &&
  current.imageSessionId === captured.imageSessionId &&
  current.adjustmentRevision === captured.adjustmentRevision &&
  areEditDocumentsEqual(currentEditDocumentV2, capturedEditDocumentV2);

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
  capturedEditDocumentV2,
  current,
  currentEditDocumentV2,
  currentSource = null,
  successorBaseline = null,
}: {
  captured: BatchAutoAdjustSelectionIdentity;
  capturedEditDocumentV2: EditDocumentV2;
  current: BatchAutoAdjustSelectionIdentity | null;
  currentEditDocumentV2: EditDocumentV2 | null;
  currentSource?: BatchAutoAdjustSessionSource | null;
  successorBaseline?: BatchAutoAdjustSuccessorBaseline | null;
}): BatchAutoAdjustSelectionIdentity | null => {
  if (current === null || currentEditDocumentV2 === null || current.path !== captured.path) return null;
  if (
    current.imageSessionId === captured.imageSessionId &&
    current.adjustmentRevision === captured.adjustmentRevision
  ) {
    return current;
  }
  if (areEditDocumentsEqual(currentEditDocumentV2, capturedEditDocumentV2)) return current;
  return successorBaseline !== null &&
    currentSource === successorBaseline.source &&
    current.path === successorBaseline.identity.path &&
    current.imageSessionId === successorBaseline.identity.imageSessionId &&
    current.adjustmentRevision === successorBaseline.identity.adjustmentRevision &&
    areEditDocumentsEqual(currentEditDocumentV2, successorBaseline.editDocumentV2)
    ? current
    : null;
};

interface SelectedBatchAutoAdjustInput {
  acceptedEditDocumentV2: EditDocumentV2;
  captured: BatchAutoAdjustSelectionIdentity;
  current: BatchAutoAdjustSelectionIdentity | null;
  currentEditDocumentV2: EditDocumentV2;
  historyEditDocumentBaseline?: EditDocumentV2;
  result: BatchAutoAdjustPathResultV1;
}

export const buildSelectedBatchAutoAdjustTransaction = ({
  acceptedEditDocumentV2,
  captured,
  current,
  currentEditDocumentV2,
  historyEditDocumentBaseline,
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
    ...buildAutoEditTransactionRequest(
      {
        adjustmentRevision: current.adjustmentRevision,
        editDocumentV2: currentEditDocumentV2,
        graphRevision: `batch:${result.receipt.transactionId}`,
        imageSessionId: current.imageSessionId,
        path: current.path,
      },
      selectAutoEditAdjustmentProposal(acceptedEditDocumentV2),
      result.receipt.transactionId,
    ),
    persistence: 'native-committed',
    ...(historyEditDocumentBaseline === undefined
      ? {}
      : {
          nativeCommittedHistoryBaseline: historyEditDocumentBaseline,
        }),
  };
};

export const resolveBatchAutoAdjustReconciledHistoryBaseline = ({
  acceptedEditDocumentV2,
  captured,
  capturedEditDocumentV2,
  current,
  currentEditDocumentV2,
}: {
  acceptedEditDocumentV2: EditDocumentV2;
  captured: BatchAutoAdjustSelectionIdentity;
  capturedEditDocumentV2: EditDocumentV2;
  current: BatchAutoAdjustSelectionIdentity | null;
  currentEditDocumentV2: EditDocumentV2 | null;
}): EditDocumentV2 | null =>
  current !== null &&
  currentEditDocumentV2 !== null &&
  current.path === captured.path &&
  current.imageSessionId !== captured.imageSessionId &&
  areEditDocumentsEqual(currentEditDocumentV2, acceptedEditDocumentV2)
    ? capturedEditDocumentV2
    : null;
