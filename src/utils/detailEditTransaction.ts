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
  DetailsAdjustment.DustSpotSensitivity,
  DetailsAdjustment.DustSpotMinRadiusPx,
  DetailsAdjustment.LocalContrastHaloGuard,
  DetailsAdjustment.LocalContrastMidtoneMask,
  DetailsAdjustment.LocalContrastRadiusPx,
  DetailsAdjustment.Sharpness,
  DetailsAdjustment.SharpnessThreshold,
  DetailsAdjustment.Structure,
  DetailsAdjustment.Centré,
] as const;

export const DETAIL_BOOLEAN_NODE_ADJUSTMENTS = [
  DetailsAdjustment.DeblurEnabled,
  DetailsAdjustment.DustSpotOverlayEnabled,
] as const;

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
  imageSessionId: number;
  selectedImage: { path: string } | null;
}

const currentImageSessionId = (state: DetailEditTransactionState): string =>
  state.imageSession?.id ?? `editor-image-session:${String(state.imageSessionId)}`;

export const isDetailNodeAdjustment = (key: PropertyKey): key is DetailNodeAdjustment =>
  DETAIL_NODE_ADJUSTMENTS.some((candidate) => candidate === key);

export const isDetailNumberNodeAdjustment = (key: PropertyKey): key is DetailNumberNodeAdjustment =>
  DETAIL_NUMBER_NODE_ADJUSTMENTS.some((candidate) => candidate === key);

export const isDetailBooleanNodeAdjustment = (key: PropertyKey): key is DetailBooleanNodeAdjustment =>
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
  if (currentImageSessionId(state) !== identity.imageSessionId) {
    throw new Error(`detail_transaction.stale_session:${identity.imageSessionId}:${currentImageSessionId(state)}`);
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
