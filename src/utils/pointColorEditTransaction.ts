import type { Adjustments } from './adjustments';
import type { EditTransactionRequest } from './editTransaction';

export interface PointColorCommitIdentity {
  adjustmentRevision: number;
  imageSessionId: string;
  sourceIdentity: string;
}

export interface PointColorEditTransactionState {
  adjustmentRevision: number;
  adjustmentSnapshot: { readonly value: Pick<Adjustments, 'pointColor'> };
  imageSession: { id: string } | null;
  imageSessionId: number;
  selectedImage: { path: string } | null;
}

const currentImageSessionId = (state: PointColorEditTransactionState): string =>
  state.imageSession?.id ?? `editor-image-session:${String(state.imageSessionId)}`;

export const isCurrentPointColorIdentity = (
  state: PointColorEditTransactionState,
  identity: PointColorCommitIdentity,
): boolean =>
  state.adjustmentRevision === identity.adjustmentRevision &&
  currentImageSessionId(state) === identity.imageSessionId &&
  state.selectedImage?.path === identity.sourceIdentity;

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
  if (currentImageSessionId(state) !== identity.imageSessionId) {
    throw new Error(`point_color_transaction.stale_session:${identity.imageSessionId}:${currentImageSessionId(state)}`);
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
        patch: {
          pointColor: { ...structuredClone(state.adjustmentSnapshot.value.pointColor), ...structuredClone(patch) },
        },
        type: 'patch-edit-document-node',
      },
    ],
    persistence: 'commit',
    source: 'manual-control',
    transactionId,
  };
};
