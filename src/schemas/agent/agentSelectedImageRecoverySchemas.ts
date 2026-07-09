import { z } from 'zod';

export const agentSelectedImageRecoveryStaleReasonSchema = z.enum([
  'graph_revision_changed',
  'image_changed',
  'preview_artifact_changed',
  'preview_dimensions_changed',
  'preview_identity_changed',
  'recipe_hash_changed',
]);

export const agentSelectedImageRecoveryReceiptSchema = z
  .object({
    blockedRequestId: z.string().trim().min(1),
    currentGraphRevision: z.string().trim().min(1),
    currentRecipeHash: z.string().trim().min(1),
    recoveredGraphRevision: z.string().trim().min(1),
    recoveredRecipeHash: z.string().trim().min(1),
    recoveryRequestId: z.string().trim().min(1),
    staleReason: agentSelectedImageRecoveryStaleReasonSchema,
    status: z.enum(['applied', 'blocked', 'dry_run_ready', 'rolled_back']),
  })
  .strict();

export const agentSelectedImageRollbackReadinessSchema = z
  .object({
    currentGraphRevision: z.string().trim().min(1).optional(),
    currentRecipeHash: z.string().trim().min(1).optional(),
    expectedGraphRevision: z.string().trim().min(1).optional(),
    expectedRecipeHash: z.string().trim().min(1).optional(),
    reason: z
      .enum([
        'already_rolled_back',
        'apply_not_verified',
        'checkpoint_mismatch',
        'missing_selection',
        'stale_graph_revision',
        'stale_recipe_hash',
        'stale_selection',
      ])
      .optional(),
    status: z.enum(['blocked', 'safe']),
  })
  .strict();

export type AgentSelectedImageRecoveryReceipt = z.infer<typeof agentSelectedImageRecoveryReceiptSchema>;
export type AgentSelectedImageRecoveryStaleReason = z.infer<typeof agentSelectedImageRecoveryStaleReasonSchema>;
export type AgentSelectedImageRollbackReadiness = z.infer<typeof agentSelectedImageRollbackReadinessSchema>;
