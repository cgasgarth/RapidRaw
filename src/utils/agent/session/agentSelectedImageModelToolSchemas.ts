import { z } from 'zod';

import { agentSelectedImageProposalLineageV1Schema } from '../../../schemas/agent/agentSelectedImageProposalIterationSchemas';

export const AGENT_SELECTED_IMAGE_MODEL_TOOL_LOOP_SCHEMA_VERSION = 1 as const;

export const agentSelectedImageModelPatchSchema = z
  .object({
    blacks: z.number().min(-100).max(100).optional(),
    clarity: z.number().min(-100).max(100).optional(),
    contrast: z.number().min(-100).max(100).optional(),
    exposure: z.number().min(-2).max(2).optional(),
    highlights: z.number().min(-100).max(100).optional(),
    saturation: z.number().min(-100).max(100).optional(),
    shadows: z.number().min(-100).max(100).optional(),
    whites: z.number().min(-100).max(100).optional(),
  })
  .strict()
  .refine((patch) => Object.keys(patch).length > 0, 'A proposal needs at least one adjustment.');

export const agentSelectedImageModelOutputSchema = z.discriminatedUnion('decision', [
  z
    .object({
      decision: z.literal('call_tool'),
      rationale: z.string().trim().max(2_048).optional(),
      tool: z
        .object({
          arguments: z.object({ patch: agentSelectedImageModelPatchSchema }).strict(),
          callId: z.string().trim().min(1).max(160),
          name: z.literal('proposal_render'),
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      decision: z.literal('finalize_proposal'),
      proposalId: z.string().trim().min(1),
      rationale: z.string().trim().max(2_048).optional(),
    })
    .strict(),
  z
    .object({
      decision: z.literal('clarification_required'),
      message: z.string().trim().min(1).max(2_048),
    })
    .strict(),
  z
    .object({
      decision: z.literal('stop'),
      reason: z.enum(['policy_refusal', 'unsupported_request', 'user_request']),
      message: z.string().trim().min(1).max(2_048),
    })
    .strict(),
]);

export const agentSelectedImageModelToolBudgetSchema = z
  .object({
    artifactTtlMs: z.number().int().min(5_000).max(300_000).default(60_000),
    maxAggregatePreviewBytes: z
      .number()
      .int()
      .positive()
      .max(32 * 1024 * 1024)
      .default(32 * 1024 * 1024),
    maxPreviewBytes: z
      .number()
      .int()
      .positive()
      .max(8 * 1024 * 1024)
      .default(8 * 1024 * 1024),
    maxTurns: z.number().int().min(2).max(6).default(4),
    modelTimeoutMs: z.number().int().min(1_000).max(120_000).default(45_000),
    toolTimeoutMs: z.number().int().min(1_000).max(60_000).default(20_000),
  })
  .strict();

export const agentSelectedImageModelToolLoopRequestSchema = z
  .object({
    budget: agentSelectedImageModelToolBudgetSchema.default({
      artifactTtlMs: 60_000,
      maxAggregatePreviewBytes: 32 * 1024 * 1024,
      maxPreviewBytes: 8 * 1024 * 1024,
      maxTurns: 4,
      modelTimeoutMs: 45_000,
      toolTimeoutMs: 20_000,
    }),
    deadlineAt: z.iso.datetime(),
    modelId: z.string().trim().min(1),
    operationId: z.string().trim().min(1),
    prompt: z.string().trim().min(1).max(16_384),
    requestId: z.string().trim().min(1),
    reasoningTier: z.enum(['none', 'minimal', 'low', 'light', 'medium', 'high', 'xhigh']).default('light'),
    schemaVersion: z.literal(AGENT_SELECTED_IMAGE_MODEL_TOOL_LOOP_SCHEMA_VERSION),
    sessionId: z.string().trim().min(1),
  })
  .strict();

export const agentSelectedImageModelToolLoopStateSchema = z.enum([
  'queued',
  'acquiring_context',
  'model_running',
  'tool_running',
  'proposal_ready',
  'approval_required',
  'clarification_required',
  'stale_recovery_required',
  'max_turns_reached',
  'cancelled',
  'timed_out',
  'failed',
  'busy',
]);

const digestSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/u);

export const agentSelectedImageModelToolAuditEventSchema = z
  .object({
    callId: z.string().trim().min(1).optional(),
    durationMs: z.number().int().nonnegative(),
    modelTurnId: z.string().trim().min(1).optional(),
    parentCallId: z.string().trim().min(1).optional(),
    proposalId: z.string().trim().min(1).optional(),
    receiptHash: digestSchema.optional(),
    requestDigest: digestSchema.optional(),
    responseDigest: digestSchema.optional(),
    state: agentSelectedImageModelToolLoopStateSchema,
    timestamp: z.iso.datetime(),
    toolName: z
      .enum(['rawengine.agent.tone_adjustment.dry_run', 'rawengine.agent.selected_image.proposal.render'])
      .optional(),
    turn: z.number().int().nonnegative(),
  })
  .strict();

export const agentSelectedImageModelToolLoopResultSchema = z
  .object({
    approval: z
      .object({
        adjustments: agentSelectedImageModelPatchSchema,
        dryRunPlanHash: z.string().trim().min(1),
        dryRunPlanId: z.string().trim().min(1),
        operationId: z.string().trim().min(1),
        sourceGraphRevision: z.string().trim().min(1),
      })
      .strict()
      .optional(),
    audit: z.array(agentSelectedImageModelToolAuditEventSchema),
    budget: z
      .object({
        maxToolCalls: z.number().int().positive(),
        previewBytes: z.number().int().nonnegative(),
        toolCalls: z.number().int().nonnegative(),
        turns: z.number().int().nonnegative(),
      })
      .strict(),
    model: z
      .object({
        id: z.string().trim().min(1),
        provider: z.string().trim().min(1),
        transport: z.literal('codex_app_server'),
        version: z.string().trim().min(1),
      })
      .strict(),
    proposalLineage: agentSelectedImageProposalLineageV1Schema,
    sealedProposalId: z.string().trim().min(1).optional(),
    sessionId: z.string().trim().min(1),
    state: agentSelectedImageModelToolLoopStateSchema,
    stopReason: z.string().trim().min(1).optional(),
  })
  .strict();

export type AgentSelectedImageModelOutput = z.infer<typeof agentSelectedImageModelOutputSchema>;
export type AgentSelectedImageModelToolLoopRequest = z.input<typeof agentSelectedImageModelToolLoopRequestSchema>;
export type AgentSelectedImageModelToolLoopResult = z.infer<typeof agentSelectedImageModelToolLoopResultSchema>;
