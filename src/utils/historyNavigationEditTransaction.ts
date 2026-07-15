import type { EditDocumentV2 } from '../../packages/rawengine-schema/src/editDocumentV2';
import type { Adjustments } from './adjustments';
import { legacyAdjustmentsToEditDocumentV2 } from './editDocumentV2';
import type { EditHistoryCheckpoint } from './editHistory';
import type { EditTransactionRequest } from './editTransaction';

export interface HistoryNavigationEditTransactionState {
  adjustmentRevision: number;
  editDocumentHistory?: readonly EditDocumentV2[];
  history: readonly Adjustments[];
  imageSession: { id: string } | null;
  imageSessionId: number;
}

export const buildHistoryNavigationEditTransaction = (
  state: HistoryNavigationEditTransactionState,
  historyTargetIndex: number,
  transactionId: string,
): EditTransactionRequest => {
  const adjustments = state.history[historyTargetIndex];
  if (!Number.isInteger(historyTargetIndex) || historyTargetIndex < 0 || adjustments === undefined) {
    throw new Error(`edit_transaction.invalid_history_target:${String(historyTargetIndex)}`);
  }
  const editDocumentV2 =
    state.editDocumentHistory?.[historyTargetIndex] ?? legacyAdjustmentsToEditDocumentV2(adjustments);
  return {
    baseAdjustmentRevision: state.adjustmentRevision,
    history: 'navigation',
    historyTargetIndex,
    imageSessionId: state.imageSession?.id ?? `editor-image-session:${String(state.imageSessionId)}`,
    operations: [
      {
        adjustments: structuredClone(adjustments),
        editDocumentV2: structuredClone(editDocumentV2),
        type: 'replace-edit-authority',
      },
    ],
    persistence: 'commit',
    source: 'history',
    transactionId,
  };
};

export const buildHistoryRestorationEditTransaction = (
  state: HistoryNavigationEditTransactionState,
  history: readonly Adjustments[],
  editDocumentHistory: readonly EditDocumentV2[],
  historyCheckpoints: readonly EditHistoryCheckpoint[],
  historyTargetIndex: number,
  transactionId: string,
): EditTransactionRequest => {
  const adjustments = history[historyTargetIndex];
  const editDocumentV2 = editDocumentHistory[historyTargetIndex];
  if (
    !Number.isInteger(historyTargetIndex) ||
    historyTargetIndex < 0 ||
    adjustments === undefined ||
    editDocumentV2 === undefined ||
    editDocumentHistory.length !== history.length
  ) {
    throw new Error(`edit_transaction.invalid_history_target:${String(historyTargetIndex)}`);
  }
  return {
    baseAdjustmentRevision: state.adjustmentRevision,
    compensationHistory: {
      checkpoints: structuredClone([...historyCheckpoints]),
      editDocumentEntries: structuredClone([...editDocumentHistory]),
      entries: structuredClone([...history]),
      historyIndex: historyTargetIndex,
    },
    history: 'compensation',
    imageSessionId: state.imageSession?.id ?? `editor-image-session:${String(state.imageSessionId)}`,
    operations: [
      {
        adjustments: structuredClone(adjustments),
        editDocumentV2: structuredClone(editDocumentV2),
        type: 'replace-edit-authority',
      },
    ],
    persistence: 'commit',
    source: 'history',
    transactionId,
  };
};
