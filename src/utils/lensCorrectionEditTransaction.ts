import type { Adjustments } from './adjustments';
import type { EditTransactionRequest } from './editTransaction';

export const MANUAL_LENS_CORRECTION_ADJUSTMENTS = [
  'chromaticAberrationBlueYellow',
  'chromaticAberrationRedCyan',
  'lensDistortionAmount',
  'lensDistortionEnabled',
  'lensTcaAmount',
  'lensTcaEnabled',
  'lensVignetteAmount',
  'lensVignetteEnabled',
] as const satisfies ReadonlyArray<keyof Adjustments>;

export type ManualLensCorrectionAdjustment = (typeof MANUAL_LENS_CORRECTION_ADJUSTMENTS)[number];
export type LensProfilePatch = Partial<
  Pick<Adjustments, 'lensCorrectionMode' | 'lensDistortionParams' | 'lensMaker' | 'lensModel'>
>;

export interface LensCorrectionCommitIdentity {
  adjustmentRevision: number;
  imageSessionId: string;
  sourceIdentity: string;
}

export interface LensCorrectionEditTransactionState {
  adjustmentRevision: number;
  imageSession: { id: string } | null;
  imageSessionId: number;
  selectedImage: { path: string } | null;
}

const currentImageSessionId = (state: LensCorrectionEditTransactionState): string =>
  state.imageSession?.id ?? `editor-image-session:${String(state.imageSessionId)}`;

export const captureLensCorrectionCommitIdentity = (
  state: LensCorrectionEditTransactionState,
): LensCorrectionCommitIdentity | null =>
  state.selectedImage === null
    ? null
    : {
        adjustmentRevision: state.adjustmentRevision,
        imageSessionId: currentImageSessionId(state),
        sourceIdentity: state.selectedImage.path,
      };

export const isManualLensCorrectionAdjustment = (key: keyof Adjustments): key is ManualLensCorrectionAdjustment =>
  MANUAL_LENS_CORRECTION_ADJUSTMENTS.some((candidate) => candidate === key);

export const isCurrentLensCorrectionIdentity = (
  state: LensCorrectionEditTransactionState,
  identity: LensCorrectionCommitIdentity,
): boolean =>
  state.adjustmentRevision === identity.adjustmentRevision &&
  currentImageSessionId(state) === identity.imageSessionId &&
  state.selectedImage?.path === identity.sourceIdentity;

export const isCurrentLensProfileRequest = (
  state: LensCorrectionEditTransactionState,
  identity: LensCorrectionCommitIdentity,
  requestGeneration: number,
  currentRequestGeneration: number,
): boolean => requestGeneration === currentRequestGeneration && isCurrentLensCorrectionIdentity(state, identity);

const assertCurrentLensCorrectionIdentity = (
  state: LensCorrectionEditTransactionState,
  identity: LensCorrectionCommitIdentity,
): void => {
  if (state.selectedImage?.path !== identity.sourceIdentity) {
    throw new Error(
      `lens_correction_transaction.stale_source:${identity.sourceIdentity}:${state.selectedImage?.path ?? 'none'}`,
    );
  }
  if (currentImageSessionId(state) !== identity.imageSessionId) {
    throw new Error(
      `lens_correction_transaction.stale_session:${identity.imageSessionId}:${currentImageSessionId(state)}`,
    );
  }
  if (state.adjustmentRevision !== identity.adjustmentRevision) {
    throw new Error(
      `lens_correction_transaction.stale_revision:${String(identity.adjustmentRevision)}:${String(state.adjustmentRevision)}`,
    );
  }
};

export const buildLensCorrectionEditTransaction = <Key extends ManualLensCorrectionAdjustment>(
  state: LensCorrectionEditTransactionState,
  identity: LensCorrectionCommitIdentity,
  key: Key,
  value: Adjustments[Key],
  transactionId: string,
): EditTransactionRequest => {
  assertCurrentLensCorrectionIdentity(state, identity);

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

export const buildLensProfileEditTransaction = (
  state: LensCorrectionEditTransactionState,
  identity: LensCorrectionCommitIdentity,
  patch: LensProfilePatch,
  transactionId: string,
): EditTransactionRequest => {
  assertCurrentLensCorrectionIdentity(state, identity);
  return {
    baseAdjustmentRevision: identity.adjustmentRevision,
    history: 'single-entry',
    imageSessionId: identity.imageSessionId,
    operations: [{ nodeType: 'lens_correction', patch: structuredClone(patch), type: 'patch-edit-document-node' }],
    persistence: 'commit',
    source: 'manual-control',
    transactionId,
  };
};
