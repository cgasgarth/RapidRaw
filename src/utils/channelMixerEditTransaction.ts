import type { ChannelMixerSettings } from '../schemas/color/channelMixerSchemas';
import type { EditTransactionRequest } from './editTransaction';

export interface ChannelMixerCommitIdentity {
  adjustmentRevision: number;
  imageSessionId: string;
  sourceIdentity: string;
}

export interface ChannelMixerEditTransactionState {
  adjustmentRevision: number;
  imageSession: { id: string } | null;
  selectedImage: { path: string } | null;
}

export const buildChannelMixerEditTransaction = (
  state: ChannelMixerEditTransactionState,
  identity: ChannelMixerCommitIdentity,
  channelMixer: ChannelMixerSettings,
  transactionId: string,
): EditTransactionRequest => {
  if (state.selectedImage?.path !== identity.sourceIdentity) {
    throw new Error(
      `channel_mixer_transaction.stale_source:${identity.sourceIdentity}:${state.selectedImage?.path ?? 'none'}`,
    );
  }
  if (state.imageSession?.id !== identity.imageSessionId) {
    throw new Error(
      `channel_mixer_transaction.stale_session:${identity.imageSessionId}:${state.imageSession?.id ?? 'none'}`,
    );
  }
  if (state.adjustmentRevision !== identity.adjustmentRevision) {
    throw new Error(
      `channel_mixer_transaction.stale_revision:${String(identity.adjustmentRevision)}:${String(state.adjustmentRevision)}`,
    );
  }

  return {
    baseAdjustmentRevision: identity.adjustmentRevision,
    history: 'single-entry',
    imageSessionId: identity.imageSessionId,
    operations: [{ nodeType: 'channel_mixer', patch: { channelMixer }, type: 'patch-edit-document-node' }],
    persistence: 'commit',
    source: 'manual-control',
    transactionId,
  };
};
