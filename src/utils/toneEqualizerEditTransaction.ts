import type { Adjustments } from './adjustments';
import type { BasicToneCommitIdentity } from './basicToneEditTransaction';
import type { EditTransactionRequest } from './editTransaction';

export interface ToneEqualizerEditTransactionState {
  adjustmentRevision: number;
  adjustments: Pick<Adjustments, 'toneEqualizer'>;
  imageSession: { id: string } | null;
  selectedImage: { path: string } | null;
}

export const buildToneEqualizerEditTransaction = (
  state: ToneEqualizerEditTransactionState,
  identity: BasicToneCommitIdentity,
  patch: Partial<Adjustments['toneEqualizer']>,
  transactionId: string,
): EditTransactionRequest => {
  if (state.selectedImage?.path !== identity.sourceIdentity) {
    throw new Error(
      `tone_equalizer_transaction.stale_source:${identity.sourceIdentity}:${state.selectedImage?.path ?? 'none'}`,
    );
  }
  if (state.imageSession?.id !== identity.imageSessionId) {
    throw new Error(
      `tone_equalizer_transaction.stale_session:${identity.imageSessionId}:${state.imageSession?.id ?? 'none'}`,
    );
  }
  if (state.adjustmentRevision !== identity.adjustmentRevision) {
    throw new Error(
      `tone_equalizer_transaction.stale_revision:${String(identity.adjustmentRevision)}:${String(state.adjustmentRevision)}`,
    );
  }

  return {
    baseAdjustmentRevision: identity.adjustmentRevision,
    history: 'single-entry',
    imageSessionId: identity.imageSessionId,
    operations: [
      {
        nodeType: 'tone_equalizer',
        patch: { toneEqualizer: { ...structuredClone(state.adjustments.toneEqualizer), ...structuredClone(patch) } },
        type: 'patch-edit-document-node',
      },
    ],
    persistence: 'commit',
    source: 'manual-control',
    transactionId,
  };
};
