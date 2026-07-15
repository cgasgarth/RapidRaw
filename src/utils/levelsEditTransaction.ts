import { type LevelsSettings, levelsSettingsSchema } from '../schemas/color/levelsSchemas';
import type { EditTransactionRequest } from './editTransaction';

export interface LevelsCommitIdentity {
  adjustmentRevision: number;
  imageSessionId: string;
  sourceIdentity: string;
}

export interface LevelsEditTransactionState {
  adjustmentRevision: number;
  imageSession: { id: string } | null;
  imageSessionId: number;
  selectedImage: { path: string } | null;
}

const currentImageSessionId = (state: LevelsEditTransactionState): string =>
  state.imageSession?.id ?? `editor-image-session:${String(state.imageSessionId)}`;

export const isCurrentLevelsIdentity = (state: LevelsEditTransactionState, identity: LevelsCommitIdentity): boolean =>
  state.adjustmentRevision === identity.adjustmentRevision &&
  currentImageSessionId(state) === identity.imageSessionId &&
  state.selectedImage?.path === identity.sourceIdentity;

export const buildLevelsEditTransaction = (
  state: LevelsEditTransactionState,
  identity: LevelsCommitIdentity,
  levels: LevelsSettings,
  transactionId: string,
): EditTransactionRequest => {
  if (state.selectedImage?.path !== identity.sourceIdentity) {
    throw new Error(
      `levels_transaction.stale_source:${identity.sourceIdentity}:${state.selectedImage?.path ?? 'none'}`,
    );
  }
  if (currentImageSessionId(state) !== identity.imageSessionId) {
    throw new Error(`levels_transaction.stale_session:${identity.imageSessionId}:${currentImageSessionId(state)}`);
  }
  if (state.adjustmentRevision !== identity.adjustmentRevision) {
    throw new Error(
      `levels_transaction.stale_revision:${String(identity.adjustmentRevision)}:${String(state.adjustmentRevision)}`,
    );
  }

  const parsed = levelsSettingsSchema.safeParse(levels);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new Error(`levels_transaction.invalid_levels:${issue?.path.join('.') ?? 'unknown'}`);
  }

  return {
    baseAdjustmentRevision: identity.adjustmentRevision,
    history: 'single-entry',
    imageSessionId: identity.imageSessionId,
    operations: [{ patch: { levels: parsed.data }, type: 'patch-adjustments' }],
    persistence: 'commit',
    source: 'manual-control',
    transactionId,
  };
};
