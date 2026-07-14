import { readLayerStackSidecarsFromSidecar } from '../../../packages/rawengine-schema/src';
import type { Adjustments } from '../adjustments';
import type { EditTransactionRequest } from '../editTransaction';
import { reconcileReferenceMatchReceiptsAfterEdit } from '../referenceMatchTransfer';
import { applyLayerStackCommandBridgeOperation } from './layerStackCommandBridge';
import { persistLayerStackSidecarInAdjustments } from './layerStackSidecarAdjustments';

export interface KeyboardLayerDeleteState {
  adjustmentRevision: number;
  adjustments: Adjustments;
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
  if (imagePath === undefined || !state.adjustments.masks.some((mask) => mask.id === layerId)) return null;

  const persistedSidecar = readLayerStackSidecarsFromSidecar(state.adjustments).find(
    (sidecar) => sidecar.sourceImagePath === imagePath,
  );
  const graphRevision = persistedSidecar?.graphRevision ?? `history_${String(state.historyIndex)}`;
  const deleted = applyLayerStackCommandBridgeOperation(
    state.adjustments.masks,
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
    state.adjustments,
    persistLayerStackSidecarInAdjustments({ ...state.adjustments, masks: deleted.masks }, deleted.sidecar),
  );

  return {
    graphRevision: deleted.graphRevision,
    imagePath,
    request: {
      baseAdjustmentRevision: state.adjustmentRevision,
      history: 'single-entry',
      imageSessionId: state.imageSession?.id ?? `editor-image-session:${String(state.imageSessionId)}`,
      operations: [{ adjustments: nextAdjustments, type: 'replace-adjustments' }],
      persistence: 'commit',
      source: 'layer-command',
      transactionId: operationId,
    },
  };
};
