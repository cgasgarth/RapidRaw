import type { Adjustments } from './adjustments';
import type { EditTransactionRequest } from './editTransaction';

export interface ImageOpenHydrationIdentity {
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
    state.selectedImage?.path !== identity.path
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
