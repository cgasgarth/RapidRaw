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
  selectedImage: { path: string } | null;
}

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
  if (state.imageSession?.id !== identity.imageSessionId) {
    throw new Error(
      `color_calibration_transaction.stale_session:${identity.imageSessionId}:${state.imageSession?.id ?? 'none'}`,
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
