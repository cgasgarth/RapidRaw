import type { EditDocumentNodeParamsV2, EditDocumentV2 } from '../../packages/rawengine-schema/src/editDocumentV2';
import type { EditTransactionRequest } from './editTransaction';

export interface AgentEditGraphCommitIdentity {
  adjustmentRevision: number;
  imageSessionId: string;
  sourceIdentity: string;
}

export interface AgentEditGraphEditTransactionState {
  adjustmentRevision: number;
  editDocumentV2: EditDocumentV2;
  imageSession: { id: string } | null;
  imageSessionId: number;
  selectedImage: { path: string } | null;
}

const currentImageSessionId = (state: AgentEditGraphEditTransactionState): string =>
  state.imageSession?.id ?? `editor-image-session:${String(state.imageSessionId)}`;

export const captureAgentEditGraphCommitIdentity = (
  state: AgentEditGraphEditTransactionState,
): AgentEditGraphCommitIdentity | null =>
  state.selectedImage === null
    ? null
    : {
        adjustmentRevision: state.adjustmentRevision,
        imageSessionId: currentImageSessionId(state),
        sourceIdentity: state.selectedImage.path,
      };

export const buildAgentEditGraphEditTransaction = (
  state: AgentEditGraphEditTransactionState,
  identity: AgentEditGraphCommitIdentity,
  patch: Readonly<Partial<EditDocumentNodeParamsV2<'scene_global_color_tone'>>>,
  transactionId: string,
): EditTransactionRequest => {
  if (state.selectedImage?.path !== identity.sourceIdentity) {
    throw new Error(
      `agent_editgraph_transaction.stale_source:${identity.sourceIdentity}:${state.selectedImage?.path ?? 'none'}`,
    );
  }
  if (currentImageSessionId(state) !== identity.imageSessionId) {
    throw new Error(
      `agent_editgraph_transaction.stale_session:${identity.imageSessionId}:${currentImageSessionId(state)}`,
    );
  }
  if (state.adjustmentRevision !== identity.adjustmentRevision) {
    throw new Error(
      `agent_editgraph_transaction.stale_revision:${String(identity.adjustmentRevision)}:${String(state.adjustmentRevision)}`,
    );
  }
  return {
    baseAdjustmentRevision: identity.adjustmentRevision,
    history: 'single-entry',
    imageSessionId: identity.imageSessionId,
    operations: [{ nodeType: 'scene_global_color_tone', patch, type: 'patch-edit-document-node' }],
    persistence: 'commit',
    source: 'agent-command',
    transactionId,
  };
};
