import { z } from 'zod';

const sha256Schema = z.string().regex(/^sha256:[a-f0-9]{64}$/u);
const identitySchema = z.string().trim().min(1);

const phaseBaseSchema = z.object({ hash: sha256Schema }).strict();

export const agentSelectedImageLifecycleProposalSchema = phaseBaseSchema
  .extend({
    afterArtifactHash: sha256Schema,
    beforeArtifactHash: sha256Schema,
    editGraph: z.record(z.string(), z.unknown()),
    graphRevision: identitySchema,
    lineage: z
      .object({
        epoch: z.number().int().nonnegative(),
        iterationId: identitySchema,
        lineageId: identitySchema,
        ordinal: z.number().int().positive(),
        proposalHash: sha256Schema,
        proposalId: identitySchema,
        state: z.literal('sealed'),
      })
      .strict(),
    proposalHash: sha256Schema,
    proposalId: identitySchema,
    receiptHash: sha256Schema,
    recipeHash: identitySchema,
    renderSpecHash: sha256Schema,
    selectedImageId: sha256Schema,
  })
  .strict();

export const agentSelectedImageLifecycleApprovalSchema = phaseBaseSchema
  .extend({
    actor: identitySchema,
    approvalId: identitySchema,
    approvedAt: z.string().datetime(),
    policyVersion: identitySchema,
    proposalHash: sha256Schema,
    proposalId: identitySchema,
    receiptHash: sha256Schema,
    source: z.enum(['user', 'policy']),
  })
  .strict();

const paritySchema = z
  .object({
    mode: z.enum(['byte_exact', 'decoded_pixel']),
    result: z.enum(['passed', 'failed']),
    threshold: z.number().nonnegative(),
  })
  .strict();

export const agentSelectedImageLifecycleCommitSchema = phaseBaseSchema
  .extend({
    afterGraphHash: sha256Schema,
    afterPreviewHash: sha256Schema,
    afterRecipeHash: sha256Schema,
    beforeGraphHash: sha256Schema,
    beforePreviewHash: sha256Schema,
    beforeRecipeHash: sha256Schema,
    history: z
      .object({
        afterDepth: z.number().int().nonnegative(),
        beforeDepth: z.number().int().nonnegative(),
        transactionId: identitySchema,
      })
      .strict(),
    parity: paritySchema,
    status: z.enum(['applied', 'compensated', 'failed_needs_recovery']),
    toolCalls: z.array(z.object({ id: identitySchema, name: identitySchema }).strict()).min(1),
    transactionId: identitySchema,
  })
  .strict();

export const agentSelectedImageLifecycleRevertSchema = phaseBaseSchema
  .extend({
    checkpointHash: sha256Schema,
    lineage: z
      .object({
        epoch: z.number().int().nonnegative(),
        iterationId: identitySchema,
        lineageId: identitySchema,
        proposalHash: sha256Schema,
        proposalId: identitySchema,
        state: z.literal('reverted'),
      })
      .strict(),
    parity: paritySchema,
    restoredGraphHash: sha256Schema,
    restoredHistoryHash: sha256Schema,
    restoredPreviewHash: sha256Schema,
    restoredRecipeHash: sha256Schema,
    status: z.enum(['reverted', 'failed_needs_recovery']),
    transactionId: identitySchema,
  })
  .strict();

export const agentSelectedImageLifecycleFailureSchema = phaseBaseSchema
  .extend({
    cleanupResult: z.enum(['complete', 'failed', 'not_required']),
    compensationResult: z.enum(['passed', 'failed', 'not_attempted']),
    failureStage: identitySchema,
    mutationStarted: z.boolean(),
    recoveryRequired: z.boolean(),
  })
  .strict();

export const agentSelectedImageLifecycleReceiptV2Schema = z
  .object({
    approval: agentSelectedImageLifecycleApprovalSchema,
    commit: agentSelectedImageLifecycleCommitSchema.optional(),
    createdAt: z.string().datetime(),
    failure: agentSelectedImageLifecycleFailureSchema.optional(),
    hash: sha256Schema,
    proposal: agentSelectedImageLifecycleProposalSchema,
    revert: agentSelectedImageLifecycleRevertSchema.optional(),
    schemaVersion: z.literal(2),
    sessionId: identitySchema,
  })
  .strict();

export type AgentSelectedImageLifecycleReceiptV2 = z.infer<typeof agentSelectedImageLifecycleReceiptV2Schema>;

const canonicalize = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, entry]) => entry !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, canonicalize(entry)]),
    );
  }
  return value;
};

export const canonicalizeAgentSelectedImageLifecycleValue = (value: unknown): string =>
  JSON.stringify(canonicalize(value));

export const hashAgentSelectedImageLifecycleValue = async (domain: string, value: unknown): Promise<string> => {
  const bytes = new TextEncoder().encode(
    `rapidraw.agent.selected-image.lifecycle.v2\0${domain}\0${canonicalizeAgentSelectedImageLifecycleValue(value)}`,
  );
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return `sha256:${Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')}`;
};

export const sealAgentSelectedImageLifecyclePhase = async <T extends Record<string, unknown>>(
  domain: string,
  phase: T,
): Promise<T & { hash: string }> => ({ ...phase, hash: await hashAgentSelectedImageLifecycleValue(domain, phase) });

export const verifyAgentSelectedImageLifecycleReceipt = async (
  receipt: AgentSelectedImageLifecycleReceiptV2,
): Promise<boolean> => {
  const phases = ['proposal', 'approval', 'commit', 'revert', 'failure'] as const;
  for (const phase of phases) {
    const value = receipt[phase];
    if (
      value !== undefined &&
      value.hash !== (await hashAgentSelectedImageLifecycleValue(phase, { ...value, hash: undefined }))
    )
      return false;
  }
  return receipt.hash === (await hashAgentSelectedImageLifecycleValue('receipt', { ...receipt, hash: undefined }));
};

export const upgradeAgentSelectedImageLiveSessionReceiptV1 = (legacyReceipt: unknown) => ({
  legacyReceipt,
  proof: 'legacy_unverified' as const,
  schemaVersion: 1 as const,
});
