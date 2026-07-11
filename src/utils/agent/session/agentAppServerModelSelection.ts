import { z } from 'zod';

export const AGENT_EDITING_MODEL_ID = 'gpt-5.6-terra' as const;
export const AGENT_EDITING_REASONING_TIER = 'light' as const;

export const agentReasoningTierSchema = z.enum(['none', 'minimal', 'low', 'light', 'medium', 'high', 'xhigh']);

export const agentModelSelectionSchema = z
  .object({
    modelId: z.string().trim().min(1),
    reasoningTier: agentReasoningTierSchema,
  })
  .strict();

export const DEFAULT_AGENT_EDITING_MODEL_SELECTION = agentModelSelectionSchema.parse({
  modelId: AGENT_EDITING_MODEL_ID,
  reasoningTier: AGENT_EDITING_REASONING_TIER,
});

export const agentModelSelectionReceiptSchema = z
  .object({
    effective: agentModelSelectionSchema.nullable(),
    reason: z.string().trim().min(1).optional(),
    requested: agentModelSelectionSchema,
    status: z.enum(['exact', 'fallback', 'rejected']),
  })
  .strict()
  .superRefine((receipt, context) => {
    if (receipt.status === 'exact' && JSON.stringify(receipt.effective) !== JSON.stringify(receipt.requested)) {
      context.addIssue({ code: 'custom', message: 'Exact model selection must match the request.' });
    }
    if (receipt.status === 'fallback' && (receipt.effective === null || receipt.reason === undefined)) {
      context.addIssue({ code: 'custom', message: 'Model fallback requires an effective selection and reason.' });
    }
    if (receipt.status === 'rejected' && (receipt.effective !== null || receipt.reason === undefined)) {
      context.addIssue({ code: 'custom', message: 'Model rejection requires no effective selection and a reason.' });
    }
  });

export const agentAppServerTurnTransportRequestSchema = z
  .object({
    method: z.literal('turn/start'),
    params: z
      .object({
        effort: agentReasoningTierSchema,
        model: z.string().trim().min(1),
      })
      .strict(),
  })
  .strict();

export type AgentModelSelection = z.infer<typeof agentModelSelectionSchema>;
export type AgentModelSelectionReceipt = z.infer<typeof agentModelSelectionReceiptSchema>;
export type AgentAppServerTurnTransportRequest = z.infer<typeof agentAppServerTurnTransportRequestSchema>;

export const buildAgentAppServerTurnTransportRequest = (
  selection: AgentModelSelection,
): AgentAppServerTurnTransportRequest =>
  agentAppServerTurnTransportRequestSchema.parse({
    method: 'turn/start',
    params: { effort: selection.reasoningTier, model: selection.modelId },
  });
