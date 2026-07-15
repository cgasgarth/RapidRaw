import type { Adjustments } from './adjustments';
import { areAdjustmentsEqual } from './adjustmentsSnapshot';
import type { EditTransactionRequest } from './editTransaction';

export interface ImageOpenHydrationIdentity {
  adjustmentRevision: number;
  imageSessionId: string;
  path: string;
}

export interface ImageOpenHydrationState {
  adjustmentRevision: number;
  imageSession: { id: string; path: string } | null;
  selectedImage: { path: string } | null;
}

export const buildImageOpenHydrationEditTransaction = (
  state: ImageOpenHydrationState,
  identity: ImageOpenHydrationIdentity,
  adjustments: Adjustments,
  transactionId: string,
): EditTransactionRequest => {
  if (
    state.imageSession?.id !== identity.imageSessionId ||
    state.imageSession.path !== identity.path ||
    state.selectedImage?.path !== identity.path ||
    state.adjustmentRevision !== identity.adjustmentRevision
  ) {
    throw new Error('image_open_hydration.stale_identity');
  }

  return {
    baseAdjustmentRevision: state.adjustmentRevision,
    history: 'reset',
    imageSessionId: identity.imageSessionId,
    operations: [{ adjustments: structuredClone(adjustments), type: 'replace-adjustments' }],
    persistence: 'native-committed',
    source: 'hydration',
    transactionId,
  };
};

export const buildChangedImageOpenHydrationEditTransaction = (
  state: ImageOpenHydrationState & { adjustments: Adjustments },
  identity: ImageOpenHydrationIdentity,
  adjustments: Adjustments,
  transactionId: string,
): EditTransactionRequest | null => {
  const request = buildImageOpenHydrationEditTransaction(state, identity, adjustments, transactionId);
  return areAdjustmentsEqual(state.adjustments, adjustments) ? null : request;
};
