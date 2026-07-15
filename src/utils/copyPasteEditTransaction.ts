import type { Adjustments } from './adjustments';
import type { EditHistoryCheckpoint } from './editHistory';
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

export interface CopyPasteCompensationTarget {
  adjustmentRevision: number;
  adjustments: Adjustments;
  history: Adjustments[];
  historyCheckpoints: EditHistoryCheckpoint[];
  historyIndex: number;
  imageSessionId: string;
  targetPath: string;
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

export const captureCopyPasteCompensationTarget = (
  state: CopyPasteEditTransactionState & {
    history: Adjustments[];
    historyCheckpoints: EditHistoryCheckpoint[];
    historyIndex: number;
  },
  targetPath: string,
): CopyPasteCompensationTarget => {
  if (state.selectedImage?.path !== targetPath) {
    throw new Error(`copy_paste_compensation.stale_source:${targetPath}:${state.selectedImage?.path ?? 'none'}`);
  }
  return {
    adjustmentRevision: state.adjustmentRevision,
    adjustments: structuredClone(state.adjustments),
    history: structuredClone(state.history),
    historyCheckpoints: structuredClone(state.historyCheckpoints),
    historyIndex: state.historyIndex,
    imageSessionId: state.imageSession?.id ?? `editor-image-session:${String(state.imageSessionId)}`,
    targetPath,
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

export const buildCopyPastePersistenceCompensation = (
  state: CopyPasteEditTransactionState & { lastEditApplicationReceipt: EditApplicationReceipt | null },
  transaction: EditTransactionPersistenceContext,
  target: CopyPasteCompensationTarget,
): EditTransactionRequest | null => {
  if (
    target.targetPath !== state.selectedImage?.path ||
    target.imageSessionId !== transaction.imageSessionId ||
    target.adjustmentRevision !== transaction.baseAdjustmentRevision ||
    classifyCopyPasteNativeCompletion(state, target.targetPath, transaction) !== 'current'
  ) {
    return null;
  }

  return {
    baseAdjustmentRevision: state.adjustmentRevision,
    compensationHistory: {
      checkpoints: structuredClone(target.historyCheckpoints),
      entries: structuredClone(target.history),
      historyIndex: target.historyIndex,
    },
    history: 'compensation',
    imageSessionId: target.imageSessionId,
    operations: buildAdjustmentMutationOperations(state.adjustments, target.adjustments),
    persistence: 'native-committed',
    source: 'copy-paste',
    transactionId: `${transaction.transactionId}:compensate`,
  };
};
