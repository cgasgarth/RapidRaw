import type { EditDocumentV2 } from '../../packages/rawengine-schema/src/editDocumentV2';
import type { EditHistoryCheckpoint } from './editHistory';
import type { EditTransactionRequest } from './editTransaction';

export interface HistoryNavigationEditTransactionState {
  adjustmentRevision: number;
  history: readonly EditDocumentV2[];
  imageSession: { id: string } | null;
  imageSessionId: number;
}

export const buildHistoryNavigationEditTransaction = (
  state: HistoryNavigationEditTransactionState,
  historyTargetIndex: number,
  transactionId: string,
): EditTransactionRequest => {
  const editDocumentV2 = state.history[historyTargetIndex];
  if (!Number.isInteger(historyTargetIndex) || historyTargetIndex < 0 || editDocumentV2 === undefined) {
    throw new Error(`edit_transaction.invalid_history_target:${String(historyTargetIndex)}`);
  }
  return {
    baseAdjustmentRevision: state.adjustmentRevision,
    history: 'navigation',
    historyTargetIndex,
    imageSessionId: state.imageSession?.id ?? `editor-image-session:${String(state.imageSessionId)}`,
    operations: [
      {
        editDocumentV2,
        type: 'replace-edit-document',
      },
    ],
    persistence: 'commit',
    source: 'history',
    transactionId,
  };
};

export const buildHistoryRestorationEditTransaction = (
  state: HistoryNavigationEditTransactionState,
  history: readonly EditDocumentV2[],
  historyCheckpoints: readonly EditHistoryCheckpoint[],
  historyTargetIndex: number,
  transactionId: string,
): EditTransactionRequest => {
  const editDocumentV2 = history[historyTargetIndex];
  if (
    !Number.isInteger(historyTargetIndex) ||
    historyTargetIndex < 0 ||
    editDocumentV2 === undefined ||
    history.length === 0
  ) {
    throw new Error(`edit_transaction.invalid_history_target:${String(historyTargetIndex)}`);
  }
  return {
    baseAdjustmentRevision: state.adjustmentRevision,
    compensationHistory: {
      checkpoints: structuredClone([...historyCheckpoints]),
      entries: [...history],
      historyIndex: historyTargetIndex,
    },
    history: 'compensation',
    imageSessionId: state.imageSession?.id ?? `editor-image-session:${String(state.imageSessionId)}`,
    operations: [
      {
        editDocumentV2,
        type: 'replace-edit-document',
      },
    ],
    persistence: 'commit',
    source: 'history',
    transactionId,
  };
};
