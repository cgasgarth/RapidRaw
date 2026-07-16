import type { Adjustments } from './adjustments';
import { calculateCenteredCrop } from './cropUtils';
import type { EditTransactionRequest } from './editTransaction';

export interface OrientationRotateCommitIdentity {
  adjustmentRevision: number;
  imageSessionId: string;
  sourceIdentity: string;
}

export interface OrientationRotateEditTransactionState {
  adjustmentRevision: number;
  adjustmentSnapshot: {
    readonly value: Pick<Adjustments, 'aspectRatio' | 'crop' | 'orientationSteps' | 'rotation'>;
  };
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
  const currentOrientationSteps = state.adjustmentSnapshot.value.orientationSteps || 0;
  if (quarterTurns === 0) {
    return {
      baseAdjustmentRevision: identity.adjustmentRevision,
      history: 'single-entry',
      imageSessionId: identity.imageSessionId,
      operations: [
        {
          nodeType: 'geometry',
          patch: {
            aspectRatio: state.adjustmentSnapshot.value.aspectRatio,
            crop: state.adjustmentSnapshot.value.crop,
            orientationSteps: currentOrientationSteps,
            rotation: state.adjustmentSnapshot.value.rotation,
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
  const aspectRatio =
    quarterTurns % 2 === 1 &&
    state.adjustmentSnapshot.value.aspectRatio &&
    state.adjustmentSnapshot.value.aspectRatio !== 0
      ? 1 / state.adjustmentSnapshot.value.aspectRatio
      : state.adjustmentSnapshot.value.aspectRatio;
  const width = state.selectedImage?.width;
  const height = state.selectedImage?.height;
  const crop = width && height ? calculateCenteredCrop(width, height, orientationSteps, aspectRatio) : null;

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
