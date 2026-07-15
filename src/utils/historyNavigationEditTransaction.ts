import type { Adjustments } from './adjustments';
import type { EditTransactionRequest } from './editTransaction';

export interface HistoryNavigationEditTransactionState {
  adjustmentRevision: number;
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
  return {
    baseAdjustmentRevision: state.adjustmentRevision,
    history: 'navigation',
    historyTargetIndex,
    imageSessionId: state.imageSession?.id ?? `editor-image-session:${String(state.imageSessionId)}`,
    operations: [{ adjustments: structuredClone(adjustments), type: 'replace-adjustments' }],
    persistence: 'commit',
    source: 'history',
    transactionId,
  };
};
