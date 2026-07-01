import { z } from 'zod';
import { useEditorStore } from '../../../store/useEditorStore';
import type { Adjustments } from '../../adjustments';
import type { BasicToneCommandEnvelope } from '../../basicToneCommandBridge';
import { buildAgentImageContextSnapshot } from '../context/agentImageContextSnapshot';

export const AGENT_HISTORY_ROLLBACK_TOOL_NAME = 'rawengine.agent.history.rollback';
export const AGENT_HISTORY_ROLLBACK_INPUT_SCHEMA_NAME = 'AgentHistoryRollbackRequestV1';
export const AGENT_HISTORY_ROLLBACK_OUTPUT_SCHEMA_NAME = 'AgentHistoryRollbackResponseV1';

const rollbackScopeSchema = z.enum(['operation', 'session_start']);

export interface AgentSessionCheckpoint {
  adjustments: Adjustments;
  activeImagePath: string;
  graphRevision: string;
  historyIndex: number;
  lastBasicToneCommand: BasicToneCommandEnvelope | null;
  previewRecipeHash: string;
  previewRef: string | null;
  sessionId: string;
  uncroppedPreviewRef: string | null;
}

const agentSessionCheckpointSchema: z.ZodType<AgentSessionCheckpoint> = z
  .object({
    adjustments: z.custom<Adjustments>((value) => typeof value === 'object' && value !== null),
    activeImagePath: z.string().trim().min(1),
    graphRevision: z.string().trim().min(1),
    historyIndex: z.number().int().nonnegative(),
    lastBasicToneCommand: z.custom<BasicToneCommandEnvelope | null>(),
    previewRecipeHash: z.string().trim().min(1),
    previewRef: z.string().trim().min(1).nullable(),
    sessionId: z.string().trim().min(1),
    uncroppedPreviewRef: z.string().trim().min(1).nullable(),
  })
  .strict();

export const agentHistoryRollbackRequestSchema = z
  .object({
    checkpoint: agentSessionCheckpointSchema,
    expectedCurrentGraphRevision: z.string().trim().min(1).optional(),
    expectedCurrentPreviewRecipeHash: z.string().trim().min(1).optional(),
    expectedSelectedImagePath: z.string().trim().min(1).optional(),
    requestId: z.string().trim().min(1),
    scope: rollbackScopeSchema,
    sessionId: z.string().trim().min(1),
  })
  .strict();

export const agentHistoryRollbackResponseSchema = z
  .object({
    currentGraphRevision: z.string().trim().min(1),
    currentPreviewRecipeHash: z.string().trim().min(1),
    graphRevision: z.string().trim().min(1),
    previewProvenanceRestored: z.literal(true),
    previewRecipeHash: z.string().trim().min(1),
    requestId: z.string().trim().min(1),
    restoredPreviewRef: z.string().trim().min(1).nullable(),
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
    activeImagePath: snapshot.activeImagePath,
    graphRevision: `history_${state.historyIndex}`,
    historyIndex: state.historyIndex,
    lastBasicToneCommand: state.lastBasicToneCommand,
    previewRecipeHash: snapshot.initialPreview.recipeHash,
    previewRef: state.finalPreviewUrl,
    sessionId,
    uncroppedPreviewRef: state.uncroppedAdjustedPreviewUrl,
  };
};

export const rollbackAgentSessionHistory = (request: AgentHistoryRollbackRequest): AgentHistoryRollbackResponse => {
  const parsedRequest = agentHistoryRollbackRequestSchema.parse(request);
  const { checkpoint } = parsedRequest;
  if (checkpoint.sessionId !== parsedRequest.sessionId) {
    throw new Error('Agent history rollback rejected checkpoint from a different session.');
  }

  const currentSnapshot = buildAgentImageContextSnapshot();
  if (
    parsedRequest.expectedSelectedImagePath !== undefined &&
    currentSnapshot.activeImagePath !== parsedRequest.expectedSelectedImagePath
  ) {
    throw new Error('Agent history rollback rejected a different selected image.');
  }
  if (
    parsedRequest.expectedCurrentGraphRevision !== undefined &&
    currentSnapshot.graphRevision !== parsedRequest.expectedCurrentGraphRevision
  ) {
    throw new Error('Agent history rollback rejected stale graph revision.');
  }
  if (
    parsedRequest.expectedCurrentPreviewRecipeHash !== undefined &&
    currentSnapshot.initialPreview.recipeHash !== parsedRequest.expectedCurrentPreviewRecipeHash
  ) {
    throw new Error('Agent history rollback rejected stale preview recipe hash.');
  }

  useEditorStore.setState((state) => ({
    adjustments: checkpoint.adjustments,
    finalPreviewUrl: checkpoint.previewRef,
    history: state.history.slice(0, checkpoint.historyIndex + 1),
    historyIndex: checkpoint.historyIndex,
    lastBasicToneCommand: checkpoint.lastBasicToneCommand,
    uncroppedAdjustedPreviewUrl: checkpoint.uncroppedPreviewRef,
  }));

  const restoredSnapshot = buildAgentImageContextSnapshot();
  const restoredState = useEditorStore.getState();
  if (restoredSnapshot.activeImagePath !== checkpoint.activeImagePath) {
    throw new Error('Agent history rollback failed to restore selected image provenance.');
  }
  if (restoredSnapshot.graphRevision !== checkpoint.graphRevision) {
    throw new Error('Agent history rollback failed to restore graph revision.');
  }
  if (restoredSnapshot.initialPreview.recipeHash !== checkpoint.previewRecipeHash) {
    throw new Error('Agent history rollback failed to restore preview recipe hash.');
  }
  if (restoredState.lastBasicToneCommand !== checkpoint.lastBasicToneCommand) {
    throw new Error('Agent history rollback failed to restore basic-tone provenance.');
  }

  return agentHistoryRollbackResponseSchema.parse({
    currentGraphRevision: currentSnapshot.graphRevision,
    currentPreviewRecipeHash: currentSnapshot.initialPreview.recipeHash,
    graphRevision: checkpoint.graphRevision,
    previewProvenanceRestored: true,
    previewRecipeHash: restoredSnapshot.initialPreview.recipeHash,
    requestId: parsedRequest.requestId,
    restoredPreviewRef: checkpoint.previewRef,
    restoredHistoryIndex: checkpoint.historyIndex,
    scope: parsedRequest.scope,
    sessionId: parsedRequest.sessionId,
    toolName: AGENT_HISTORY_ROLLBACK_TOOL_NAME,
  });
};
