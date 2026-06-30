import { z } from 'zod';
import { useEditorStore } from '../store/useEditorStore';
import type { Adjustments } from './adjustments';
import { buildAgentImageContextSnapshot } from './agentImageContextSnapshot';

export const AGENT_HISTORY_ROLLBACK_TOOL_NAME = 'rawengine.agent.history.rollback';
export const AGENT_HISTORY_ROLLBACK_INPUT_SCHEMA_NAME = 'AgentHistoryRollbackRequestV1';
export const AGENT_HISTORY_ROLLBACK_OUTPUT_SCHEMA_NAME = 'AgentHistoryRollbackResponseV1';

const rollbackScopeSchema = z.enum(['operation', 'session_start']);

export interface AgentSessionCheckpoint {
  adjustments: Adjustments;
  graphRevision: string;
  historyIndex: number;
  previewRecipeHash: string;
  previewRef: string | null;
  sessionId: string;
}

export const agentHistoryRollbackRequestSchema = z
  .object({
    checkpoint: z.custom<AgentSessionCheckpoint>(),
    requestId: z.string().trim().min(1),
    scope: rollbackScopeSchema,
    sessionId: z.string().trim().min(1),
  })
  .strict();

export const agentHistoryRollbackResponseSchema = z
  .object({
    graphRevision: z.string().trim().min(1),
    previewRecipeHash: z.string().trim().min(1),
    requestId: z.string().trim().min(1),
    restoredHistoryIndex: z.number().int().nonnegative(),
    scope: rollbackScopeSchema,
    sessionId: z.string().trim().min(1),
    toolName: z.literal(AGENT_HISTORY_ROLLBACK_TOOL_NAME),
  })
  .strict();

export type AgentHistoryRollbackRequest = z.infer<typeof agentHistoryRollbackRequestSchema>;
export type AgentHistoryRollbackResponse = z.infer<typeof agentHistoryRollbackResponseSchema>;

export const createAgentSessionCheckpoint = (sessionId: string): AgentSessionCheckpoint => {
  const state = useEditorStore.getState();
  const snapshot = buildAgentImageContextSnapshot();

  return {
    adjustments: state.adjustments,
    graphRevision: `history_${state.historyIndex}`,
    historyIndex: state.historyIndex,
    previewRecipeHash: snapshot.initialPreview.recipeHash,
    previewRef: state.finalPreviewUrl,
    sessionId,
  };
};

export const rollbackAgentSessionHistory = (request: AgentHistoryRollbackRequest): AgentHistoryRollbackResponse => {
  const parsedRequest = agentHistoryRollbackRequestSchema.parse(request);
  const { checkpoint } = parsedRequest;
  if (checkpoint.sessionId !== parsedRequest.sessionId) {
    throw new Error('Agent history rollback rejected checkpoint from a different session.');
  }
  useEditorStore.setState((state) => ({
    adjustments: checkpoint.adjustments,
    finalPreviewUrl: checkpoint.previewRef,
    history: state.history.slice(0, checkpoint.historyIndex + 1),
    historyIndex: checkpoint.historyIndex,
    uncroppedAdjustedPreviewUrl: null,
  }));

  const restoredSnapshot = buildAgentImageContextSnapshot();
  return agentHistoryRollbackResponseSchema.parse({
    graphRevision: checkpoint.graphRevision,
    previewRecipeHash: restoredSnapshot.initialPreview.recipeHash,
    requestId: parsedRequest.requestId,
    restoredHistoryIndex: checkpoint.historyIndex,
    scope: parsedRequest.scope,
    sessionId: parsedRequest.sessionId,
    toolName: AGENT_HISTORY_ROLLBACK_TOOL_NAME,
  });
};
