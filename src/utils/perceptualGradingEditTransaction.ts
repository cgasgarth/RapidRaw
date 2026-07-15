import type { Adjustments } from './adjustments';
import type { EditTransactionRequest } from './editTransaction';

export interface PerceptualGradingCommitIdentity {
  adjustmentRevision: number;
  imageSessionId: string;
  sourceIdentity: string;
}

export interface PerceptualGradingEditTransactionState {
  adjustmentRevision: number;
  imageSession: { id: string } | null;
  selectedImage: { path: string } | null;
}

export const buildPerceptualGradingEditTransaction = (
  state: PerceptualGradingEditTransactionState,
  identity: PerceptualGradingCommitIdentity,
  colorGrading: Adjustments['colorGrading'],
  perceptualGradingV1: NonNullable<Adjustments['perceptualGradingV1']>,
  transactionId: string,
): EditTransactionRequest => {
  if (state.selectedImage?.path !== identity.sourceIdentity) {
    throw new Error(
      `perceptual_grading_transaction.stale_source:${identity.sourceIdentity}:${state.selectedImage?.path ?? 'none'}`,
    );
  }
  if (state.imageSession?.id !== identity.imageSessionId) {
    throw new Error(
      `perceptual_grading_transaction.stale_session:${identity.imageSessionId}:${state.imageSession?.id ?? 'none'}`,
    );
  }
  if (state.adjustmentRevision !== identity.adjustmentRevision) {
    throw new Error(
      `perceptual_grading_transaction.stale_revision:${String(identity.adjustmentRevision)}:${String(state.adjustmentRevision)}`,
    );
  }
  return {
    baseAdjustmentRevision: identity.adjustmentRevision,
    history: 'single-entry',
    imageSessionId: identity.imageSessionId,
    operations: [
      {
        nodeType: 'perceptual_grading',
        patch: {
          colorGrading: structuredClone(colorGrading),
          perceptualGradingV1: structuredClone(perceptualGradingV1),
        },
        type: 'patch-edit-document-node',
      },
    ],
    persistence: 'commit',
    source: 'manual-control',
    transactionId,
  };
};
