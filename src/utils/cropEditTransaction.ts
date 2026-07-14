import type { Crop } from 'react-image-crop';
import type { EditTransactionRequest } from './editTransaction';

export interface CropCommitIdentity {
  imageSessionId: string;
  operationGeneration: number;
  sourceIdentity: string;
  sourceRevision: string;
  tool: 'crop' | 'straighten';
}

export interface CropEditTransactionState {
  adjustmentRevision: number;
  imageSession: { id: string } | null;
  operationGeneration: number;
  selectedImage: { path: string } | null;
  sourceRevision: string;
}

export const buildCropEditTransaction = (
  state: CropEditTransactionState,
  identity: CropCommitIdentity,
  crop: Crop,
  transactionId: string,
): EditTransactionRequest => {
  if (identity.tool !== 'crop') throw new Error(`crop_transaction.invalid_tool:${identity.tool}`);
  if (state.selectedImage?.path !== identity.sourceIdentity) {
    throw new Error(`crop_transaction.stale_source:${identity.sourceIdentity}:${state.selectedImage?.path ?? 'none'}`);
  }
  if (state.imageSession?.id !== identity.imageSessionId) {
    throw new Error(`crop_transaction.stale_session:${identity.imageSessionId}:${state.imageSession?.id ?? 'none'}`);
  }
  if (state.sourceRevision !== identity.sourceRevision) {
    throw new Error(`crop_transaction.stale_graph:${identity.sourceRevision}:${state.sourceRevision}`);
  }
  if (state.operationGeneration !== identity.operationGeneration) {
    throw new Error(
      `crop_transaction.stale_generation:${String(identity.operationGeneration)}:${String(state.operationGeneration)}`,
    );
  }
  return {
    baseAdjustmentRevision: state.adjustmentRevision,
    history: 'single-entry',
    imageSessionId: identity.imageSessionId,
    operations: [{ nodeType: 'geometry', patch: { crop }, type: 'patch-edit-document-node' }],
    persistence: 'commit',
    source: 'geometry-tool',
    transactionId,
  };
};
