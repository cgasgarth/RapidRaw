import type { BlackWhiteMixerSettings } from '../schemas/color/blackWhiteMixerSchemas';
import type { EditTransactionHistory, EditTransactionRequest } from './editTransaction';

export interface BlackWhiteMixerCommitIdentity {
  adjustmentRevision: number;
  imageSessionId: string;
  sourceIdentity: string;
}

export interface BlackWhiteMixerEditTransactionState {
  adjustmentRevision: number;
  imageSession: { id: string } | null;
  imageSessionId: number;
  selectedImage: { path: string } | null;
}

const currentImageSessionId = (state: BlackWhiteMixerEditTransactionState): string =>
  state.imageSession?.id ?? `editor-image-session:${String(state.imageSessionId)}`;

export const isCurrentBlackWhiteMixerIdentity = (
  state: BlackWhiteMixerEditTransactionState,
  identity: BlackWhiteMixerCommitIdentity,
): boolean =>
  state.adjustmentRevision === identity.adjustmentRevision &&
  currentImageSessionId(state) === identity.imageSessionId &&
  state.selectedImage?.path === identity.sourceIdentity;

export const buildBlackWhiteMixerEditTransaction = (
  state: BlackWhiteMixerEditTransactionState,
  identity: BlackWhiteMixerCommitIdentity,
  blackWhiteMixer: BlackWhiteMixerSettings,
  transactionId: string,
  history: Extract<EditTransactionHistory, 'single-entry' | 'coalesced-interaction'> = 'single-entry',
): EditTransactionRequest => {
  if (state.selectedImage?.path !== identity.sourceIdentity) {
    throw new Error(
      `black_white_mixer_transaction.stale_source:${identity.sourceIdentity}:${state.selectedImage?.path ?? 'none'}`,
    );
  }
  if (currentImageSessionId(state) !== identity.imageSessionId) {
    throw new Error(
      `black_white_mixer_transaction.stale_session:${identity.imageSessionId}:${currentImageSessionId(state)}`,
    );
  }
  if (state.adjustmentRevision !== identity.adjustmentRevision) {
    throw new Error(
      `black_white_mixer_transaction.stale_revision:${String(identity.adjustmentRevision)}:${String(state.adjustmentRevision)}`,
    );
  }

  return {
    baseAdjustmentRevision: identity.adjustmentRevision,
    history,
    imageSessionId: identity.imageSessionId,
    operations: [{ nodeType: 'black_white_mixer', patch: { blackWhiteMixer }, type: 'patch-edit-document-node' }],
    persistence: 'commit',
    source: 'manual-control',
    transactionId,
  };
};
