import { Effect } from './adjustments';
import type { EditTransactionRequest } from './editTransaction';

export const DISPLAY_CREATIVE_NODE_ADJUSTMENTS = [Effect.VignetteAmount] as const;

export type DisplayCreativeNodeAdjustment = (typeof DISPLAY_CREATIVE_NODE_ADJUSTMENTS)[number];

export interface DisplayCreativeCommitIdentity {
  adjustmentRevision: number;
  imageSessionId: string;
  sourceIdentity: string;
}

export interface DisplayCreativeEditTransactionState {
  adjustmentRevision: number;
  imageSession: { id: string } | null;
  selectedImage: { path: string } | null;
}

export const isDisplayCreativeNodeAdjustment = (key: string): key is DisplayCreativeNodeAdjustment =>
  DISPLAY_CREATIVE_NODE_ADJUSTMENTS.some((candidate) => candidate === key);

export const buildDisplayCreativeEditTransaction = (
  state: DisplayCreativeEditTransactionState,
  identity: DisplayCreativeCommitIdentity,
  key: DisplayCreativeNodeAdjustment,
  value: number,
  transactionId: string,
): EditTransactionRequest => {
  if (state.selectedImage?.path !== identity.sourceIdentity) {
    throw new Error(
      `display_creative_transaction.stale_source:${identity.sourceIdentity}:${state.selectedImage?.path ?? 'none'}`,
    );
  }
  if (state.imageSession?.id !== identity.imageSessionId) {
    throw new Error(
      `display_creative_transaction.stale_session:${identity.imageSessionId}:${state.imageSession?.id ?? 'none'}`,
    );
  }
  if (state.adjustmentRevision !== identity.adjustmentRevision) {
    throw new Error(
      `display_creative_transaction.stale_revision:${String(identity.adjustmentRevision)}:${String(state.adjustmentRevision)}`,
    );
  }

  return {
    baseAdjustmentRevision: identity.adjustmentRevision,
    history: 'single-entry',
    imageSessionId: identity.imageSessionId,
    operations: [{ nodeType: 'display_creative', patch: { [key]: value }, type: 'patch-edit-document-node' }],
    persistence: 'commit',
    source: 'manual-control',
    transactionId,
  };
};
