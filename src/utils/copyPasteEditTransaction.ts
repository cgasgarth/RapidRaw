import type { EditDocumentNodeTypeV2, EditDocumentV2 } from '../../packages/rawengine-schema/src/editDocumentV2';
import type { Adjustments } from './adjustments';
import type { EditDocumentV2CopyPayload } from './editDocumentV2';
import type { EditHistoryCheckpoint } from './editHistory';
import type {
  EditApplicationReceipt,
  EditTransactionPersistenceContext,
  EditTransactionRequest,
} from './editTransaction';

export interface CopyPasteEditTransactionState {
  adjustmentRevision: number;
  readonly editDocumentV2: EditDocumentV2;
  imageSession: { id: string } | null;
  imageSessionId: number;
  selectedImage: { path: string } | null;
}

export interface CopyPasteCompensationTarget {
  adjustmentRevision: number;
  editDocumentV2: EditDocumentV2;
  history: EditDocumentV2[];
  historyCheckpoints: EditHistoryCheckpoint[];
  historyIndex: number;
  imageSessionId: string;
  targetPath: string;
}

export const buildCopyPasteEditTransaction = (
  state: CopyPasteEditTransactionState,
  targetPath: string,
  payload: EditDocumentV2CopyPayload,
  transactionId: string,
): EditTransactionRequest => {
  if (state.selectedImage?.path !== targetPath) {
    throw new Error(`copy_paste_transaction.stale_source:${targetPath}:${state.selectedImage?.path ?? 'none'}`);
  }
  return {
    baseAdjustmentRevision: state.adjustmentRevision,
    history: 'single-entry',
    imageSessionId: state.imageSession?.id ?? `editor-image-session:${String(state.imageSessionId)}`,
    operations: Object.entries(payload.nodes).flatMap(([nodeType, node]) =>
      node === undefined
        ? []
        : [
            {
              node: structuredClone(node),
              nodeType: nodeType as EditDocumentNodeTypeV2,
              type: 'replace-edit-document-node' as const,
            },
          ],
    ),
    persistence: 'commit',
    source: 'copy-paste',
    transactionId,
  };
};

export const captureCopyPasteCompensationTarget = (
  state: CopyPasteEditTransactionState & {
    history: EditDocumentV2[];
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
    editDocumentV2: structuredClone(state.editDocumentV2),
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
    operations: [
      {
        editDocumentV2: structuredClone(target.editDocumentV2),
        type: 'replace-edit-document',
      },
    ],
    persistence: 'native-committed',
    source: 'copy-paste',
    transactionId: `${transaction.transactionId}:compensate`,
  };
};
