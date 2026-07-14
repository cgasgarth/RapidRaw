import type { Adjustments } from '../adjustments';
import type { EditTransactionRequest } from '../editTransaction';

export interface LayerEditTransactionState {
  adjustmentRevision: number;
  adjustments: Adjustments;
  imageSessionId: number;
  imageSession?: { id: string } | null;
}

export const buildLayerEditTransactionRequest = (
  state: LayerEditTransactionState,
  nextAdjustments: Adjustments,
  transactionId: string,
): EditTransactionRequest => ({
  transactionId,
  imageSessionId: state.imageSession?.id ?? `editor-image-session:${String(state.imageSessionId)}`,
  baseAdjustmentRevision: state.adjustmentRevision,
  source: 'layer-command',
  operations: [{ type: 'replace-adjustments', adjustments: nextAdjustments }],
  history: 'single-entry',
  persistence: 'commit',
});
