import type { Adjustments } from './adjustments';
import {
  buildAdjustmentMutationOperations,
  type EditApplicationReceipt,
  type EditTransactionPersistenceContext,
  type EditTransactionRequest,
} from './editTransaction';
import { reconcileReferenceMatchReceiptsAfterEdit } from './referenceMatchTransfer';

export interface CopyPasteEditTransactionState {
  adjustmentRevision: number;
  adjustments: Adjustments;
  imageSession: { id: string } | null;
  imageSessionId: number;
  selectedImage: { path: string } | null;
}

export const buildCopyPasteEditTransaction = (
  state: CopyPasteEditTransactionState,
  targetPath: string,
  adjustmentPatch: Partial<Adjustments>,
  transactionId: string,
): EditTransactionRequest => {
  if (state.selectedImage?.path !== targetPath) {
    throw new Error(`copy_paste_transaction.stale_source:${targetPath}:${state.selectedImage?.path ?? 'none'}`);
  }
  return {
    baseAdjustmentRevision: state.adjustmentRevision,
    history: 'single-entry',
    imageSessionId: state.imageSession?.id ?? `editor-image-session:${String(state.imageSessionId)}`,
    operations: buildAdjustmentMutationOperations(
      state.adjustments,
      reconcileReferenceMatchReceiptsAfterEdit(state.adjustments, {
        ...state.adjustments,
        ...adjustmentPatch,
      }),
    ),
    persistence: 'commit',
    source: 'copy-paste',
    transactionId,
  };
};

export type CopyPasteCompletionStatus =
  | 'current'
  | 'stale-source'
  | 'stale-session'
  | 'stale-revision'
  | 'stale-transaction';

export const classifyCopyPasteNativeCompletion = (
  state: {
    adjustmentRevision: number;
    imageSession: { id: string } | null;
    lastEditApplicationReceipt: EditApplicationReceipt | null;
    selectedImage: { path: string } | null;
  },
  targetPath: string,
  transaction: EditTransactionPersistenceContext,
): CopyPasteCompletionStatus => {
  if (state.selectedImage?.path !== targetPath) return 'stale-source';
  if (state.imageSession?.id !== transaction.imageSessionId) return 'stale-session';
  if (state.adjustmentRevision !== transaction.nextAdjustmentRevision) return 'stale-revision';
  const receipt = state.lastEditApplicationReceipt;
  if (
    receipt?.transactionId !== transaction.transactionId ||
    receipt.imageSessionId !== transaction.imageSessionId ||
    receipt.adjustmentRevision !== transaction.nextAdjustmentRevision ||
    receipt.source !== 'copy-paste'
  ) {
    return 'stale-transaction';
  }
  return 'current';
};
