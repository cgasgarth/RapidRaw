import type { Adjustments } from './adjustments';
import { buildAdjustmentMutationOperations, type EditTransactionRequest } from './editTransaction';

export interface AgentEditGraphCommitIdentity {
  adjustmentRevision: number;
  imageSessionId: string;
  sourceIdentity: string;
}

export interface AgentEditGraphEditTransactionState {
  adjustmentRevision: number;
  adjustments: Adjustments;
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
  nextAdjustments: Adjustments,
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
    operations: buildAdjustmentMutationOperations(state.adjustments, nextAdjustments),
    persistence: 'commit',
    source: 'agent-command',
    transactionId,
  };
};
