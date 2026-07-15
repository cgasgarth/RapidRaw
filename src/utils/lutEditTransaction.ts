import type { Adjustments } from './adjustments';
import type { EditTransactionRequest } from './editTransaction';

export interface LutCommitIdentity {
  adjustmentRevision: number;
  imageSessionId: string;
  sourceIdentity: string;
}

export interface LutEditTransactionState {
  adjustmentRevision: number;
  imageSession: { id: string } | null;
  selectedImage: { path: string } | null;
}

export interface LoadedLutIdentity {
  data: Adjustments['lutData'];
  intensity: number;
  name: string;
  path: string;
  size: number;
}

export const captureLutCommitIdentity = (state: LutEditTransactionState): LutCommitIdentity | null =>
  state.selectedImage?.path !== undefined && state.imageSession !== null
    ? {
        adjustmentRevision: state.adjustmentRevision,
        imageSessionId: state.imageSession.id,
        sourceIdentity: state.selectedImage.path,
      }
    : null;

const assertCurrentLutIdentity = (state: LutEditTransactionState, identity: LutCommitIdentity): void => {
  if (state.selectedImage?.path !== identity.sourceIdentity) {
    throw new Error(`lut_transaction.stale_source:${identity.sourceIdentity}:${state.selectedImage?.path ?? 'none'}`);
  }
  if (state.imageSession?.id !== identity.imageSessionId) {
    throw new Error(`lut_transaction.stale_session:${identity.imageSessionId}:${state.imageSession?.id ?? 'none'}`);
  }
  if (state.adjustmentRevision !== identity.adjustmentRevision) {
    throw new Error(
      `lut_transaction.stale_revision:${String(identity.adjustmentRevision)}:${String(state.adjustmentRevision)}`,
    );
  }
};

export const buildLutLoadEditTransaction = (
  state: LutEditTransactionState,
  identity: LutCommitIdentity,
  lut: LoadedLutIdentity,
  transactionId: string,
): EditTransactionRequest => {
  assertCurrentLutIdentity(state, identity);
  return {
    baseAdjustmentRevision: identity.adjustmentRevision,
    history: 'single-entry',
    imageSessionId: identity.imageSessionId,
    operations: [
      {
        nodeType: 'display_creative',
        patch: {
          lutData: lut.data,
          lutIntensity: lut.intensity,
          lutName: lut.name,
          lutPath: lut.path,
          lutSize: lut.size,
        },
        type: 'patch-edit-document-node',
      },
    ],
    persistence: 'commit',
    source: 'manual-control',
    transactionId,
  };
};

export const buildLutClearEditTransaction = (
  state: LutEditTransactionState,
  identity: LutCommitIdentity,
  transactionId: string,
): EditTransactionRequest => {
  assertCurrentLutIdentity(state, identity);
  return {
    baseAdjustmentRevision: identity.adjustmentRevision,
    history: 'single-entry',
    imageSessionId: identity.imageSessionId,
    operations: [
      {
        nodeType: 'display_creative',
        patch: { lutData: null, lutIntensity: 100, lutName: null, lutPath: null, lutSize: 0 },
        type: 'patch-edit-document-node',
      },
    ],
    persistence: 'commit',
    source: 'manual-control',
    transactionId,
  };
};
