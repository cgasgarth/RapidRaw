import type { Adjustments } from '../adjustments';
import type { EditTransactionHistory, EditTransactionRequest } from '../editTransaction';
import { reconcileReferenceMatchReceiptsAfterEdit } from '../referenceMatchTransfer';

export interface FilmWorkspaceEditState {
  adjustmentRevision: number;
  adjustments: Adjustments;
  imageSessionId: number;
  imageSession?: { id: string } | null;
}

/**
 * Converts one Film workspace intent into the canonical revision-checked editor
 * transaction. The compatibility patch remains node-scoped and carries any
 * provenance cleanup that the requested Film fields invalidate.
 */
export const buildFilmWorkspaceEditTransactionRequest = (
  state: FilmWorkspaceEditState,
  patch: Partial<Adjustments>,
  transactionId: string,
  history: EditTransactionHistory = 'single-entry',
): EditTransactionRequest => {
  const next = reconcileReferenceMatchReceiptsAfterEdit(state.adjustments, {
    ...state.adjustments,
    ...structuredClone(patch),
  });
  const provenancePatch =
    next.referenceMatchApplicationReceipt === state.adjustments.referenceMatchApplicationReceipt
      ? {}
      : { referenceMatchApplicationReceipt: next.referenceMatchApplicationReceipt };

  return {
    transactionId,
    imageSessionId: state.imageSession?.id ?? `editor-image-session:${String(state.imageSessionId)}`,
    baseAdjustmentRevision: state.adjustmentRevision,
    source: 'film-workspace',
    operations: [{ type: 'patch-adjustments', patch: { ...structuredClone(patch), ...provenancePatch } }],
    history,
    persistence: 'commit',
  };
};
