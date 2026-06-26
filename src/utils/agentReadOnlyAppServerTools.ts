import { z } from 'zod';

import { buildAgentImageContextSnapshot } from './agentImageContextSnapshot';

export const AGENT_STATE_GET_TOOL_NAME = 'rawengine.agent.state.get';
export const AGENT_PREVIEW_RENDER_TOOL_NAME = 'rawengine.agent.preview.render';
export const AGENT_STATE_GET_INPUT_SCHEMA_NAME = 'AgentStateGetRequestV1';
export const AGENT_STATE_GET_OUTPUT_SCHEMA_NAME = 'AgentStateGetResponseV1';
export const AGENT_PREVIEW_RENDER_INPUT_SCHEMA_NAME = 'AgentPreviewRenderRequestV1';
export const AGENT_PREVIEW_RENDER_OUTPUT_SCHEMA_NAME = 'AgentPreviewRenderResponseV1';

export const agentStateGetRequestSchema = z
  .object({
    expectedRecipeHash: z.string().trim().min(1).optional(),
    requestId: z.string().trim().min(1),
  })
  .strict();

export const agentPreviewRenderRequestSchema = z
  .object({
    expectedRecipeHash: z.string().trim().min(1).optional(),
    longEdgePx: z.number().int().min(256).max(2048).default(1536),
    purpose: z.enum(['detail_review', 'initial_context', 'refresh']).default('refresh'),
    quality: z.number().min(0.5).max(0.95).default(0.86),
    requestId: z.string().trim().min(1),
  })
  .strict();

export const agentStateGetResponseSchema = z
  .object({
    requestId: z.string().trim().min(1),
    snapshot: z.unknown(),
    staleRecipeHash: z.boolean(),
    toolName: z.literal(AGENT_STATE_GET_TOOL_NAME),
  })
  .strict();

export const agentPreviewRenderResponseSchema = z
  .object({
    preview: z.unknown(),
    requestId: z.string().trim().min(1),
    staleRecipeHash: z.boolean(),
    toolName: z.literal(AGENT_PREVIEW_RENDER_TOOL_NAME),
  })
  .strict();

export type AgentStateGetRequest = z.infer<typeof agentStateGetRequestSchema>;
export type AgentPreviewRenderRequest = z.infer<typeof agentPreviewRenderRequestSchema>;
export type AgentStateGetResponse = z.infer<typeof agentStateGetResponseSchema>;
export type AgentPreviewRenderResponse = z.infer<typeof agentPreviewRenderResponseSchema>;

export const getAgentReadOnlyState = (request: AgentStateGetRequest): AgentStateGetResponse => {
  const parsedRequest = agentStateGetRequestSchema.parse(request);
  const snapshot = buildAgentImageContextSnapshot();

  return agentStateGetResponseSchema.parse({
    requestId: parsedRequest.requestId,
    snapshot,
    staleRecipeHash:
      parsedRequest.expectedRecipeHash !== undefined &&
      parsedRequest.expectedRecipeHash !== snapshot.initialPreview.recipeHash,
    toolName: AGENT_STATE_GET_TOOL_NAME,
  });
};

export const renderAgentReadOnlyPreview = (request: AgentPreviewRenderRequest): AgentPreviewRenderResponse => {
  const parsedRequest = agentPreviewRenderRequestSchema.parse(request);
  const snapshot = buildAgentImageContextSnapshot();

  return agentPreviewRenderResponseSchema.parse({
    preview: {
      ...snapshot.initialPreview,
      longEdgePx: parsedRequest.longEdgePx,
      purpose: parsedRequest.purpose,
      quality: parsedRequest.quality,
    },
    requestId: parsedRequest.requestId,
    staleRecipeHash:
      parsedRequest.expectedRecipeHash !== undefined &&
      parsedRequest.expectedRecipeHash !== snapshot.initialPreview.recipeHash,
    toolName: AGENT_PREVIEW_RENDER_TOOL_NAME,
  });
};
