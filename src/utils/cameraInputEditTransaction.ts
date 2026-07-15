import type { Adjustments } from './adjustments';
import type { EditTransactionRequest } from './editTransaction';

export type CameraInputParameters = Pick<
  Adjustments,
  | 'cameraProfile'
  | 'cameraProfileAmount'
  | 'creativeTemperature'
  | 'creativeTint'
  | 'temperature'
  | 'tint'
  | 'whiteBalanceMigration'
  | 'whiteBalanceTechnical'
>;
export type CameraInputPatch = Partial<CameraInputParameters>;

export interface CameraInputCommitIdentity {
  adjustmentRevision: number;
  imageSessionId: string;
  sourceIdentity: string;
}

export interface CameraInputEditTransactionState {
  adjustmentRevision: number;
  imageSession: { id: string } | null;
  selectedImage: { path: string } | null;
}

export const captureCameraInputCommitIdentity = (
  state: CameraInputEditTransactionState,
): CameraInputCommitIdentity | null =>
  state.selectedImage?.path !== undefined && state.imageSession !== null
    ? {
        adjustmentRevision: state.adjustmentRevision,
        imageSessionId: state.imageSession.id,
        sourceIdentity: state.selectedImage.path,
      }
    : null;

export const buildCameraInputEditTransaction = (
  state: CameraInputEditTransactionState,
  identity: CameraInputCommitIdentity,
  patch: CameraInputPatch,
  transactionId: string,
): EditTransactionRequest => {
  if (state.selectedImage?.path !== identity.sourceIdentity) {
    throw new Error(
      `camera_input_transaction.stale_source:${identity.sourceIdentity}:${state.selectedImage?.path ?? 'none'}`,
    );
  }
  if (state.imageSession?.id !== identity.imageSessionId) {
    throw new Error(
      `camera_input_transaction.stale_session:${identity.imageSessionId}:${state.imageSession?.id ?? 'none'}`,
    );
  }
  if (state.adjustmentRevision !== identity.adjustmentRevision) {
    throw new Error(
      `camera_input_transaction.stale_revision:${String(identity.adjustmentRevision)}:${String(state.adjustmentRevision)}`,
    );
  }
  return {
    baseAdjustmentRevision: identity.adjustmentRevision,
    history: 'single-entry',
    imageSessionId: identity.imageSessionId,
    operations: [{ nodeType: 'camera_input', patch: structuredClone(patch), type: 'patch-edit-document-node' }],
    persistence: 'commit',
    source: 'manual-control',
    transactionId,
  };
};
