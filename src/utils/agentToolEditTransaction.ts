import type { Adjustments } from './adjustments';
import { buildAdjustmentMutationOperations, type EditTransactionRequest } from './editTransaction';

export interface AgentToolCommitIdentity {
  adjustmentRevision: number;
  imageSessionId: string;
  sourceIdentity: string;
}

export interface AgentToolEditTransactionState {
  adjustmentRevision: number;
  adjustments: Adjustments;
  imageSession: { id: string } | null;
  selectedImage: { path: string } | null;
}

export const captureAgentToolCommitIdentity = (state: AgentToolEditTransactionState): AgentToolCommitIdentity | null =>
  state.selectedImage === null || state.imageSession === null
    ? null
    : {
        adjustmentRevision: state.adjustmentRevision,
        imageSessionId: state.imageSession.id,
        sourceIdentity: state.selectedImage.path,
      };

export const buildAgentToolEditTransaction = (
  state: AgentToolEditTransactionState,
  identity: AgentToolCommitIdentity,
  nextAdjustments: Adjustments,
  transactionId: string,
): EditTransactionRequest => {
  if (state.selectedImage?.path !== identity.sourceIdentity) {
    throw new Error(
      `agent_tool_transaction.stale_source:${identity.sourceIdentity}:${state.selectedImage?.path ?? 'none'}`,
    );
  }
  if (state.imageSession?.id !== identity.imageSessionId) {
    throw new Error(
      `agent_tool_transaction.stale_session:${identity.imageSessionId}:${state.imageSession?.id ?? 'none'}`,
    );
  }
  if (state.adjustmentRevision !== identity.adjustmentRevision) {
    throw new Error(
      `agent_tool_transaction.stale_revision:${String(identity.adjustmentRevision)}:${String(state.adjustmentRevision)}`,
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
