import { editDocumentSourceArtifactsV2Schema } from '../../packages/rawengine-schema/src/editDocumentV2';
import type { AiPatch } from './adjustments';
import type { EditTransactionRequest } from './editTransaction';

export interface AiSourceArtifactEditTransactionState {
  adjustmentRevision: number;
  imageSession: { id: string; path: string } | null;
  selectedImage: { path: string } | null;
}

/** Build a source/session/revision-bound commit for render-authoritative AI patches. */
export const buildAiSourceArtifactEditTransaction = (
  state: AiSourceArtifactEditTransactionState,
  aiPatches: readonly AiPatch[],
  transactionId: string,
): EditTransactionRequest | null => {
  const sourcePath = state.selectedImage?.path;
  const session = state.imageSession;
  if (sourcePath === undefined || session === null || session.path !== sourcePath) return null;
  const sourceArtifacts = editDocumentSourceArtifactsV2Schema.parse({ aiPatches: structuredClone(aiPatches) });

  return {
    baseAdjustmentRevision: state.adjustmentRevision,
    history: 'single-entry',
    imageSessionId: session.id,
    operations: [
      {
        nodeType: 'source_artifacts',
        patch: sourceArtifacts,
        type: 'patch-edit-document-node',
      },
    ],
    persistence: 'commit',
    source: 'ai-edit',
    transactionId,
  };
};
