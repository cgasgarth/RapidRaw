import { perspectiveCorrectionSettingsSchema } from '../../packages/rawengine-schema/src/geometry/perspective/perspectiveSchemas';
import type { Adjustments } from './adjustments';
import type { EditTransactionRequest } from './editTransaction';

export interface PerspectiveCorrectionCommitIdentity {
  adjustmentRevision: number;
  imageSessionId: string;
  sourceIdentity: string;
}

export interface PerspectiveCorrectionEditTransactionState {
  adjustmentRevision: number;
  adjustments: Pick<Adjustments, 'perspectiveCorrection'>;
  imageSession: { id: string } | null;
  selectedImage: { path: string } | null;
}

export const capturePerspectiveCorrectionCommitIdentity = (
  state: PerspectiveCorrectionEditTransactionState,
): PerspectiveCorrectionCommitIdentity | null =>
  state.selectedImage !== null && state.imageSession !== null
    ? {
        adjustmentRevision: state.adjustmentRevision,
        imageSessionId: state.imageSession.id,
        sourceIdentity: state.selectedImage.path,
      }
    : null;

export const isCurrentPerspectiveCorrectionIdentity = (
  state: PerspectiveCorrectionEditTransactionState,
  identity: PerspectiveCorrectionCommitIdentity,
): boolean =>
  state.adjustmentRevision === identity.adjustmentRevision &&
  state.imageSession?.id === identity.imageSessionId &&
  state.selectedImage?.path === identity.sourceIdentity;

export const isCurrentPerspectiveAnalysisRequest = (
  state: PerspectiveCorrectionEditTransactionState,
  identity: PerspectiveCorrectionCommitIdentity,
  requestGeneration: number,
  currentRequestGeneration: number,
): boolean => requestGeneration === currentRequestGeneration && isCurrentPerspectiveCorrectionIdentity(state, identity);

const assertCurrentPerspectiveCorrectionIdentity = (
  state: PerspectiveCorrectionEditTransactionState,
  identity: PerspectiveCorrectionCommitIdentity,
): void => {
  if (state.selectedImage?.path !== identity.sourceIdentity) {
    throw new Error(
      `perspective_correction_transaction.stale_source:${identity.sourceIdentity}:${state.selectedImage?.path ?? 'none'}`,
    );
  }
  if (state.imageSession?.id !== identity.imageSessionId) {
    throw new Error(
      `perspective_correction_transaction.stale_session:${identity.imageSessionId}:${state.imageSession?.id ?? 'none'}`,
    );
  }
  if (state.adjustmentRevision !== identity.adjustmentRevision) {
    throw new Error(
      `perspective_correction_transaction.stale_revision:${String(identity.adjustmentRevision)}:${String(state.adjustmentRevision)}`,
    );
  }
};

export const buildPerspectiveCorrectionEditTransaction = (
  state: PerspectiveCorrectionEditTransactionState,
  identity: PerspectiveCorrectionCommitIdentity,
  patch: Partial<Adjustments['perspectiveCorrection']>,
  transactionId: string,
): EditTransactionRequest => {
  assertCurrentPerspectiveCorrectionIdentity(state, identity);
  const perspectiveCorrection = perspectiveCorrectionSettingsSchema.parse({
    ...state.adjustments.perspectiveCorrection,
    ...structuredClone(patch),
  });
  return {
    baseAdjustmentRevision: identity.adjustmentRevision,
    history: 'single-entry',
    imageSessionId: identity.imageSessionId,
    operations: [{ patch: { perspectiveCorrection }, type: 'patch-adjustments' }],
    persistence: 'commit',
    source: 'geometry-tool',
    transactionId,
  };
};
