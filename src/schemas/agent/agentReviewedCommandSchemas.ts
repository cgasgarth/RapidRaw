import { z } from 'zod';

export const agentReviewedAdjustmentCommandIdSchema = z.enum([
  'gentle_exposure_lift',
  'highlight_recovery',
  'natural_contrast',
  'shadow_lift',
]);

export const agentReviewedAdjustmentCommandIntensitySchema = z.enum(['low', 'medium', 'high']);

export const agentReviewedAdjustmentCommandDiffSchema = z
  .object({
    after: z.number(),
    before: z.number(),
    delta: z.number(),
    key: z.string().trim().min(1),
  })
  .strict();

export const agentReviewedAdjustmentCommandReceiptSchema = z
  .object({
    adjustmentDiffs: z.array(agentReviewedAdjustmentCommandDiffSchema).min(1),
    commandId: agentReviewedAdjustmentCommandIdSchema,
    intensity: agentReviewedAdjustmentCommandIntensitySchema,
    label: z.string().trim().min(1),
    sourceAdjustmentSnapshot: z.record(z.string().trim().min(1), z.number()),
  })
  .strict();

export type AgentReviewedAdjustmentCommandId = z.infer<typeof agentReviewedAdjustmentCommandIdSchema>;
export type AgentReviewedAdjustmentCommandIntensity = z.infer<typeof agentReviewedAdjustmentCommandIntensitySchema>;
export type AgentReviewedAdjustmentCommandDiff = z.infer<typeof agentReviewedAdjustmentCommandDiffSchema>;
export type AgentReviewedAdjustmentCommandReceipt = z.infer<typeof agentReviewedAdjustmentCommandReceiptSchema>;
