import type { EditDocumentNodeParamsV2, EditDocumentV2 } from '../../packages/rawengine-schema/src/editDocumentV2';
import type { ToneCurveTargetCommitResult } from '../components/panel/editor/toneCurveTargetInteractionController';
import { selectEditDocumentNode } from './editDocumentSelectors';
import type { EditTransactionRequest } from './editTransaction';

export interface ToneCurveTargetEditTransactionState {
  readonly adjustmentRevision: number;
  readonly editDocumentV2: EditDocumentV2;
  readonly imageSession: { readonly id: string } | null;
  readonly imageSessionId: number;
  readonly selectedImage: { readonly path: string } | null;
  readonly geometryEpoch: number;
  readonly sourceRevision: string;
}

const currentImageSessionId = (state: ToneCurveTargetEditTransactionState): string =>
  state.imageSession?.id ?? `editor-image-session:${String(state.imageSessionId)}`;

export const buildToneCurveTargetEditTransaction = (
  state: ToneCurveTargetEditTransactionState,
  command: ToneCurveTargetCommitResult,
  transactionId: string,
): EditTransactionRequest => {
  if (state.selectedImage?.path !== command.key.sourceIdentity) {
    throw new Error(`tone_curve_target_transaction.stale_source:${command.key.sourceIdentity}`);
  }
  if (currentImageSessionId(state) !== command.key.imageSessionId) {
    throw new Error(`tone_curve_target_transaction.stale_session:${command.key.imageSessionId}`);
  }
  if (state.adjustmentRevision !== command.key.adjustmentRevision) {
    throw new Error(`tone_curve_target_transaction.stale_revision:${String(command.key.adjustmentRevision)}`);
  }
  if (state.geometryEpoch !== command.key.geometryEpoch) {
    throw new Error(`tone_curve_target_transaction.stale_geometry:${String(command.key.geometryEpoch)}`);
  }
  if (state.sourceRevision !== command.key.sourceRevision) {
    throw new Error(`tone_curve_target_transaction.stale_render:${command.key.sourceRevision}`);
  }
  const current = selectEditDocumentNode(state.editDocumentV2, 'scene_curve').params;
  const curve: EditDocumentNodeParamsV2<'scene_curve'> = {
    ...current,
    ...structuredClone(command.curve),
  };
  return {
    baseAdjustmentRevision: command.key.adjustmentRevision,
    history: 'single-entry',
    imageSessionId: command.key.imageSessionId,
    operations: [{ nodeType: 'scene_curve', patch: curve, type: 'patch-edit-document-node' }],
    persistence: 'commit',
    source: 'manual-control',
    transactionId,
  };
};
