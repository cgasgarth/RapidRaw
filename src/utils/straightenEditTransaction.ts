import type { Adjustments } from './adjustments';
import { resolveCropForGeometryTransaction } from './cropUtils';
import type { EditTransactionRequest } from './editTransaction';
import { reconcileReferenceMatchReceiptsAfterEdit } from './referenceMatchTransfer';

export interface StraightenEditTransactionState {
  adjustmentRevision: number;
  adjustments: Adjustments;
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

  const previous = state.adjustments;
  const rotation = (previous.rotation || 0) + correctionDegrees;
  const selectedImage = state.selectedImage;
  const proposed =
    correctionDegrees === 0
      ? previous
      : {
          ...previous,
          crop:
            selectedImage.width > 0 && selectedImage.height > 0
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
              : previous.crop,
          rotation,
        };

  return {
    baseAdjustmentRevision: state.adjustmentRevision,
    history: 'single-entry',
    imageSessionId: identity.imageSessionId,
    operations: [
      {
        adjustments: reconcileReferenceMatchReceiptsAfterEdit(previous, proposed),
        type: 'replace-adjustments',
      },
    ],
    persistence: 'commit',
    source: 'geometry-tool',
    transactionId,
  };
};
