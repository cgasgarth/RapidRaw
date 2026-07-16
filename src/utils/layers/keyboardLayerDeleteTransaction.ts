import { readLayerStackSidecarsFromSidecar } from '../../../packages/rawengine-schema/src';
import type { EditDocumentV2 } from '../../../packages/rawengine-schema/src/editDocumentV2';
import type { Adjustments } from '../adjustments';
import { buildAdjustmentMutationOperations, type EditTransactionRequest } from '../editTransaction';
import { reconcileReferenceMatchReceiptsAfterEdit } from '../referenceMatchTransfer';
import { applyLayerStackCommandBridgeOperation } from './layerStackCommandBridge';
import { persistLayerStackSidecarInAdjustments } from './layerStackSidecarAdjustments';

export interface KeyboardLayerDeleteState {
  adjustmentRevision: number;
  adjustmentSnapshot: { readonly value: Adjustments };
  editDocumentV2: EditDocumentV2;
  historyIndex: number;
  imageSession: { id: string } | null;
  imageSessionId: number;
  selectedImage: { path: string } | null;
}

export interface KeyboardLayerDeleteTransaction {
  graphRevision: string;
  imagePath: string;
  request: EditTransactionRequest;
}

export const buildKeyboardLayerDeleteTransaction = (
  state: KeyboardLayerDeleteState,
  layerId: string,
  operationId: string,
): KeyboardLayerDeleteTransaction | null => {
  const imagePath = state.selectedImage?.path;
  if (imagePath === undefined || !state.adjustmentSnapshot.value.masks.some((mask) => mask.id === layerId)) return null;

  const persistedSidecar = readLayerStackSidecarsFromSidecar(state.adjustmentSnapshot.value).find(
    (sidecar) => sidecar.sourceImagePath === imagePath,
  );
  const graphRevision = persistedSidecar?.graphRevision ?? `history_${String(state.historyIndex)}`;
  const deleted = applyLayerStackCommandBridgeOperation(
    state.adjustmentSnapshot.value.masks,
    { layerId, type: 'delete' },
    {
      graphRevision,
      imagePath,
      operationId,
      ...(persistedSidecar === undefined ? {} : { persistedSidecar }),
      sessionId: 'rapidraw-keyboard-layer-delete',
    },
  );
  const nextAdjustments = reconcileReferenceMatchReceiptsAfterEdit(
    state.adjustmentSnapshot.value,
    persistLayerStackSidecarInAdjustments({ ...state.adjustmentSnapshot.value, masks: deleted.masks }, deleted.sidecar),
  );

  return {
    graphRevision: deleted.graphRevision,
    imagePath,
    request: {
      baseAdjustmentRevision: state.adjustmentRevision,
      history: 'single-entry',
      imageSessionId: state.imageSession?.id ?? `editor-image-session:${String(state.imageSessionId)}`,
      operations: buildAdjustmentMutationOperations(
        state.adjustmentSnapshot.value,
        nextAdjustments,
        state.editDocumentV2,
      ),
      persistence: 'commit',
      source: 'layer-command',
      transactionId: operationId,
    },
  };
};
