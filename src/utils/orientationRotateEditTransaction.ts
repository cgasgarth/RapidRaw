import type { EditDocumentV2 } from '../../packages/rawengine-schema/src/editDocumentV2';
import { calculateCenteredCrop, getOrientedDimensions, normalizedCropFromPixelCrop } from './cropUtils';
import { selectEditDocumentGeometry } from './editDocumentSelectors';
import type { EditTransactionRequest } from './editTransaction';

export interface OrientationRotateCommitIdentity {
  adjustmentRevision: number;
  imageSessionId: string;
  sourceIdentity: string;
}

export interface OrientationRotateEditTransactionState {
  adjustmentRevision: number;
  editDocumentV2: EditDocumentV2;
  imageSession: { id: string } | null;
  imageSessionId: number;
  selectedImage: { height?: number | null; path: string; width?: number | null } | null;
}

const currentImageSessionId = (state: OrientationRotateEditTransactionState): string =>
  state.imageSession?.id ?? `editor-image-session:${String(state.imageSessionId)}`;

export const captureOrientationRotateCommitIdentity = (
  state: OrientationRotateEditTransactionState,
): OrientationRotateCommitIdentity | null =>
  state.selectedImage === null
    ? null
    : {
        adjustmentRevision: state.adjustmentRevision,
        imageSessionId: currentImageSessionId(state),
        sourceIdentity: state.selectedImage.path,
      };

const assertCurrentIdentity = (
  state: OrientationRotateEditTransactionState,
  identity: OrientationRotateCommitIdentity,
): void => {
  if (state.selectedImage?.path !== identity.sourceIdentity) {
    throw new Error('orientation_rotate_transaction.stale_source');
  }
  if (currentImageSessionId(state) !== identity.imageSessionId) {
    throw new Error('orientation_rotate_transaction.stale_session');
  }
  if (state.adjustmentRevision !== identity.adjustmentRevision) {
    throw new Error('orientation_rotate_transaction.stale_revision');
  }
};

const normalizeQuarterTurns = (degrees: number): number => {
  if (!Number.isFinite(degrees) || degrees % 90 !== 0) {
    throw new Error('orientation_rotate_transaction.invalid_degrees');
  }
  return (((degrees / 90) % 4) + 4) % 4;
};

export const buildOrientationRotateEditTransaction = (
  state: OrientationRotateEditTransactionState,
  identity: OrientationRotateCommitIdentity,
  degrees: number,
  transactionId: string,
): EditTransactionRequest => {
  assertCurrentIdentity(state, identity);
  const quarterTurns = normalizeQuarterTurns(degrees);
  const currentOrientationSteps = selectEditDocumentGeometry(state.editDocumentV2).orientationSteps || 0;
  if (quarterTurns === 0) {
    return {
      baseAdjustmentRevision: identity.adjustmentRevision,
      history: 'single-entry',
      imageSessionId: identity.imageSessionId,
      operations: [
        {
          nodeType: 'geometry',
          patch: {
            aspectRatio: selectEditDocumentGeometry(state.editDocumentV2).aspectRatio,
            crop: selectEditDocumentGeometry(state.editDocumentV2).crop,
            orientationSteps: currentOrientationSteps,
            rotation: selectEditDocumentGeometry(state.editDocumentV2).rotation,
          },
          type: 'patch-edit-document-node',
        },
      ],
      persistence: 'commit',
      source: 'geometry-tool',
      transactionId,
    };
  }

  const orientationSteps = (currentOrientationSteps + quarterTurns) % 4;
  const currentAspectRatio = selectEditDocumentGeometry(state.editDocumentV2).aspectRatio;
  const aspectRatio =
    quarterTurns % 2 === 1 && currentAspectRatio !== null && currentAspectRatio !== 0
      ? 1 / currentAspectRatio
      : currentAspectRatio;
  const width = state.selectedImage?.width;
  const height = state.selectedImage?.height;
  const pixelCrop = width && height ? calculateCenteredCrop(width, height, orientationSteps, aspectRatio) : null;
  const orientedDimensions = width && height ? getOrientedDimensions(width, height, orientationSteps) : null;
  const crop =
    pixelCrop && orientedDimensions
      ? normalizedCropFromPixelCrop(pixelCrop, orientedDimensions.width, orientedDimensions.height)
      : null;

  return {
    baseAdjustmentRevision: identity.adjustmentRevision,
    history: 'single-entry',
    imageSessionId: identity.imageSessionId,
    operations: [
      {
        nodeType: 'geometry',
        patch: { aspectRatio, crop, orientationSteps, rotation: 0 },
        type: 'patch-edit-document-node',
      },
    ],
    persistence: 'commit',
    source: 'geometry-tool',
    transactionId,
  };
};
