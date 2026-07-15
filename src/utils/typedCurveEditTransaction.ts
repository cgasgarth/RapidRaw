import type { Adjustments, OutputCurveSettingsV1, SceneCurveSettingsV1 } from './adjustments';
import type { EditTransactionRequest } from './editTransaction';

export interface TypedCurveCommitIdentity {
  adjustmentRevision: number;
  imageSessionId: string;
  sourceIdentity: string;
}

export interface TypedCurveEditTransactionState {
  adjustmentRevision: number;
  adjustments: Pick<Adjustments, 'rawEngineEditGraphVersion'>;
  imageSession: { id: string } | null;
  imageSessionId: number;
  selectedImage: { path: string } | null;
}

export type TypedCurveCommit =
  | { domain: 'scene'; curve: SceneCurveSettingsV1 }
  | { domain: 'output'; curve: OutputCurveSettingsV1 };

const currentImageSessionId = (state: TypedCurveEditTransactionState): string =>
  state.imageSession?.id ?? `editor-image-session:${String(state.imageSessionId)}`;

export const captureTypedCurveCommitIdentity = (
  state: TypedCurveEditTransactionState,
): TypedCurveCommitIdentity | null =>
  state.selectedImage?.path !== undefined
    ? {
        adjustmentRevision: state.adjustmentRevision,
        imageSessionId: currentImageSessionId(state),
        sourceIdentity: state.selectedImage.path,
      }
    : null;

const assertCurrentIdentity = (state: TypedCurveEditTransactionState, identity: TypedCurveCommitIdentity): void => {
  if (state.selectedImage?.path !== identity.sourceIdentity) {
    throw new Error(
      `typed_curve_transaction.stale_source:${identity.sourceIdentity}:${state.selectedImage?.path ?? 'none'}`,
    );
  }
  if (currentImageSessionId(state) !== identity.imageSessionId) {
    throw new Error(`typed_curve_transaction.stale_session:${identity.imageSessionId}:${currentImageSessionId(state)}`);
  }
  if (state.adjustmentRevision !== identity.adjustmentRevision) {
    throw new Error(
      `typed_curve_transaction.stale_revision:${String(identity.adjustmentRevision)}:${String(state.adjustmentRevision)}`,
    );
  }
};

export const buildTypedCurveEditTransaction = (
  state: TypedCurveEditTransactionState,
  identity: TypedCurveCommitIdentity,
  commit: TypedCurveCommit,
  transactionId: string,
): EditTransactionRequest => {
  assertCurrentIdentity(state, identity);
  const curvePatch =
    commit.domain === 'scene'
      ? { sceneCurveV1: structuredClone(commit.curve) }
      : { outputCurveV1: structuredClone(commit.curve) };
  return {
    baseAdjustmentRevision: identity.adjustmentRevision,
    history: 'single-entry',
    imageSessionId: identity.imageSessionId,
    operations: [
      { nodeType: 'scene_curve', patch: curvePatch, type: 'patch-edit-document-node' },
      ...(state.adjustments.rawEngineEditGraphVersion === 2
        ? []
        : [{ patch: { rawEngineEditGraphVersion: 2 }, type: 'patch-adjustments' } as const]),
    ],
    persistence: 'commit',
    source: 'manual-control',
    transactionId,
  };
};
