import { DetailsAdjustment } from './adjustments';
import type { EditTransactionRequest } from './editTransaction';

export const DETAIL_NUMBER_NODE_ADJUSTMENTS = [
  DetailsAdjustment.Clarity,
  DetailsAdjustment.ColorNoiseReduction,
  DetailsAdjustment.DeblurSigmaPx,
  DetailsAdjustment.DeblurStrength,
  DetailsAdjustment.Dehaze,
  DetailsAdjustment.DenoiseContrastProtection,
  DetailsAdjustment.DenoiseDetail,
  DetailsAdjustment.DenoiseNaturalGrain,
  DetailsAdjustment.DenoiseShadowBias,
  DetailsAdjustment.LumaNoiseReduction,
  DetailsAdjustment.Sharpness,
] as const;

export const DETAIL_BOOLEAN_NODE_ADJUSTMENTS = [DetailsAdjustment.DeblurEnabled] as const;

export const DETAIL_NODE_ADJUSTMENTS = [...DETAIL_NUMBER_NODE_ADJUSTMENTS, ...DETAIL_BOOLEAN_NODE_ADJUSTMENTS] as const;

export type DetailNodeAdjustment = (typeof DETAIL_NODE_ADJUSTMENTS)[number];
export type DetailNumberNodeAdjustment = (typeof DETAIL_NUMBER_NODE_ADJUSTMENTS)[number];
export type DetailBooleanNodeAdjustment = (typeof DETAIL_BOOLEAN_NODE_ADJUSTMENTS)[number];
export type DetailNodeAdjustmentValue<Key extends DetailNodeAdjustment> = Key extends DetailBooleanNodeAdjustment
  ? boolean
  : number;

export interface DetailCommitIdentity {
  adjustmentRevision: number;
  imageSessionId: string;
  sourceIdentity: string;
}

export interface DetailEditTransactionState {
  adjustmentRevision: number;
  imageSession: { id: string } | null;
  selectedImage: { path: string } | null;
}

export const isDetailNodeAdjustment = (key: DetailsAdjustment): key is DetailNodeAdjustment =>
  DETAIL_NODE_ADJUSTMENTS.some((candidate) => candidate === key);

export const isDetailNumberNodeAdjustment = (key: DetailsAdjustment): key is DetailNumberNodeAdjustment =>
  DETAIL_NUMBER_NODE_ADJUSTMENTS.some((candidate) => candidate === key);

export const isDetailBooleanNodeAdjustment = (key: DetailsAdjustment): key is DetailBooleanNodeAdjustment =>
  DETAIL_BOOLEAN_NODE_ADJUSTMENTS.some((candidate) => candidate === key);

export const buildDetailEditTransaction = <Key extends DetailNodeAdjustment>(
  state: DetailEditTransactionState,
  identity: DetailCommitIdentity,
  key: Key,
  value: DetailNodeAdjustmentValue<Key>,
  transactionId: string,
): EditTransactionRequest => {
  if (state.selectedImage?.path !== identity.sourceIdentity) {
    throw new Error(
      `detail_transaction.stale_source:${identity.sourceIdentity}:${state.selectedImage?.path ?? 'none'}`,
    );
  }
  if (state.imageSession?.id !== identity.imageSessionId) {
    throw new Error(`detail_transaction.stale_session:${identity.imageSessionId}:${state.imageSession?.id ?? 'none'}`);
  }
  if (state.adjustmentRevision !== identity.adjustmentRevision) {
    throw new Error(
      `detail_transaction.stale_revision:${String(identity.adjustmentRevision)}:${String(state.adjustmentRevision)}`,
    );
  }

  return {
    baseAdjustmentRevision: identity.adjustmentRevision,
    history: 'single-entry',
    imageSessionId: identity.imageSessionId,
    operations: [{ nodeType: 'detail_denoise_dehaze', patch: { [key]: value }, type: 'patch-edit-document-node' }],
    persistence: 'commit',
    source: 'manual-control',
    transactionId,
  };
};
