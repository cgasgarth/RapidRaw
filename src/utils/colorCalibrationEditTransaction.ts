import type { Adjustments } from './adjustments';
import type { EditTransactionRequest } from './editTransaction';

export interface ColorCalibrationCommitIdentity {
  adjustmentRevision: number;
  imageSessionId: string;
  sourceIdentity: string;
}

export interface ColorCalibrationEditTransactionState {
  adjustmentRevision: number;
  imageSession: { id: string } | null;
  imageSessionId: number;
  selectedImage: { path: string } | null;
}

const currentImageSessionId = (state: ColorCalibrationEditTransactionState): string =>
  state.imageSession?.id ?? `editor-image-session:${String(state.imageSessionId)}`;

export const isCurrentColorCalibrationIdentity = (
  state: ColorCalibrationEditTransactionState,
  identity: ColorCalibrationCommitIdentity,
): boolean =>
  state.adjustmentRevision === identity.adjustmentRevision &&
  currentImageSessionId(state) === identity.imageSessionId &&
  state.selectedImage?.path === identity.sourceIdentity;

export const buildColorCalibrationEditTransaction = (
  state: ColorCalibrationEditTransactionState,
  identity: ColorCalibrationCommitIdentity,
  colorCalibration: Adjustments['colorCalibration'],
  transactionId: string,
): EditTransactionRequest => {
  if (state.selectedImage?.path !== identity.sourceIdentity) {
    throw new Error(
      `color_calibration_transaction.stale_source:${identity.sourceIdentity}:${state.selectedImage?.path ?? 'none'}`,
    );
  }
  if (currentImageSessionId(state) !== identity.imageSessionId) {
    throw new Error(
      `color_calibration_transaction.stale_session:${identity.imageSessionId}:${currentImageSessionId(state)}`,
    );
  }
  if (state.adjustmentRevision !== identity.adjustmentRevision) {
    throw new Error(
      `color_calibration_transaction.stale_revision:${String(identity.adjustmentRevision)}:${String(state.adjustmentRevision)}`,
    );
  }
  return {
    baseAdjustmentRevision: identity.adjustmentRevision,
    history: 'single-entry',
    imageSessionId: identity.imageSessionId,
    operations: [
      {
        nodeType: 'color_calibration',
        patch: { colorCalibration: structuredClone(colorCalibration) },
        type: 'patch-edit-document-node',
      },
    ],
    persistence: 'commit',
    source: 'manual-control',
    transactionId,
  };
};
