import {
  readLayerStackSidecarsFromSidecar,
  upsertLayerStackSidecarInSidecar,
} from '../../../packages/rawengine-schema/src';
import { type EditDocumentV2, editDocumentLayersV2Schema } from '../../../packages/rawengine-schema/src/editDocumentV2';
import { selectEditDocumentMasks } from '../editDocumentSelectors';
import type { EditTransactionRequest } from '../editTransaction';
import { applyLayerStackCommandBridgeOperation } from './layerStackCommandBridge';

export interface KeyboardLayerDeleteState {
  adjustmentRevision: number;
  readonly editDocumentV2: EditDocumentV2;
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
  if (imagePath === undefined || !selectEditDocumentMasks(state.editDocumentV2).some((mask) => mask.id === layerId))
    return null;

  const persistedSidecar = readLayerStackSidecarsFromSidecar(state.editDocumentV2.extensions).find(
    (sidecar) => sidecar.sourceImagePath === imagePath,
  );
  const graphRevision = persistedSidecar?.graphRevision ?? `history_${String(state.historyIndex)}`;
  const deleted = applyLayerStackCommandBridgeOperation(
    selectEditDocumentMasks(state.editDocumentV2),
    { layerId, type: 'delete' },
    {
      graphRevision,
      imagePath,
      operationId,
      ...(persistedSidecar === undefined ? {} : { persistedSidecar }),
      sessionId: 'rapidraw-keyboard-layer-delete',
    },
  );
  const rawEngineArtifacts = upsertLayerStackSidecarInSidecar(state.editDocumentV2, deleted.sidecar).rawEngineArtifacts;
  if (rawEngineArtifacts === undefined) throw new Error('keyboard_layer_delete.missing_sidecar_artifacts');
  return {
    graphRevision: deleted.graphRevision,
    imagePath,
    request: {
      baseAdjustmentRevision: state.adjustmentRevision,
      history: 'single-entry',
      imageSessionId: state.imageSession?.id ?? `editor-image-session:${String(state.imageSessionId)}`,
      operations: [
        {
          nodeType: 'layers',
          patch: editDocumentLayersV2Schema.parse({ masks: deleted.masks }),
          type: 'patch-edit-document-node',
        },
        { rawEngineArtifacts, type: 'set-layer-stack-artifacts' },
      ],
      persistence: 'commit',
      source: 'layer-command',
      transactionId: operationId,
    },
  };
};
