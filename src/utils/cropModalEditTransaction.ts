import type { Adjustments } from './adjustments';
import type { EditTransactionRequest } from './editTransaction';

export interface CropModalEditIdentity {
  adjustmentRevision: number;
  imageSessionId: string;
  sourceIdentity: string;
}

export interface CropModalEditTransactionState {
  adjustmentRevision: number;
  imageSession: { id: string } | null;
  imageSessionId: number;
  selectedImage: { path: string } | null;
}

export interface TransformModalPatchInput {
  aspect: number;
  distortion: number;
  horizontal: number;
  rotate: number;
  scale: number;
  vertical: number;
  x_offset: number;
  y_offset: number;
}

export type LensModalPatchInput = Pick<
  Adjustments,
  | 'lensCorrectionMode'
  | 'lensDistortionAmount'
  | 'lensDistortionEnabled'
  | 'lensDistortionParams'
  | 'lensMaker'
  | 'lensModel'
  | 'lensTcaAmount'
  | 'lensTcaEnabled'
  | 'lensVignetteAmount'
  | 'lensVignetteEnabled'
>;

const currentImageSessionId = (state: CropModalEditTransactionState): string =>
  state.imageSession?.id ?? `editor-image-session:${String(state.imageSessionId)}`;

export const captureCropModalEditIdentity = (state: CropModalEditTransactionState): CropModalEditIdentity | null =>
  state.selectedImage === null
    ? null
    : {
        adjustmentRevision: state.adjustmentRevision,
        imageSessionId: currentImageSessionId(state),
        sourceIdentity: state.selectedImage.path,
      };

export const isCurrentCropModalEditIdentity = (
  state: CropModalEditTransactionState,
  identity: CropModalEditIdentity,
): boolean =>
  state.adjustmentRevision === identity.adjustmentRevision &&
  currentImageSessionId(state) === identity.imageSessionId &&
  state.selectedImage?.path === identity.sourceIdentity;

const assertCurrentIdentity = (state: CropModalEditTransactionState, identity: CropModalEditIdentity): void => {
  if (state.selectedImage?.path !== identity.sourceIdentity) {
    throw new Error('crop_modal_transaction.stale_source');
  }
  if (currentImageSessionId(state) !== identity.imageSessionId) {
    throw new Error('crop_modal_transaction.stale_session');
  }
  if (state.adjustmentRevision !== identity.adjustmentRevision) {
    throw new Error('crop_modal_transaction.stale_revision');
  }
};

export const buildTransformModalEditTransaction = (
  state: CropModalEditTransactionState,
  identity: CropModalEditIdentity,
  input: TransformModalPatchInput,
  transactionId: string,
): EditTransactionRequest => {
  assertCurrentIdentity(state, identity);
  return {
    baseAdjustmentRevision: identity.adjustmentRevision,
    history: 'single-entry',
    imageSessionId: identity.imageSessionId,
    operations: [
      {
        nodeType: 'geometry',
        patch: {
          transformAspect: input.aspect,
          transformDistortion: input.distortion,
          transformHorizontal: input.horizontal,
          transformRotate: input.rotate,
          transformScale: input.scale,
          transformVertical: input.vertical,
          transformXOffset: input.x_offset,
          transformYOffset: input.y_offset,
        },
        type: 'patch-edit-document-node',
      },
    ],
    persistence: 'commit',
    source: 'geometry-tool',
    transactionId,
  };
};

export const buildLensModalEditTransaction = (
  state: CropModalEditTransactionState,
  identity: CropModalEditIdentity,
  patch: LensModalPatchInput,
  transactionId: string,
): EditTransactionRequest => {
  assertCurrentIdentity(state, identity);
  return {
    baseAdjustmentRevision: identity.adjustmentRevision,
    history: 'single-entry',
    imageSessionId: identity.imageSessionId,
    operations: [
      {
        nodeType: 'lens_correction',
        patch: structuredClone(patch),
        type: 'patch-edit-document-node',
      },
    ],
    persistence: 'commit',
    source: 'manual-control',
    transactionId,
  };
};
