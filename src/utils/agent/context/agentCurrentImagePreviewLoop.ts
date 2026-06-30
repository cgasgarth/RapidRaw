import { z } from 'zod';
import { agentHistoryRollbackResponseSchema } from '../session/agentSessionHistory';
import { buildAgentImageContextSnapshot } from './agentImageContextSnapshot';

export const AGENT_CURRENT_IMAGE_PREVIEW_LOOP_TOOL_NAME = 'rawengine.agent.selected_image.preview_loop';
export const AGENT_CURRENT_IMAGE_PREVIEW_LOOP_INPUT_SCHEMA_NAME = 'AgentCurrentImagePreviewLoopRequestV1';
export const AGENT_CURRENT_IMAGE_PREVIEW_LOOP_OUTPUT_SCHEMA_NAME = 'AgentCurrentImagePreviewLoopResponseV1';

const agentLoopAdjustmentPatchSchema = z
  .object({
    exposure: z.number().min(-2).max(2).optional(),
    highlights: z.number().min(-100).max(100).optional(),
    shadows: z.number().min(-100).max(100).optional(),
  })
  .strict()
  .refine((patch) => Object.keys(patch).length > 0, { message: 'Loop step requires at least one adjustment.' });

const agentLoopPreviewRequestSchema = z
  .object({
    crop: z
      .object({
        height: z.number().positive().max(1),
        width: z.number().positive().max(1),
        x: z.number().min(0).max(1),
        y: z.number().min(0).max(1),
      })
      .strict()
      .optional(),
    longEdgePx: z.number().int().min(256).max(2048).optional(),
    maxPixelCount: z.number().int().min(65_536).max(4_194_304).optional(),
    purpose: z.enum(['detail_review', 'refresh']).optional(),
    quality: z.number().min(0.5).max(0.95).optional(),
    zoom: z
      .object({
        centerX: z.number().min(0).max(1),
        centerY: z.number().min(0).max(1),
        scale: z.number().min(1).max(8),
      })
      .strict()
      .optional(),
  })
  .strict();

const agentLoopStepSchema = agentLoopAdjustmentPatchSchema.safeExtend({
  assistantRationale: z.string().trim().min(1).optional(),
  preview: agentLoopPreviewRequestSchema.optional(),
  userFollowUp: z.string().trim().min(1).optional(),
});

const agentLoopDryRunApprovalSchema = z
  .object({
    acceptedPlanHash: z.string().trim().min(1),
    acceptedPlanId: z.string().trim().min(1),
    approvalState: z.literal('approved'),
    expectedGraphRevision: z.string().trim().min(1),
    turn: z.number().int().min(2),
  })
  .strict();

export const agentCurrentImagePreviewLoopRequestSchema = z
  .object({
    dryRunApprovals: z.array(agentLoopDryRunApprovalSchema).min(1),
    expectedGraphRevision: z.string().trim().min(1),
    expectedPreviewHeight: z.number().int().positive(),
    expectedPreviewIdentity: z.string().trim().min(1).nullable(),
    expectedPreviewWidth: z.number().int().positive(),
    expectedRecipeHash: z.string().trim().min(1),
    maxIterations: z.number().int().min(2).max(6).default(4),
    operationId: z.string().trim().min(1),
    prompt: z.string().trim().min(1),
    requestId: z.string().trim().min(1),
    rollbackAfterReview: z.boolean().default(false),
    selectedImagePath: z.string().trim().min(1),
    sessionId: z.string().trim().min(1),
    steps: z.array(agentLoopStepSchema).min(2).max(6),
  })
  .strict();

const applyReceiptSchema = z
  .object({
    acceptedPlanHash: z.string().trim().min(1),
    acceptedPlanId: z.string().trim().min(1),
    adjustedFields: z.array(z.string().trim().min(1)).min(1),
    appliedGraphRevision: z.string().trim().min(1),
    changedPixelCount: z.number().int().positive(),
    changedPixelPercent: z.number().min(0).max(100),
    maxChannelDelta: z.number().nonnegative(),
    meanLuminanceDelta: z.number().nonnegative(),
    requestId: z.string().trim().min(1),
    sampledPixelCount: z.number().int().positive(),
    turn: z.number().int().positive(),
    undoGraphRevision: z.string().trim().min(1),
  })
  .strict();

const previewLineageSchema = z
  .object({
    appliedGraphRevision: z.string().trim().min(1),
    previewArtifactId: z.string().trim().min(1),
    previewPurpose: z.enum(['detail_review', 'refresh']),
    recipeHash: z.string().trim().min(1),
    sourceToolName: z.literal('rawengine.agent.adjustments.apply'),
    turn: z.number().int().positive(),
  })
  .strict();

const rollbackCheckpointSchema = z
  .object({
    graphRevision: z.string().trim().min(1),
    previewRecipeHash: z.string().trim().min(1),
    sessionId: z.string().trim().min(1),
  })
  .strict();

export const agentCurrentImagePreviewLoopResultSchema = z
  .object({
    acceptedDryRunPlanCount: z.number().int().min(1),
    applyReceipts: z.array(applyReceiptSchema).min(1),
    auditEventSummary: z
      .array(
        z
          .object({
            graphRevision: z.string().trim().min(1),
            recipeHash: z.string().trim().min(1),
            toolName: z.string().trim().min(1),
            turn: z.number().int().positive(),
            type: z.string().trim().min(1),
          })
          .strict(),
      )
      .min(5),
    compareArtifactIds: z
      .object({
        beforeArtifactId: z.string().trim().min(1),
        currentArtifactId: z.string().trim().min(1),
      })
      .strict(),
    editCount: z.number().int().min(1),
    finalGraphRevision: z.string().trim().min(1),
    finalRecipeHash: z.string().trim().min(1),
    initialGraphRevision: z.string().trim().min(1),
    initialPreviewArtifactId: z.string().trim().min(1),
    initialRecipeHash: z.string().trim().min(1),
    previewIdentity: z.string().trim().min(1).nullable(),
    previewLineage: z.array(previewLineageSchema).min(1),
    previewRefreshCount: z.number().int().min(1),
    requestId: z.string().trim().min(1),
    reviewStatus: z.enum(['max_iterations_reached', 'needs_user_review']),
    rollbackCheckpoint: rollbackCheckpointSchema,
    rollbackReceipt: agentHistoryRollbackResponseSchema.optional(),
    selectedImage: z
      .object({
        height: z.number().int().positive(),
        path: z.string().trim().min(1),
        previewIdentity: z.string().trim().min(1).nullable(),
        width: z.number().int().positive(),
      })
      .strict(),
    selectedImagePath: z.string().trim().min(1),
    status: z.enum(['needs_user_review', 'max_iterations_reached']),
    toolName: z.literal(AGENT_CURRENT_IMAGE_PREVIEW_LOOP_TOOL_NAME),
  })
  .strict();

export type AgentCurrentImagePreviewLoopRequest = z.infer<typeof agentCurrentImagePreviewLoopRequestSchema>;
export type AgentCurrentImagePreviewLoopResult = z.infer<typeof agentCurrentImagePreviewLoopResultSchema>;

const assertSelectedImageLoopSnapshot = (request: AgentCurrentImagePreviewLoopRequest) => {
  const snapshot = buildAgentImageContextSnapshot();
  if (snapshot.activeImagePath !== request.selectedImagePath) {
    throw new Error('Agent selected-image preview loop rejected a different selected image.');
  }
  if (snapshot.graphRevision !== request.expectedGraphRevision) {
    throw new Error('Agent selected-image preview loop rejected stale graph revision.');
  }
  if (snapshot.initialPreview.recipeHash !== request.expectedRecipeHash) {
    throw new Error('Agent selected-image preview loop rejected stale recipe hash.');
  }
  if (snapshot.previewIdentity !== request.expectedPreviewIdentity) {
    throw new Error('Agent selected-image preview loop rejected stale preview identity.');
  }
  if (
    snapshot.initialPreview.width !== request.expectedPreviewWidth ||
    snapshot.initialPreview.height !== request.expectedPreviewHeight
  ) {
    throw new Error('Agent selected-image preview loop rejected stale selected-image dimensions.');
  }
  return snapshot;
};

export const runAgentCurrentImagePreviewLoop = async (
  request: AgentCurrentImagePreviewLoopRequest,
): Promise<AgentCurrentImagePreviewLoopResult> => {
  const parsedRequest = agentCurrentImagePreviewLoopRequestSchema.parse(request);
  const initialSnapshot = assertSelectedImageLoopSnapshot(parsedRequest);
  const { runAgentIterativeEditLoop } = await import('../planning/agentIterativeEditLoop.js');
  const {
    expectedGraphRevision: _expectedGraphRevision,
    expectedPreviewHeight: _expectedPreviewHeight,
    expectedPreviewIdentity: _expectedPreviewIdentity,
    expectedPreviewWidth: _expectedPreviewWidth,
    expectedRecipeHash: _expectedRecipeHash,
    selectedImagePath: _selectedImagePath,
    ...loopRequest
  } = parsedRequest;
  const loopResult = await runAgentIterativeEditLoop(loopRequest);

  return agentCurrentImagePreviewLoopResultSchema.parse({
    acceptedDryRunPlanCount: loopResult.acceptedDryRunPlanCount,
    applyReceipts: loopResult.applyReceipts,
    auditEventSummary: loopResult.auditEvents.map((event: (typeof loopResult.auditEvents)[number]) => ({
      graphRevision: event.graphRevision,
      recipeHash: event.recipeHash,
      toolName: event.toolName,
      turn: event.turn,
      type: event.type,
    })),
    compareArtifactIds: {
      beforeArtifactId: loopResult.compareReview.beforeArtifactId,
      currentArtifactId: loopResult.compareReview.currentArtifactId,
    },
    editCount: loopResult.editCount,
    finalGraphRevision: loopResult.appliedGraphRevision,
    finalRecipeHash: loopResult.finalRecipeHash,
    initialGraphRevision: initialSnapshot.graphRevision,
    initialPreviewArtifactId: initialSnapshot.initialPreview.artifactId,
    initialRecipeHash: initialSnapshot.initialPreview.recipeHash,
    previewIdentity: initialSnapshot.previewIdentity,
    previewLineage: loopResult.previewLineage,
    previewRefreshCount: loopResult.previewRefreshCount,
    requestId: loopResult.requestId,
    reviewStatus: loopResult.reviewStatus,
    rollbackCheckpoint: loopResult.rollbackCheckpoint,
    rollbackReceipt: loopResult.rollbackReceipt,
    selectedImage: {
      height: initialSnapshot.initialPreview.height,
      path: initialSnapshot.activeImagePath,
      previewIdentity: initialSnapshot.previewIdentity,
      width: initialSnapshot.initialPreview.width,
    },
    selectedImagePath: initialSnapshot.activeImagePath,
    status: loopResult.reviewStatus,
    toolName: AGENT_CURRENT_IMAGE_PREVIEW_LOOP_TOOL_NAME,
  });
};
