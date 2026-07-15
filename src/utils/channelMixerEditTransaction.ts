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
  imageSessionId: number;
  selectedImage: { path: string } | null;
}

const currentImageSessionId = (state: ChannelMixerEditTransactionState): string =>
  state.imageSession?.id ?? `editor-image-session:${String(state.imageSessionId)}`;

export const isCurrentChannelMixerIdentity = (
  state: ChannelMixerEditTransactionState,
  identity: ChannelMixerCommitIdentity,
): boolean =>
  state.adjustmentRevision === identity.adjustmentRevision &&
  currentImageSessionId(state) === identity.imageSessionId &&
  state.selectedImage?.path === identity.sourceIdentity;

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
  if (currentImageSessionId(state) !== identity.imageSessionId) {
    throw new Error(
      `channel_mixer_transaction.stale_session:${identity.imageSessionId}:${currentImageSessionId(state)}`,
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
