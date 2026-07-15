import type { Adjustments } from './adjustments';
import type { EditTransactionRequest } from './editTransaction';

export const MANUAL_LENS_CORRECTION_ADJUSTMENTS = [
  'lensDistortionAmount',
  'lensDistortionEnabled',
  'lensTcaAmount',
  'lensTcaEnabled',
  'lensVignetteAmount',
  'lensVignetteEnabled',
] as const satisfies ReadonlyArray<keyof Adjustments>;

export type ManualLensCorrectionAdjustment = (typeof MANUAL_LENS_CORRECTION_ADJUSTMENTS)[number];

export interface LensCorrectionCommitIdentity {
  adjustmentRevision: number;
  imageSessionId: string;
  sourceIdentity: string;
}

export interface LensCorrectionEditTransactionState {
  adjustmentRevision: number;
  imageSession: { id: string } | null;
  selectedImage: { path: string } | null;
}

export const isManualLensCorrectionAdjustment = (key: keyof Adjustments): key is ManualLensCorrectionAdjustment =>
  MANUAL_LENS_CORRECTION_ADJUSTMENTS.some((candidate) => candidate === key);

export const buildLensCorrectionEditTransaction = <Key extends ManualLensCorrectionAdjustment>(
  state: LensCorrectionEditTransactionState,
  identity: LensCorrectionCommitIdentity,
  key: Key,
  value: Adjustments[Key],
  transactionId: string,
): EditTransactionRequest => {
  if (state.selectedImage?.path !== identity.sourceIdentity) {
    throw new Error(
      `lens_correction_transaction.stale_source:${identity.sourceIdentity}:${state.selectedImage?.path ?? 'none'}`,
    );
  }
  if (state.imageSession?.id !== identity.imageSessionId) {
    throw new Error(
      `lens_correction_transaction.stale_session:${identity.imageSessionId}:${state.imageSession?.id ?? 'none'}`,
    );
  }
  if (state.adjustmentRevision !== identity.adjustmentRevision) {
    throw new Error(
      `lens_correction_transaction.stale_revision:${String(identity.adjustmentRevision)}:${String(state.adjustmentRevision)}`,
    );
  }

  return {
    baseAdjustmentRevision: identity.adjustmentRevision,
    history: 'single-entry',
    imageSessionId: identity.imageSessionId,
    operations: [{ nodeType: 'lens_correction', patch: { [key]: value }, type: 'patch-edit-document-node' }],
    persistence: 'commit',
    source: 'manual-control',
    transactionId,
  };
};
