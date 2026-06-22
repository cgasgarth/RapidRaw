import { z } from 'zod';

export const agentChatMessageRoleSchema = z.enum(['assistant', 'system', 'user']);
export const agentChatToolCallModeSchema = z.enum(['apply', 'dry_run', 'read']);
export const agentChatToolCallStatusSchema = z.enum(['blocked', 'failed', 'queued', 'running', 'succeeded', 'warning']);
export const agentChatApprovalStateSchema = z.enum(['approved', 'not_required', 'rejected', 'required']);
export const agentChatReviewActionStateSchema = z.enum(['available', 'disabled', 'rejected', 'unavailable']);
export const agentArtifactReviewStatusSchema = z.enum(['audit_only', 'ready', 'review_required']);
export const agentAuditTranscriptOutcomeSchema = z.enum(['blocked', 'success', 'warning']);
export const agentReviewHandoffRollbackStatusSchema = z.enum(['available', 'blocked', 'not_required']);
export const agentReviewHandoffOutputStatusSchema = z.enum(['review_artifact_ready', 'runtime_apply_verified']);
export const agentSelectedFrameScopePolicyStateSchema = z.enum(['passed', 'review_required']);
export const agentAuditEvidenceTierSchema = z.enum([
  'ui_only',
  'schema_only',
  'dry_run_only',
  'runtime_apply',
  'runtime_apply_demo',
  'e2e_verified',
]);
export const agentChatRuntimeStatusSchema = z.enum(['ui_only_demo', 'runtime_apply_demo']);
export const agentLivePromptWalkthroughStageStateSchema = z.enum(['completed', 'current', 'pending']);

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

export const agentLivePromptWalkthroughSchema = z
  .object({
    approval: z
      .object({
        label: z.string().min(1),
        state: agentChatApprovalStateSchema,
        summary: z.string().min(1),
      })
      .strict(),
    id: z.string().min(1),
    planSummary: z.string().min(1),
    prompt: z.string().min(1),
    stages: z
      .array(
        z
          .object({
            id: z.string().min(1),
            label: z.string().min(1),
            state: agentLivePromptWalkthroughStageStateSchema,
            summary: z.string().min(1),
            toolCallId: z.string().min(1).optional(),
          })
          .strict(),
      )
      .min(3),
    targetLabel: z.string().min(1),
  })
  .strict();

export const agentArtifactReviewSchema = z
  .object({
    auditEntries: z
      .array(
        z
          .object({
            artifactId: z.string().min(1),
            id: z.string().min(1),
            replayLink: z.string().min(1),
            stage: z.enum(['apply_blocked', 'dry_run', 'preview']),
            summary: z.string().min(1),
            toolCallId: z.string().min(1),
          })
          .strict(),
      )
      .min(1),
    beforeAfter: z
      .object({
        afterLabel: z.string().min(1),
        afterRevision: z.string().min(1),
        beforeLabel: z.string().min(1),
        beforeRevision: z.string().min(1),
      })
      .strict(),
    previewArtifacts: z
      .array(
        z
          .object({
            contentHash: z.string().regex(/^sha256:[a-f0-9]{16,64}$/u),
            id: z.string().min(1),
            kind: z.enum(['clipping_map', 'edit_preview', 'mask_preview']),
            source: z.enum(['auditLog.affectedArtifactIds', 'output.maskArtifacts', 'output.previewArtifacts']),
            status: agentArtifactReviewStatusSchema,
            title: z.string().min(1),
            toolCallId: z.string().min(1),
          })
          .strict(),
      )
      .min(1),
  })
  .strict();

export const agentAuditTranscriptSchema = z
  .object({
    evidenceTier: agentAuditEvidenceTierSchema,
    finalRevision: z.string().min(1),
    initialRevision: z.string().min(1),
    records: z
      .array(
        z
          .object({
            artifactLinks: z.array(
              z
                .object({
                  href: z.string().min(1),
                  id: z.string().min(1),
                  label: z.string().min(1),
                })
                .strict(),
            ),
            id: z.string().min(1),
            outcome: agentAuditTranscriptOutcomeSchema,
            requestHash: z.string().regex(/^sha256:[a-f0-9]{16,64}$/u),
            schema: z.string().min(1),
            stage: agentChatToolCallModeSchema,
            summary: z.string().min(1),
            timestamp: z.string().min(1),
            title: z.string().min(1),
            toolCallId: z.string().min(1),
            toolName: z.string().min(1),
            warnings: z.array(z.string().min(1)),
          })
          .strict(),
      )
      .min(1),
    replayRoot: z.string().min(1),
    schemaVersion: z.literal(1),
    targetLabel: z.string().min(1),
  })
  .strict();

export const agentReviewHandoffSchema = z
  .object({
    afterArtifactId: z.string().min(1),
    afterLabel: z.string().min(1),
    approvalLabel: z.string().min(1),
    approvalState: agentChatApprovalStateSchema,
    auditArtifactId: z.string().min(1),
    auditLabel: z.string().min(1),
    beforeArtifactId: z.string().min(1),
    beforeLabel: z.string().min(1),
    commandSummary: z.string().min(1),
    id: z.string().min(1),
    nextAction: z.string().min(1),
    outputProof: z
      .object({
        contentHash: z.string().regex(/^sha256:[a-f0-9]{16,64}$/u),
        href: z.string().min(1),
        label: z.string().min(1),
        status: agentReviewHandoffOutputStatusSchema,
      })
      .strict(),
    rollback: z
      .object({
        label: z.string().min(1),
        status: agentReviewHandoffRollbackStatusSchema,
        summary: z.string().min(1),
        targetRevision: z.string().min(1),
      })
      .strict(),
    title: z.string().min(1),
  })
  .strict();

export const agentSelectedFrameScopeSchema = z
  .object({
    approvalLabel: z.string().min(1),
    approvalState: agentChatApprovalStateSchema,
    auditArtifactId: z.string().min(1),
    dryRunToolCallId: z.string().min(1),
    excludedAssets: z
      .array(
        z
          .object({
            id: z.string().min(1),
            label: z.string().min(1),
            reason: z.string().min(1),
            value: z.string().min(1),
          })
          .strict(),
      )
      .min(1),
    id: z.string().min(1),
    noOverwriteTarget: z
      .object({
        label: z.string().min(1),
        summary: z.string().min(1),
        value: z.string().min(1),
      })
      .strict(),
    policyChecks: z
      .array(
        z
          .object({
            id: z.string().min(1),
            label: z.string().min(1),
            state: agentSelectedFrameScopePolicyStateSchema,
          })
          .strict(),
      )
      .min(1),
    proofHref: z.string().min(1),
    proofLabel: z.string().min(1),
    selectedAssets: z
      .array(
        z
          .object({
            id: z.string().min(1),
            label: z.string().min(1),
            role: z.string().min(1),
            stateLabel: z.string().min(1),
            value: z.string().min(1),
          })
          .strict(),
      )
      .min(1),
    summary: z.string().min(1),
    title: z.string().min(1),
  })
  .strict();

export const agentPrivateRawArtifactsSchema = z
  .object({
    artifactCount: z.number().int().positive(),
    fixtureId: z.string().min(1),
    issue: z.number().int().positive(),
    reportPath: z.string().min(1),
    sourceHashUnchanged: z.literal(true),
    status: z.literal('partial_agent_apply_plus_private_raw_artifacts'),
    title: z.string().min(1),
    validationMode: z.literal('agent_app_server_bridge_plus_private_raw_artifact_proof'),
    workflowReportPath: z.string().min(1),
  })
  .strict();

export const agentChatTranscriptSchema = z
  .object({
    artifactReview: agentArtifactReviewSchema.optional(),
    auditTranscript: agentAuditTranscriptSchema.optional(),
    dryRunReview: agentChatDryRunReviewSchema.optional(),
    id: z.string().min(1),
    livePromptWalkthrough: agentLivePromptWalkthroughSchema.optional(),
    messages: z.array(agentChatMessageSchema).min(1),
    privateRawArtifacts: agentPrivateRawArtifactsSchema.optional(),
    reviewHandoff: agentReviewHandoffSchema.optional(),
    runtimeStatus: agentChatRuntimeStatusSchema,
    selectedFrameScope: agentSelectedFrameScopeSchema.optional(),
    sessionTitle: z.string().min(1),
    toolCalls: z.array(agentChatToolCallSchema).min(1),
  })
  .strict();

export type AgentChatMessage = z.infer<typeof agentChatMessageSchema>;
export type AgentArtifactReview = z.infer<typeof agentArtifactReviewSchema>;
export type AgentAuditTranscript = z.infer<typeof agentAuditTranscriptSchema>;
export type AgentChatToolCall = z.infer<typeof agentChatToolCallSchema>;
export type AgentChatDryRunReview = z.infer<typeof agentChatDryRunReviewSchema>;
export type AgentLivePromptWalkthrough = z.infer<typeof agentLivePromptWalkthroughSchema>;
export type AgentPrivateRawArtifacts = z.infer<typeof agentPrivateRawArtifactsSchema>;
export type AgentReviewHandoff = z.infer<typeof agentReviewHandoffSchema>;
export type AgentSelectedFrameScope = z.infer<typeof agentSelectedFrameScopeSchema>;
export type AgentChatTranscript = z.infer<typeof agentChatTranscriptSchema>;
