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
export const agentFailureRecoveryActionStateSchema = z.enum(['available', 'completed']);
export const agentLongEditProgressStageStateSchema = z.enum(['completed', 'current', 'pending']);
export const agentE2eClosureStepStatusSchema = z.enum(['verified']);
export const agentSelectedImagePreviewLoopControlStateSchema = z.enum([
  'available',
  'disabled',
  'dispatched',
  'rejected',
  'unavailable',
]);
export const agentSelectedImagePreviewLoopBlockerSchema = z.enum([
  'missing_dry_run_approval',
  'missing_selected_image',
  'private_raw_proof_unavailable',
  'provider_unavailable',
  'rejected_command_result',
  'rollback_unavailable',
  'stale_graph_revision',
  'stale_recipe_hash',
]);

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

export const agentFailureRecoverySchema = z
  .object({
    editAction: z
      .object({
        id: z.string().min(1),
        label: z.string().min(1),
        state: agentFailureRecoveryActionStateSchema,
      })
      .strict(),
    failedToolCallId: z.string().min(1),
    id: z.string().min(1),
    preservedPlanId: z.string().min(1),
    reason: z.string().min(1),
    recoveredToolCallId: z.string().min(1),
    retryAction: z
      .object({
        id: z.string().min(1),
        label: z.string().min(1),
        state: agentFailureRecoveryActionStateSchema,
      })
      .strict(),
    title: z.string().min(1),
  })
  .strict();

export const agentLongEditProgressSchema = z
  .object({
    completedStageCount: z.number().int().nonnegative(),
    estimatedTotalMs: z.number().int().positive(),
    id: z.string().min(1),
    stages: z
      .array(
        z
          .object({
            durationMs: z.number().int().nonnegative(),
            id: z.string().min(1),
            label: z.string().min(1),
            state: agentLongEditProgressStageStateSchema,
            summary: z.string().min(1),
            toolCallId: z.string().min(1).optional(),
          })
          .strict(),
      )
      .min(5),
    title: z.string().min(1),
  })
  .strict();

export const agentE2eClosureSchema = z
  .object({
    id: z.string().min(1),
    proofHref: z.string().min(1),
    proofLabel: z.string().min(1),
    steps: z
      .array(
        z
          .object({
            id: z.string().min(1),
            label: z.string().min(1),
            status: agentE2eClosureStepStatusSchema,
            summary: z.string().min(1),
          })
          .strict(),
      )
      .min(7),
    title: z.string().min(1),
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
    replayGallery: z
      .array(
        z
          .object({
            artifactId: z.string().min(1),
            href: z.string().min(1),
            id: z.string().min(1),
            label: z.string().min(1),
            role: z.enum(['source', 'dry_run', 'output', 'rollback']),
            toolCallId: z.string().min(1),
          })
          .strict(),
      )
      .min(4),
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
    auditTrail: z
      .array(
        z
          .object({
            approvalState: agentChatApprovalStateSchema,
            artifactIds: z.array(z.string().min(1)),
            id: z.string().min(1),
            stage: agentChatToolCallModeSchema,
            toolCallId: z.string().min(1),
            toolName: z.string().min(1),
          })
          .strict(),
      )
      .min(1),
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
        restoreAction: z
          .object({
            buttonLabel: z.string().min(1),
            commandId: z.string().min(1),
            restoredLabel: z.string().min(1),
            toolName: z.string().min(1),
          })
          .strict(),
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

export const agentSelectedImagePreviewLoopReviewSchema = z
  .object({
    acceptedDryRunPlanCount: z.number().int().min(1),
    applyReceipts: z
      .array(
        z
          .object({
            acceptedPlanHash: z.string().min(1),
            acceptedPlanId: z.string().min(1),
            adjustedFields: z.array(z.string().min(1)).min(1),
            appliedGraphRevision: z.string().min(1),
            changedPixelCount: z.number().int().positive(),
            changedPixelPercent: z.number().min(0).max(100),
            maxChannelDelta: z.number().nonnegative(),
            meanLuminanceDelta: z.number().nonnegative(),
            sampledPixelCount: z.number().int().positive(),
            turn: z.number().int().positive(),
            undoGraphRevision: z.string().min(1),
          })
          .strict(),
      )
      .min(1),
    auditEventSummary: z
      .array(
        z
          .object({
            graphRevision: z.string().min(1),
            recipeHash: z.string().min(1),
            toolName: z.string().min(1),
            turn: z.number().int().positive(),
            type: z.string().min(1),
          })
          .strict(),
      )
      .min(1),
    blockers: z.array(agentSelectedImagePreviewLoopBlockerSchema),
    command: z
      .object({
        operationId: z.string().min(1),
        requestId: z.string().min(1),
        sessionId: z.string().min(1),
        toolName: z.literal('rawengine.agent.selected_image.preview_loop'),
      })
      .strict(),
    compareArtifacts: z
      .object({
        beforeArtifactId: z.string().min(1),
        currentArtifactId: z.string().min(1),
      })
      .strict(),
    controls: z
      .object({
        acceptApply: z
          .object({
            commandRequest: z.unknown().optional(),
            label: z.string().min(1),
            reason: z.string().min(1),
            state: agentSelectedImagePreviewLoopControlStateSchema,
          })
          .strict(),
        reviseWithFeedback: z
          .object({
            commandRequest: z.unknown().optional(),
            feedback: z.string().min(1),
            label: z.string().min(1),
            reason: z.string().min(1),
            state: agentSelectedImagePreviewLoopControlStateSchema,
          })
          .strict(),
        rollback: z
          .object({
            commandRequest: z.unknown().optional(),
            label: z.string().min(1),
            reason: z.string().min(1),
            state: agentSelectedImagePreviewLoopControlStateSchema,
            toolName: z.literal('rawengine.agent.history.rollback'),
          })
          .strict(),
      })
      .strict(),
    editCount: z.number().int().min(1),
    finalGraphRevision: z.string().min(1),
    finalRecipeHash: z.string().min(1),
    id: z.string().min(1),
    initialGraphRevision: z.string().min(1),
    initialPreviewArtifactId: z.string().min(1),
    initialRecipeHash: z.string().min(1),
    previewIdentity: z.string().min(1).nullable(),
    previewLineage: z
      .array(
        z
          .object({
            appliedGraphRevision: z.string().min(1),
            previewArtifactId: z.string().min(1),
            previewPurpose: z.enum(['detail_review', 'refresh']),
            recipeHash: z.string().min(1),
            sourceToolName: z.literal('rawengine.agent.adjustments.apply'),
            turn: z.number().int().positive(),
          })
          .strict(),
      )
      .min(1),
    previewRefreshCount: z.number().int().min(1),
    prompt: z.string().min(1),
    reviewStatus: z.enum(['max_iterations_reached', 'needs_user_review']),
    rollbackCheckpoint: z
      .object({
        graphRevision: z.string().min(1),
        previewRecipeHash: z.string().min(1),
        sessionId: z.string().min(1),
      })
      .strict(),
    rollbackReceipt: z
      .object({
        graphRevision: z.string().min(1),
        previewRecipeHash: z.string().min(1),
        requestId: z.string().min(1),
        restoredHistoryIndex: z.number().int().nonnegative(),
        scope: z.enum(['operation', 'session_start']),
        sessionId: z.string().min(1),
        toolName: z.literal('rawengine.agent.history.rollback'),
      })
      .strict()
      .optional(),
    selectedImage: z
      .object({
        height: z.number().int().positive(),
        path: z.string().min(1),
        previewIdentity: z.string().min(1).nullable(),
        width: z.number().int().positive(),
      })
      .strict(),
    status: z.enum(['max_iterations_reached', 'needs_user_review']),
    title: z.string().min(1),
    warnings: z.array(z.string().min(1)),
  })
  .strict();

export const agentInitialPromptPreviewContextSchema = z
  .object({
    accessScope: z.literal('local_private'),
    artifactId: z.string().min(1),
    colorProfile: z.literal('srgb-preview'),
    encodedFormat: z.literal('jpeg'),
    graphRevision: z.string().min(1),
    height: z.number().int().positive(),
    includesOriginalRaw: z.literal(false),
    longEdgePx: z.literal(1536),
    mediaType: z.literal('image/jpeg'),
    previewRef: z.string().min(1),
    purpose: z.literal('initial_context'),
    quality: z.literal(0.86),
    recipeHash: z.string().min(1),
    renderHash: z.string().min(1),
    transport: z.literal('codex_app_server'),
    width: z.number().int().positive(),
  })
  .strict();

export const agentChatTranscriptSchema = z
  .object({
    artifactReview: agentArtifactReviewSchema.optional(),
    auditTranscript: agentAuditTranscriptSchema.optional(),
    dryRunReview: agentChatDryRunReviewSchema.optional(),
    e2eClosure: agentE2eClosureSchema.optional(),
    failureRecovery: agentFailureRecoverySchema.optional(),
    id: z.string().min(1),
    initialPromptPreviewContext: agentInitialPromptPreviewContextSchema.optional(),
    livePromptWalkthrough: agentLivePromptWalkthroughSchema.optional(),
    longEditProgress: agentLongEditProgressSchema.optional(),
    messages: z.array(agentChatMessageSchema).min(1),
    privateRawArtifacts: agentPrivateRawArtifactsSchema.optional(),
    reviewHandoff: agentReviewHandoffSchema.optional(),
    runtimeStatus: agentChatRuntimeStatusSchema,
    selectedFrameScope: agentSelectedFrameScopeSchema.optional(),
    selectedImagePreviewLoopReview: agentSelectedImagePreviewLoopReviewSchema.optional(),
    sessionTitle: z.string().min(1),
    toolCalls: z.array(agentChatToolCallSchema).min(1),
  })
  .strict();

export type AgentChatMessage = z.infer<typeof agentChatMessageSchema>;
export type AgentArtifactReview = z.infer<typeof agentArtifactReviewSchema>;
export type AgentAuditTranscript = z.infer<typeof agentAuditTranscriptSchema>;
export type AgentChatToolCall = z.infer<typeof agentChatToolCallSchema>;
export type AgentInitialPromptPreviewContext = z.infer<typeof agentInitialPromptPreviewContextSchema>;
export type AgentChatDryRunReview = z.infer<typeof agentChatDryRunReviewSchema>;
export type AgentE2eClosure = z.infer<typeof agentE2eClosureSchema>;
export type AgentFailureRecovery = z.infer<typeof agentFailureRecoverySchema>;
export type AgentLivePromptWalkthrough = z.infer<typeof agentLivePromptWalkthroughSchema>;
export type AgentLongEditProgress = z.infer<typeof agentLongEditProgressSchema>;
export type AgentPrivateRawArtifacts = z.infer<typeof agentPrivateRawArtifactsSchema>;
export type AgentReviewHandoff = z.infer<typeof agentReviewHandoffSchema>;
export type AgentSelectedFrameScope = z.infer<typeof agentSelectedFrameScopeSchema>;
export type AgentSelectedImagePreviewLoopReview = z.infer<typeof agentSelectedImagePreviewLoopReviewSchema>;
export type AgentChatTranscript = z.infer<typeof agentChatTranscriptSchema>;
