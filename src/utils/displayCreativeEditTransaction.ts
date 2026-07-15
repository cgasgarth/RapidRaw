import { CreativeAdjustment, Effect } from './adjustments';
import type { EditTransactionRequest } from './editTransaction';

export const DISPLAY_CREATIVE_NODE_ADJUSTMENTS = [
  CreativeAdjustment.GlowAmount,
  CreativeAdjustment.HalationAmount,
  CreativeAdjustment.FlareAmount,
  Effect.GrainAmount,
  Effect.GrainSize,
  Effect.GrainRoughness,
  Effect.LutIntensity,
  Effect.VignetteAmount,
  Effect.VignetteFeather,
  Effect.VignetteMidpoint,
  Effect.VignetteRoundness,
] as const;

export const DISPLAY_CREATIVE_FILM_LOOK_ADJUSTMENTS = [
  CreativeAdjustment.GlowAmount,
  CreativeAdjustment.HalationAmount,
  Effect.GrainAmount,
  Effect.GrainSize,
  Effect.GrainRoughness,
] as const;

export type DisplayCreativeNodeAdjustment = (typeof DISPLAY_CREATIVE_NODE_ADJUSTMENTS)[number];
export type DisplayCreativeNodePatch = Partial<Record<DisplayCreativeNodeAdjustment, number>>;

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
): EditTransactionRequest => buildDisplayCreativePatchEditTransaction(state, identity, { [key]: value }, transactionId);

export const buildDisplayCreativePatchEditTransaction = (
  state: DisplayCreativeEditTransactionState,
  identity: DisplayCreativeCommitIdentity,
  patch: DisplayCreativeNodePatch,
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

  const entries = Object.entries(patch);
  if (entries.length === 0) throw new Error('display_creative_transaction.empty_patch');
  for (const [key, value] of entries) {
    if (!isDisplayCreativeNodeAdjustment(key)) {
      throw new Error(`display_creative_transaction.unowned_field:${key}`);
    }
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw new Error(`display_creative_transaction.invalid_value:${key}`);
    }
  }
  const invalidatesFilmLook = entries.some(([key]) =>
    DISPLAY_CREATIVE_FILM_LOOK_ADJUSTMENTS.some((candidate) => candidate === key),
  );

  return {
    baseAdjustmentRevision: identity.adjustmentRevision,
    history: 'single-entry',
    imageSessionId: identity.imageSessionId,
    operations: [
      { nodeType: 'display_creative', patch, type: 'patch-edit-document-node' },
      ...(invalidatesFilmLook
        ? ([
            {
              patch: { filmLookId: null, filmLookStrength: 100 },
              type: 'patch-adjustments',
            },
          ] as const)
        : []),
    ],
    persistence: 'commit',
    source: 'manual-control',
    transactionId,
  };
};
