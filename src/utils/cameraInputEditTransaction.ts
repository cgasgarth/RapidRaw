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

export interface AutoWhiteBalanceRequestConfiguration {
  enabled: boolean;
  inputSemantics: 'raw_scene_linear' | 'rendered_scene_linear_approximation';
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

export const isCurrentCameraInputCommitIdentity = (
  state: CameraInputEditTransactionState,
  identity: CameraInputCommitIdentity,
): boolean =>
  state.selectedImage?.path === identity.sourceIdentity &&
  state.imageSession?.id === identity.imageSessionId &&
  state.adjustmentRevision === identity.adjustmentRevision;

export const isCurrentCameraInputAsyncRequest = (
  state: CameraInputEditTransactionState,
  identity: CameraInputCommitIdentity,
  requestGeneration: number,
  currentRequestGeneration: number,
): boolean => requestGeneration === currentRequestGeneration && isCurrentCameraInputCommitIdentity(state, identity);

export const isCurrentAutoWhiteBalanceRequest = (
  state: CameraInputEditTransactionState,
  identity: CameraInputCommitIdentity,
  requestGeneration: number,
  currentRequestGeneration: number,
  requestedConfiguration: AutoWhiteBalanceRequestConfiguration,
  currentConfiguration: AutoWhiteBalanceRequestConfiguration,
): boolean =>
  requestedConfiguration.enabled &&
  currentConfiguration.enabled &&
  requestedConfiguration.inputSemantics === currentConfiguration.inputSemantics &&
  isCurrentCameraInputAsyncRequest(state, identity, requestGeneration, currentRequestGeneration);

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
