import { layerStackSidecarPersistenceEnvelopeV1Schema } from '../../../packages/rawengine-schema/src';
import {
  type EditDocumentV2,
  editDocumentLayersV2Schema,
  editDocumentSourceArtifactsV2Schema,
} from '../../../packages/rawengine-schema/src/editDocumentV2';
import type { Adjustments } from '../adjustments';
import type { EditTransactionRequest } from '../editTransaction';

export interface LayerEditTransactionState {
  adjustmentRevision: number;
  editDocumentV2: EditDocumentV2;
  imageSessionId: number;
  imageSession?: { id: string } | null;
}

export interface LayerEditTransactionCandidate {
  readonly aiPatches: readonly AiPatch[];
  readonly masks: readonly MaskContainer[];
  readonly rawEngineArtifacts?: unknown;
}

export const buildLayerEditTransactionRequest = (
  state: LayerEditTransactionState,
  next: LayerEditTransactionCandidate,
  transactionId: string,
): EditTransactionRequest => {
  const layers = editDocumentLayersV2Schema.parse({ masks: structuredClone(nextAdjustments.masks) });
  const sourceArtifacts = editDocumentSourceArtifactsV2Schema.parse({
    aiPatches: structuredClone(nextAdjustments.aiPatches),
  });
  const artifactsEnvelope = layerStackSidecarPersistenceEnvelopeV1Schema.safeParse({
    rawEngineArtifacts: nextAdjustments['rawEngineArtifacts'],
  });
  const operations: EditTransactionRequest['operations'] = [
    {
      nodeType: 'layers',
      patch: layers,
      type: 'patch-edit-document-node',
    },
    ...(JSON.stringify(sourceArtifacts) === JSON.stringify(state.editDocumentV2.sourceArtifacts)
      ? []
      : [
          {
            nodeType: 'source_artifacts' as const,
            patch: sourceArtifacts,
            type: 'patch-edit-document-node' as const,
          },
        ]),
    ...(artifactsEnvelope.success && artifactsEnvelope.data.rawEngineArtifacts !== undefined
      ? [
          {
            rawEngineArtifacts: artifactsEnvelope.data.rawEngineArtifacts,
            type: 'set-layer-stack-artifacts' as const,
          },
        ]
      : []),
  ];
  return {
    transactionId,
    imageSessionId: state.imageSession?.id ?? `editor-image-session:${String(state.imageSessionId)}`,
    baseAdjustmentRevision: state.adjustmentRevision,
    source: 'layer-command',
    operations,
    history: 'single-entry',
    persistence: 'commit',
  };
};
