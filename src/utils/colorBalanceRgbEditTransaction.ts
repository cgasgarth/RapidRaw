import type { ColorBalanceRgbSettings } from '../schemas/color/colorBalanceRgbSchemas';
import type { EditTransactionRequest } from './editTransaction';

export interface ColorBalanceRgbCommitIdentity {
  adjustmentRevision: number;
  imageSessionId: string;
  sourceIdentity: string;
}

export interface ColorBalanceRgbEditTransactionState {
  adjustmentRevision: number;
  imageSession: { id: string } | null;
  imageSessionId: number;
  selectedImage: { path: string } | null;
}

const currentImageSessionId = (state: ColorBalanceRgbEditTransactionState): string =>
  state.imageSession?.id ?? `editor-image-session:${String(state.imageSessionId)}`;

export const isCurrentColorBalanceRgbIdentity = (
  state: ColorBalanceRgbEditTransactionState,
  identity: ColorBalanceRgbCommitIdentity,
): boolean =>
  state.adjustmentRevision === identity.adjustmentRevision &&
  currentImageSessionId(state) === identity.imageSessionId &&
  state.selectedImage?.path === identity.sourceIdentity;

const assertColorBalanceRgb = (settings: ColorBalanceRgbSettings): void => {
  if (typeof settings.enabled !== 'boolean' || typeof settings.preserveLuminance !== 'boolean') {
    throw new Error('color_balance_rgb_transaction.invalid_toggle');
  }
  for (const range of ['shadows', 'midtones', 'highlights'] as const) {
    for (const channel of ['red', 'green', 'blue'] as const) {
      const value = settings[range][channel];
      if (!Number.isFinite(value) || value < -100 || value > 100) {
        throw new Error(`color_balance_rgb_transaction.invalid_channel:${range}:${channel}`);
      }
    }
  }
};

export const buildColorBalanceRgbEditTransaction = (
  state: ColorBalanceRgbEditTransactionState,
  identity: ColorBalanceRgbCommitIdentity,
  colorBalanceRgb: ColorBalanceRgbSettings,
  transactionId: string,
): EditTransactionRequest => {
  if (state.selectedImage?.path !== identity.sourceIdentity) {
    throw new Error(
      `color_balance_rgb_transaction.stale_source:${identity.sourceIdentity}:${state.selectedImage?.path ?? 'none'}`,
    );
  }
  if (currentImageSessionId(state) !== identity.imageSessionId) {
    throw new Error(
      `color_balance_rgb_transaction.stale_session:${identity.imageSessionId}:${currentImageSessionId(state)}`,
    );
  }
  if (state.adjustmentRevision !== identity.adjustmentRevision) {
    throw new Error(
      `color_balance_rgb_transaction.stale_revision:${String(identity.adjustmentRevision)}:${String(state.adjustmentRevision)}`,
    );
  }
  assertColorBalanceRgb(colorBalanceRgb);

  return {
    baseAdjustmentRevision: identity.adjustmentRevision,
    history: 'single-entry',
    imageSessionId: identity.imageSessionId,
    operations: [{ patch: { colorBalanceRgb: structuredClone(colorBalanceRgb) }, type: 'patch-adjustments' }],
    persistence: 'commit',
    source: 'manual-control',
    transactionId,
  };
};
