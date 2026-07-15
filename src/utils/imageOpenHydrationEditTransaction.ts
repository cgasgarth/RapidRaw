import type { Adjustments } from './adjustments';
import type { EditApplicationReceipt, EditTransactionRequest } from './editTransaction';

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

interface ImageOpenHydrationContinuationState extends ImageOpenHydrationState {
  lastEditApplicationReceipt: Pick<
    EditApplicationReceipt,
    'adjustmentRevision' | 'baseAdjustmentRevision' | 'imageSessionId' | 'source'
  > | null;
}

export const isImageOpenHydrationIdentityCurrent = <State extends ImageOpenHydrationState>(
  state: State,
  identity: ImageOpenHydrationIdentity,
): state is State & { selectedImage: { path: string } } =>
  state.imageSession?.id === identity.imageSessionId &&
  state.imageSession.path === identity.path &&
  state.selectedImage?.path === identity.path &&
  state.adjustmentRevision === identity.adjustmentRevision;

export const publishCurrentImageOpenHydration = <State extends ImageOpenHydrationState>(
  state: State,
  identity: ImageOpenHydrationIdentity,
  publish: (current: State & { selectedImage: { path: string } }) => void,
): void => {
  if (isImageOpenHydrationIdentityCurrent(state, identity)) publish(state);
};

export const canContinueImageOpenHydration = (
  state: ImageOpenHydrationContinuationState,
  identity: ImageOpenHydrationIdentity,
): boolean =>
  isImageOpenHydrationIdentityCurrent(state, identity) ||
  (state.imageSession?.id === identity.imageSessionId &&
    state.imageSession.path === identity.path &&
    state.selectedImage?.path === identity.path &&
    state.lastEditApplicationReceipt?.source === 'hydration' &&
    state.lastEditApplicationReceipt.imageSessionId === identity.imageSessionId &&
    state.lastEditApplicationReceipt.baseAdjustmentRevision === identity.adjustmentRevision &&
    state.lastEditApplicationReceipt.adjustmentRevision === state.adjustmentRevision);

export const buildImageOpenHydrationEditTransaction = (
  state: ImageOpenHydrationState,
  identity: ImageOpenHydrationIdentity,
  adjustments: Adjustments,
  transactionId: string,
): EditTransactionRequest => {
  if (!isImageOpenHydrationIdentityCurrent(state, identity)) {
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
