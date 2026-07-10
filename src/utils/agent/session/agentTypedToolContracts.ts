import type { z } from 'zod';

import {
  RAW_ENGINE_AGENT_SELECTED_IMAGE_PROPOSAL_RENDER_TOOL_NAME,
  rawEngineAgentSelectedImageProposalReceiptV1Schema,
  rawEngineAgentSelectedImageProposalRenderCommandV1Schema,
} from '../../../../packages/rawengine-schema/src/agentSelectedImageProposalSchemas';
import {
  AGENT_CURRENT_IMAGE_PREVIEW_LOOP_APPLY_REVIEW_TOOL_NAME,
  AGENT_CURRENT_IMAGE_PREVIEW_LOOP_TOOL_NAME,
  agentCurrentImagePreviewLoopApplyReviewRequestSchema,
  agentCurrentImagePreviewLoopRequestSchema,
  agentCurrentImagePreviewLoopResultSchema,
} from '../context/agentCurrentImagePreviewLoop';
import {
  AGENT_PREVIEW_COMPARE_TOOL_NAME,
  AGENT_PREVIEW_RENDER_TOOL_NAME,
  AGENT_STATE_GET_TOOL_NAME,
  agentPreviewCompareRequestSchema,
  agentPreviewCompareResponseSchema,
  agentPreviewRenderRequestSchema,
  agentPreviewRenderResponseSchema,
  agentStateGetRequestSchema,
  agentStateGetResponseSchema,
  RAW_ENGINE_IMAGE_GET_PREVIEW_TOOL_NAME,
  rawEngineImageGetPreviewAttachmentResponseSchema,
  rawEngineImageGetPreviewRequestSchema,
} from '../context/agentReadOnlyAppServerTools';
import {
  AGENT_ADJUSTMENTS_APPLY_TOOL_NAME,
  AGENT_ADJUSTMENTS_DRY_RUN_TOOL_NAME,
  agentAdjustmentsApplyRequestSchema,
  agentAdjustmentsApplyResponseSchema,
  agentAdjustmentsDryRunRequestSchema,
  agentAdjustmentsDryRunResponseSchema,
} from '../tools/agentAdjustmentApplyTool';
import {
  AGENT_HISTORY_ROLLBACK_TOOL_NAME,
  agentHistoryRollbackRequestSchema,
  agentHistoryRollbackResponseSchema,
} from './agentSessionHistory';

const defineAgentEditorToolContract = <RequestSchema extends z.ZodType, ResponseSchema extends z.ZodType>(contract: {
  isPreviewRefresh: boolean;
  mutates: boolean;
  requestSchema: RequestSchema;
  responseSchema: ResponseSchema;
  schemaVersion: 1;
}) => contract;

export const agentEditorToolContracts = {
  [AGENT_STATE_GET_TOOL_NAME]: defineAgentEditorToolContract({
    isPreviewRefresh: false,
    mutates: false,
    requestSchema: agentStateGetRequestSchema,
    responseSchema: agentStateGetResponseSchema,
    schemaVersion: 1,
  }),
  [RAW_ENGINE_IMAGE_GET_PREVIEW_TOOL_NAME]: defineAgentEditorToolContract({
    isPreviewRefresh: true,
    mutates: false,
    requestSchema: rawEngineImageGetPreviewRequestSchema,
    responseSchema: rawEngineImageGetPreviewAttachmentResponseSchema,
    schemaVersion: 1,
  }),
  [RAW_ENGINE_AGENT_SELECTED_IMAGE_PROPOSAL_RENDER_TOOL_NAME]: defineAgentEditorToolContract({
    isPreviewRefresh: false,
    mutates: false,
    requestSchema: rawEngineAgentSelectedImageProposalRenderCommandV1Schema,
    responseSchema: rawEngineAgentSelectedImageProposalReceiptV1Schema,
    schemaVersion: 1,
  }),
  [AGENT_PREVIEW_RENDER_TOOL_NAME]: defineAgentEditorToolContract({
    isPreviewRefresh: true,
    mutates: false,
    requestSchema: agentPreviewRenderRequestSchema,
    responseSchema: agentPreviewRenderResponseSchema,
    schemaVersion: 1,
  }),
  [AGENT_PREVIEW_COMPARE_TOOL_NAME]: defineAgentEditorToolContract({
    isPreviewRefresh: false,
    mutates: false,
    requestSchema: agentPreviewCompareRequestSchema,
    responseSchema: agentPreviewCompareResponseSchema,
    schemaVersion: 1,
  }),
  [AGENT_ADJUSTMENTS_DRY_RUN_TOOL_NAME]: defineAgentEditorToolContract({
    isPreviewRefresh: false,
    mutates: false,
    requestSchema: agentAdjustmentsDryRunRequestSchema,
    responseSchema: agentAdjustmentsDryRunResponseSchema,
    schemaVersion: 1,
  }),
  [AGENT_ADJUSTMENTS_APPLY_TOOL_NAME]: defineAgentEditorToolContract({
    isPreviewRefresh: false,
    mutates: true,
    requestSchema: agentAdjustmentsApplyRequestSchema,
    responseSchema: agentAdjustmentsApplyResponseSchema,
    schemaVersion: 1,
  }),
  [AGENT_HISTORY_ROLLBACK_TOOL_NAME]: defineAgentEditorToolContract({
    isPreviewRefresh: false,
    mutates: true,
    requestSchema: agentHistoryRollbackRequestSchema,
    responseSchema: agentHistoryRollbackResponseSchema,
    schemaVersion: 1,
  }),
  [AGENT_CURRENT_IMAGE_PREVIEW_LOOP_TOOL_NAME]: defineAgentEditorToolContract({
    isPreviewRefresh: false,
    mutates: true,
    requestSchema: agentCurrentImagePreviewLoopRequestSchema,
    responseSchema: agentCurrentImagePreviewLoopResultSchema,
    schemaVersion: 1,
  }),
  [AGENT_CURRENT_IMAGE_PREVIEW_LOOP_APPLY_REVIEW_TOOL_NAME]: defineAgentEditorToolContract({
    isPreviewRefresh: false,
    mutates: true,
    requestSchema: agentCurrentImagePreviewLoopApplyReviewRequestSchema,
    responseSchema: agentCurrentImagePreviewLoopResultSchema,
    schemaVersion: 1,
  }),
} as const;

export type AgentEditorToolContractMap = typeof agentEditorToolContracts;
export type AgentEditorToolName = keyof AgentEditorToolContractMap;
export type AgentEditorToolRequest<Name extends AgentEditorToolName> = AgentEditorToolContractMap[Name] extends {
  requestSchema: infer Schema extends z.ZodType;
}
  ? z.input<Schema>
  : never;
export type AgentEditorToolResponse<Name extends AgentEditorToolName> = AgentEditorToolContractMap[Name] extends {
  responseSchema: infer Schema extends z.ZodType;
}
  ? z.output<Schema>
  : never;

export const isAgentEditorToolName = (value: string): value is AgentEditorToolName => value in agentEditorToolContracts;
