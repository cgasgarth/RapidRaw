import {
  type SelectiveColorMixerSettings,
  selectiveColorMixerSettingsSchema,
} from '../schemas/color/selectiveColorMixerSchemas';
import type { EditTransactionRequest } from './editTransaction';

export type { SelectiveColorMixerSettings } from '../schemas/color/selectiveColorMixerSchemas';

export interface SelectiveColorCommitIdentity {
  adjustmentRevision: number;
  imageSessionId: string;
  sourceIdentity: string;
}

export interface SelectiveColorEditTransactionState {
  adjustmentRevision: number;
  imageSession: { id: string } | null;
  imageSessionId: number;
  selectedImage: { path: string } | null;
}

const currentImageSessionId = (state: SelectiveColorEditTransactionState): string =>
  state.imageSession?.id ?? `editor-image-session:${String(state.imageSessionId)}`;

export const isCurrentSelectiveColorIdentity = (
  state: SelectiveColorEditTransactionState,
  identity: SelectiveColorCommitIdentity,
): boolean =>
  state.adjustmentRevision === identity.adjustmentRevision &&
  currentImageSessionId(state) === identity.imageSessionId &&
  state.selectedImage?.path === identity.sourceIdentity;

export const buildSelectiveColorEditTransaction = (
  state: SelectiveColorEditTransactionState,
  identity: SelectiveColorCommitIdentity,
  settings: SelectiveColorMixerSettings,
  transactionId: string,
): EditTransactionRequest => {
  if (state.selectedImage?.path !== identity.sourceIdentity) {
    throw new Error(
      `selective_color_transaction.stale_source:${identity.sourceIdentity}:${state.selectedImage?.path ?? 'none'}`,
    );
  }
  if (currentImageSessionId(state) !== identity.imageSessionId) {
    throw new Error(
      `selective_color_transaction.stale_session:${identity.imageSessionId}:${currentImageSessionId(state)}`,
    );
  }
  if (state.adjustmentRevision !== identity.adjustmentRevision) {
    throw new Error(
      `selective_color_transaction.stale_revision:${String(identity.adjustmentRevision)}:${String(state.adjustmentRevision)}`,
    );
  }
  const parsed = selectiveColorMixerSettingsSchema.safeParse(settings);
  if (!parsed.success) {
    const [domain, range, field] = parsed.error.issues[0]?.path ?? [];
    if (domain === 'hsl') {
      throw new Error(`selective_color_transaction.invalid_hsl:${String(range)}:${String(field)}`);
    }
    throw new Error(`selective_color_transaction.invalid_range:${String(range)}:${String(field)}`);
  }

  return {
    baseAdjustmentRevision: identity.adjustmentRevision,
    history: 'single-entry',
    imageSessionId: identity.imageSessionId,
    operations: [
      {
        nodeType: 'selective_color_mixer',
        patch: {
          hsl: structuredClone(settings.hsl),
          selectiveColorRangeControls: structuredClone(settings.selectiveColorRangeControls),
        },
        type: 'patch-edit-document-node',
      },
    ],
    persistence: 'commit',
    source: 'manual-control',
    transactionId,
  };
};
