import type { EditDocumentV2 } from '../../packages/rawengine-schema/src/editDocumentV2';
import { resolveCropForGeometryTransaction } from './cropUtils';
import { selectEditDocumentGeometry } from './editDocumentSelectors';
import type { EditTransactionRequest } from './editTransaction';

export interface StraightenEditTransactionState {
  adjustmentRevision: number;
  readonly editDocumentV2: EditDocumentV2;
  imageSession: { id: string } | null;
  operationGeneration: number;
  selectedImage: { height: number; path: string; width: number } | null;
  sourceRevision: string;
}

export interface StraightenCommitIdentity {
  imageSessionId: string;
  operationGeneration: number;
  sourceIdentity: string;
  sourceRevision: string;
  tool: 'crop' | 'straighten';
}

export const buildStraightenEditTransaction = (
  state: StraightenEditTransactionState,
  identity: StraightenCommitIdentity,
  correctionDegrees: number,
  transactionId: string,
): EditTransactionRequest => {
  if (identity.tool !== 'straighten') throw new Error(`straighten_transaction.invalid_tool:${identity.tool}`);
  if (state.selectedImage?.path !== identity.sourceIdentity) {
    throw new Error(
      `straighten_transaction.stale_source:${identity.sourceIdentity}:${state.selectedImage?.path ?? 'none'}`,
    );
  }
  if (state.imageSession?.id !== identity.imageSessionId) {
    throw new Error(
      `straighten_transaction.stale_session:${identity.imageSessionId}:${state.imageSession?.id ?? 'none'}`,
    );
  }
  if (state.sourceRevision !== identity.sourceRevision) {
    throw new Error(`straighten_transaction.stale_graph:${identity.sourceRevision}:${state.sourceRevision}`);
  }
  if (state.operationGeneration !== identity.operationGeneration) {
    throw new Error(
      `straighten_transaction.stale_generation:${String(identity.operationGeneration)}:${String(state.operationGeneration)}`,
    );
  }

  const previous = selectEditDocumentGeometry(state.editDocumentV2);
  const rotation = (previous.rotation || 0) + correctionDegrees;
  const selectedImage = state.selectedImage;
  const crop =
    correctionDegrees !== 0 && selectedImage.width > 0 && selectedImage.height > 0
      ? resolveCropForGeometryTransaction(
          previous.crop,
          selectedImage.width,
          selectedImage.height,
          {
            aspectRatio: previous.aspectRatio,
            orientationSteps: previous.orientationSteps || 0,
            rotation: previous.rotation || 0,
          },
          {
            aspectRatio: previous.aspectRatio,
            orientationSteps: previous.orientationSteps || 0,
            rotation,
          },
        )
      : previous.crop;

  return {
    baseAdjustmentRevision: state.adjustmentRevision,
    history: 'single-entry',
    imageSessionId: identity.imageSessionId,
    operations: [
      {
        nodeType: 'geometry',
        patch: { crop, rotation },
        type: 'patch-edit-document-node',
      },
    ],
    persistence: 'commit',
    source: 'geometry-tool',
    transactionId,
  };
};
