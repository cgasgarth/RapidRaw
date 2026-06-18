import { z } from 'zod';

export const agentChatMessageRoleSchema = z.enum(['assistant', 'system', 'user']);
export const agentChatToolCallModeSchema = z.enum(['apply', 'dry_run', 'read']);
export const agentChatToolCallStatusSchema = z.enum(['blocked', 'failed', 'queued', 'running', 'succeeded', 'warning']);
export const agentChatApprovalStateSchema = z.enum(['approved', 'not_required', 'rejected', 'required']);
export const agentChatReviewActionStateSchema = z.enum(['available', 'disabled', 'rejected', 'unavailable']);

export const agentChatMessageSchema = z
  .object({
    body: z.string().min(1),
    id: z.string().min(1),
    role: agentChatMessageRoleSchema,
    timestamp: z.string().min(1),
  })
  .strict();

export const agentChatToolCallSchema = z
  .object({
    approvalState: agentChatApprovalStateSchema,
    durationMs: z.number().int().nonnegative().optional(),
    id: z.string().min(1),
    mode: agentChatToolCallModeSchema,
    provenance: z
      .object({
        requestHash: z.string().regex(/^sha256:[a-f0-9]{16,64}$/u),
        runtime: z.literal('codex_app_server'),
        schema: z.string().min(1),
        sourceAssetHash: z
          .string()
          .regex(/^sha256:[a-f0-9]{16,64}$/u)
          .optional(),
      })
      .strict(),
    status: agentChatToolCallStatusSchema,
    summary: z.string().min(1),
    timestamp: z.string().min(1),
    title: z.string().min(1),
    toolName: z.string().min(1),
    warning: z.string().min(1).optional(),
  })
  .strict();

export const agentChatDryRunReviewSchema = z
  .object({
    actions: z
      .array(
        z
          .object({
            id: z.string().min(1),
            label: z.string().min(1),
            reason: z.string().min(1),
            state: agentChatReviewActionStateSchema,
          })
          .strict(),
      )
      .min(1),
    affectedTargets: z
      .array(
        z
          .object({
            id: z.string().min(1),
            label: z.string().min(1),
            value: z.string().min(1),
          })
          .strict(),
      )
      .min(1),
    parameterDiffs: z
      .array(
        z
          .object({
            id: z.string().min(1),
            after: z.string().min(1),
            before: z.string().min(1),
            label: z.string().min(1),
          })
          .strict(),
      )
      .min(1),
    warnings: z.array(z.string().min(1)).min(1),
  })
  .strict();

export const agentChatTranscriptSchema = z
  .object({
    dryRunReview: agentChatDryRunReviewSchema.optional(),
    id: z.string().min(1),
    messages: z.array(agentChatMessageSchema).min(1),
    runtimeStatus: z.literal('ui_only_demo'),
    sessionTitle: z.string().min(1),
    toolCalls: z.array(agentChatToolCallSchema).min(1),
  })
  .strict();

export type AgentChatMessage = z.infer<typeof agentChatMessageSchema>;
export type AgentChatToolCall = z.infer<typeof agentChatToolCallSchema>;
export type AgentChatDryRunReview = z.infer<typeof agentChatDryRunReviewSchema>;
export type AgentChatTranscript = z.infer<typeof agentChatTranscriptSchema>;
