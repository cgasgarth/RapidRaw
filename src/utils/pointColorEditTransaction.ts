import type { Adjustments } from './adjustments';
import type { EditTransactionRequest } from './editTransaction';

export interface PointColorCommitIdentity {
  adjustmentRevision: number;
  imageSessionId: string;
  sourceIdentity: string;
}

export interface PointColorEditTransactionState {
  adjustmentRevision: number;
  adjustments: Pick<Adjustments, 'pointColor'>;
  imageSession: { id: string } | null;
  selectedImage: { path: string } | null;
}

export const buildPointColorEditTransaction = (
  state: PointColorEditTransactionState,
  identity: PointColorCommitIdentity,
  patch: Partial<Adjustments['pointColor']>,
  transactionId: string,
): EditTransactionRequest => {
  if (state.selectedImage?.path !== identity.sourceIdentity) {
    throw new Error(
      `point_color_transaction.stale_source:${identity.sourceIdentity}:${state.selectedImage?.path ?? 'none'}`,
    );
  }
  if (state.imageSession?.id !== identity.imageSessionId) {
    throw new Error(
      `point_color_transaction.stale_session:${identity.imageSessionId}:${state.imageSession?.id ?? 'none'}`,
    );
  }
  if (state.adjustmentRevision !== identity.adjustmentRevision) {
    throw new Error(
      `point_color_transaction.stale_revision:${String(identity.adjustmentRevision)}:${String(state.adjustmentRevision)}`,
    );
  }

  return {
    baseAdjustmentRevision: identity.adjustmentRevision,
    history: 'single-entry',
    imageSessionId: identity.imageSessionId,
    operations: [
      {
        nodeType: 'point_color',
        patch: { pointColor: { ...structuredClone(state.adjustments.pointColor), ...structuredClone(patch) } },
        type: 'patch-edit-document-node',
      },
    ],
    persistence: 'commit',
    source: 'manual-control',
    transactionId,
  };
};
