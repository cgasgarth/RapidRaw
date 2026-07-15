import type { Adjustments } from './adjustments';
import type { EditTransactionRequest } from './editTransaction';
import { SELECTIVE_COLOR_RANGES } from './selectiveColorRanges';

export type SelectiveColorMixerSettings = Pick<Adjustments, 'hsl' | 'selectiveColorRangeControls'>;

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

const assertMixerSettings = (settings: SelectiveColorMixerSettings): void => {
  for (const range of SELECTIVE_COLOR_RANGES) {
    const hsl = settings.hsl[range.key];
    for (const [key, value] of Object.entries(hsl)) {
      if (!Number.isFinite(value) || value < -100 || value > 100) {
        throw new Error(`selective_color_transaction.invalid_hsl:${range.key}:${key}`);
      }
    }

    const controls = settings.selectiveColorRangeControls[range.key];
    if (
      !Number.isFinite(controls.centerHueDegrees) ||
      controls.centerHueDegrees < 0 ||
      controls.centerHueDegrees >= 360
    ) {
      throw new Error(`selective_color_transaction.invalid_range:${range.key}:centerHueDegrees`);
    }
    if (!Number.isFinite(controls.widthDegrees) || controls.widthDegrees < 10 || controls.widthDegrees > 180) {
      throw new Error(`selective_color_transaction.invalid_range:${range.key}:widthDegrees`);
    }
    if (
      !Number.isFinite(controls.falloffSmoothness) ||
      controls.falloffSmoothness < 0.25 ||
      controls.falloffSmoothness > 4
    ) {
      throw new Error(`selective_color_transaction.invalid_range:${range.key}:falloffSmoothness`);
    }
  }
};

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
  assertMixerSettings(settings);

  return {
    baseAdjustmentRevision: identity.adjustmentRevision,
    history: 'single-entry',
    imageSessionId: identity.imageSessionId,
    operations: [
      {
        patch: {
          hsl: structuredClone(settings.hsl),
          selectiveColorRangeControls: structuredClone(settings.selectiveColorRangeControls),
        },
        type: 'patch-adjustments',
      },
    ],
    persistence: 'commit',
    source: 'manual-control',
    transactionId,
  };
};
