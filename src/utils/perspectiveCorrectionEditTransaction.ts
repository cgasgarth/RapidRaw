import type { EditDocumentV2 } from '../../packages/rawengine-schema/src/editDocumentV2';
import { perspectiveCorrectionSettingsSchema } from '../../packages/rawengine-schema/src/geometry/perspective/perspectiveSchemas';
import type { Adjustments } from './adjustments';
import { selectEditDocumentGeometry } from './editDocumentSelectors';
import type { EditTransactionRequest } from './editTransaction';

export interface PerspectiveCorrectionCommitIdentity {
  adjustmentRevision: number;
  imageSessionId: string;
  sourceIdentity: string;
}

export interface PerspectiveCorrectionEditTransactionState {
  adjustmentRevision: number;
  editDocumentV2: EditDocumentV2;
  imageSession: { id: string } | null;
  imageSessionId: number;
  selectedImage: { path: string } | null;
}

const currentImageSessionId = (state: PerspectiveCorrectionEditTransactionState): string =>
  state.imageSession?.id ?? `editor-image-session:${String(state.imageSessionId)}`;

export const capturePerspectiveCorrectionCommitIdentity = (
  state: PerspectiveCorrectionEditTransactionState,
): PerspectiveCorrectionCommitIdentity | null =>
  state.selectedImage !== null
    ? {
        adjustmentRevision: state.adjustmentRevision,
        imageSessionId: currentImageSessionId(state),
        sourceIdentity: state.selectedImage.path,
      }
    : null;

const isCurrentPerspectiveCorrectionIdentity = (
  state: PerspectiveCorrectionEditTransactionState,
  identity: PerspectiveCorrectionCommitIdentity,
): boolean =>
  state.adjustmentRevision === identity.adjustmentRevision &&
  currentImageSessionId(state) === identity.imageSessionId &&
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
  if (currentImageSessionId(state) !== identity.imageSessionId) {
    throw new Error(
      `perspective_correction_transaction.stale_session:${identity.imageSessionId}:${currentImageSessionId(state)}`,
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
    ...selectEditDocumentGeometry(state.editDocumentV2).perspectiveCorrection,
    ...structuredClone(patch),
  });
  return {
    baseAdjustmentRevision: identity.adjustmentRevision,
    history: 'single-entry',
    imageSessionId: identity.imageSessionId,
    operations: [{ nodeType: 'geometry', patch: { perspectiveCorrection }, type: 'patch-edit-document-node' }],
    persistence: 'commit',
    source: 'geometry-tool',
    transactionId,
  };
};
