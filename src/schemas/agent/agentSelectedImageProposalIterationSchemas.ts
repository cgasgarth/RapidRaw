import { z } from 'zod';

export const agentSelectedImageProposalIterationStateV1Schema = z.enum([
  'draft',
  'rendering',
  'ready',
  'sealed',
  'superseded',
  'stale',
  'cancelled',
  'applied',
  'reverted',
  'failed',
]);

const sha256Schema = z.string().regex(/^sha256:[a-f0-9]{64}$/u);

export const agentSelectedImageProposalIterationV1Schema = z
  .object({
    afterPreviewArtifactId: z.string().trim().min(1).optional(),
    afterPreviewContentHash: sha256Schema.optional(),
    baseGraphRevision: z.string().trim().min(1),
    basePreviewArtifactId: z.string().trim().min(1),
    basePreviewContentHash: sha256Schema,
    baseRecipeHash: z.string().trim().min(1),
    beforePreviewArtifactId: z.string().trim().min(1),
    beforePreviewContentHash: sha256Schema,
    cleanupStatus: z.enum(['not_required', 'pending', 'released', 'retained_for_apply']),
    createdAt: z.iso.datetime(),
    expiresAt: z.iso.datetime(),
    initiatingTurnId: z.string().trim().min(1),
    iterationId: z.string().trim().min(1),
    lineageId: z.string().trim().min(1),
    ordinal: z.number().int().min(1).max(6),
    parentIterationId: z.string().trim().min(1).optional(),
    parentProposalId: z.string().trim().min(1).optional(),
    proposalHash: sha256Schema,
    proposalId: z.string().trim().min(1),
    proposalSchemaVersion: z.number().int().positive(),
    recoveredFromIterationId: z.string().trim().min(1).optional(),
    schemaVersion: z.literal(1),
    selectedImageId: sha256Schema,
    sessionId: z.string().trim().min(1),
    state: agentSelectedImageProposalIterationStateV1Schema,
    terminalReason: z.string().trim().min(1).optional(),
    toolCalls: z
      .array(
        z
          .object({
            callId: z.string().trim().min(1),
            parentCallId: z.string().trim().min(1).optional(),
            type: z.enum(['preview_acquire', 'proposal_render', 'approval', 'apply', 'revert', 'cleanup']),
          })
          .strict(),
      )
      .min(1),
  })
  .strict()
  .superRefine((iteration, context) => {
    if ((iteration.parentIterationId === undefined) !== (iteration.parentProposalId === undefined)) {
      context.addIssue({ code: 'custom', message: 'Proposal parents require both iteration and proposal ids.' });
    }
    if (iteration.beforePreviewArtifactId !== iteration.basePreviewArtifactId) {
      context.addIssue({ code: 'custom', message: 'Before preview artifact must equal the bound base artifact.' });
    }
    if (iteration.beforePreviewContentHash !== iteration.basePreviewContentHash) {
      context.addIssue({ code: 'custom', message: 'Before preview hash must equal the bound base preview hash.' });
    }
    if (Date.parse(iteration.expiresAt) <= Date.parse(iteration.createdAt)) {
      context.addIssue({ code: 'custom', message: 'Proposal expiry must be after creation.' });
    }
  });

export const agentSelectedImageProposalLineageV1Schema = z
  .object({
    epoch: z.number().int().nonnegative(),
    iterations: z.array(agentSelectedImageProposalIterationV1Schema).max(6),
    lineageId: z.string().trim().min(1),
    schemaVersion: z.literal(1),
    sealedIterationId: z.string().trim().min(1).optional(),
    sessionId: z.string().trim().min(1),
  })
  .strict();

export type AgentSelectedImageProposalIterationV1 = z.infer<typeof agentSelectedImageProposalIterationV1Schema>;
export type AgentSelectedImageProposalLineageV1 = z.infer<typeof agentSelectedImageProposalLineageV1Schema>;
export type AgentSelectedImageProposalIterationStateV1 = z.infer<
  typeof agentSelectedImageProposalIterationStateV1Schema
>;
