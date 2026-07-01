import { z } from 'zod';
import {
  type RawEngineAgentInitialPreviewReceiptV1,
  type RawEngineAgentPreviewRefreshReceiptV1,
  rawEngineAgentInitialPreviewReceiptV1Schema,
  rawEngineAgentPreviewRefreshReceiptV1Schema,
} from '../../../../packages/rawengine-schema/src/localAppServerBridge';
import { agentHistoryRollbackResponseSchema } from '../session/agentSessionHistory';
import { buildAgentImageContextSnapshot } from './agentImageContextSnapshot';
import { buildAgentInitialPromptContext } from './agentInitialPromptContext';

export const AGENT_CURRENT_IMAGE_PREVIEW_LOOP_TOOL_NAME = 'rawengine.agent.selected_image.preview_loop';
export const AGENT_CURRENT_IMAGE_PREVIEW_LOOP_APPLY_REVIEW_TOOL_NAME =
  'rawengine.agent.selected_image.preview_loop.apply_review';
export const AGENT_CURRENT_IMAGE_PREVIEW_LOOP_INPUT_SCHEMA_NAME = 'AgentCurrentImagePreviewLoopRequestV1';
export const AGENT_CURRENT_IMAGE_PREVIEW_LOOP_OUTPUT_SCHEMA_NAME = 'AgentCurrentImagePreviewLoopResponseV1';
export const AGENT_CURRENT_IMAGE_PREVIEW_LOOP_APPLY_REVIEW_INPUT_SCHEMA_NAME =
  'AgentCurrentImagePreviewLoopApplyReviewRequestV1';
export const AGENT_CURRENT_IMAGE_PREVIEW_LOOP_APPLY_REVIEW_OUTPUT_SCHEMA_NAME =
  AGENT_CURRENT_IMAGE_PREVIEW_LOOP_OUTPUT_SCHEMA_NAME;

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

const previewCropSchema = z
  .object({
    height: z.number().positive(),
    unit: z.enum(['%', 'normalized', 'px']),
    width: z.number().positive(),
    x: z.number(),
    y: z.number(),
  })
  .strict()
  .nullable();

const previewZoomSchema = z
  .object({
    centerX: z.number().min(0).max(1),
    centerY: z.number().min(0).max(1),
    scale: z.number().min(1).max(8),
  })
  .strict()
  .nullable();

const previewLineageSchema = z
  .object({
    appliedGraphRevision: z.string().trim().min(1),
    crop: previewCropSchema.optional(),
    height: z.number().int().positive().optional(),
    longEdgePx: z.number().int().min(256).max(2048).optional(),
    maxPixelCount: z.number().int().min(65_536).max(4_194_304).optional(),
    previewArtifactId: z.string().trim().min(1),
    previewPurpose: z.enum(['detail_review', 'refresh']),
    previewRef: z.string().trim().min(1).optional(),
    quality: z.number().min(0.5).max(0.95).optional(),
    recipeHash: z.string().trim().min(1),
    renderHash: z.string().trim().min(1).optional(),
    sourceToolName: z.literal('rawengine.agent.adjustments.apply'),
    turn: z.number().int().positive(),
    width: z.number().int().positive().optional(),
    zoom: previewZoomSchema.optional(),
  })
  .strict();

const compareArtifactEvidenceSchema = z
  .object({
    contentHash: z.string().trim().min(1),
    graphRevision: z.string().trim().min(1),
    previewRef: z.string().trim().min(1),
    recipeHash: z.string().trim().min(1),
    renderHash: z.string().trim().min(1),
  })
  .strict();

const rollbackCheckpointSchema = z
  .object({
    graphRevision: z.string().trim().min(1),
    previewRecipeHash: z.string().trim().min(1),
    sessionId: z.string().trim().min(1),
  })
  .strict();

const buildPreviewReceiptContentHash = (receiptSeed: {
  artifactId: string;
  graphRevision: string;
  imagePath: string;
  renderHash: string;
  requestId: string;
  sessionId: string;
}): string => {
  const hashSeed = JSON.stringify(receiptSeed);
  let hash = 0x811c9dc5;
  for (let index = 0; index < hashSeed.length; index += 1) {
    hash ^= hashSeed.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }

  return `sha256:${(hash >>> 0).toString(16).padStart(16, '0')}`;
};

const buildSelectedImageInitialPreviewReceipt = ({
  operationId,
  prompt,
  requestId,
  sessionId,
}: {
  operationId: string;
  prompt: string;
  requestId: string;
  sessionId: string;
}): RawEngineAgentInitialPreviewReceiptV1 => {
  const initialContext = buildAgentInitialPromptContext({ operationId, prompt, sessionId });

  return rawEngineAgentInitialPreviewReceiptV1Schema.parse({
    colorPipeline: {
      encodedProfile: 'srgb-preview',
      outputProfile: 'srgb',
      previewTransform: 'editor-preview-to-srgb-jpeg',
      workingSpace: 'rawengine-scene-linear',
    },
    contentHash: buildPreviewReceiptContentHash({
      artifactId: initialContext.preview.artifactId,
      graphRevision: initialContext.modelInput.graphRevision,
      imagePath: initialContext.modelInput.activeImagePath,
      renderHash: initialContext.preview.renderHash,
      requestId,
      sessionId,
    }),
    graphRevision: initialContext.modelInput.graphRevision,
    imagePath: initialContext.modelInput.activeImagePath,
    preview: {
      accessScope: initialContext.preview.accessScope,
      artifactId: initialContext.preview.artifactId,
      encodedFormat: initialContext.preview.encodedFormat,
      height: initialContext.modelInput.initialPreview.height,
      includesOriginalRaw: initialContext.modelInput.initialPreview.includesOriginalRaw,
      longEdgePx: initialContext.preview.longEdgePx,
      mediaType: initialContext.preview.mediaType,
      previewRef: initialContext.preview.previewRef,
      purpose: initialContext.preview.purpose,
      quality: initialContext.preview.quality,
      recipeHash: initialContext.preview.recipeHash,
      renderHash: initialContext.preview.renderHash,
      width: initialContext.modelInput.initialPreview.width,
    },
    proofContext: {
      stale: initialContext.imageContext.initialPreview.recipeHash !== initialContext.preview.recipeHash,
      transport: initialContext.modelInput.transport,
    },
    requestId,
    schemaVersion: 1,
    sessionId,
    toolName: 'rawengine.agent.initial_prompt_preview',
  });
};

const buildSelectedImagePreviewRefreshReceipt = ({
  graphRevision,
  imagePath,
  preview,
  requestId,
  sessionId,
  sourceToolName,
  turn,
}: {
  graphRevision: string;
  imagePath: string;
  preview: {
    accessScope: 'local_private';
    artifactId: string;
    encodedFormat: 'jpeg';
    height: number;
    includesOriginalRaw: false;
    longEdgePx: number;
    mediaType: 'image/jpeg';
    previewRef: string;
    purpose: 'detail_review' | 'refresh';
    quality: number;
    recipeHash: string;
    renderHash: string;
    width: number;
  };
  requestId: string;
  sessionId: string;
  sourceToolName: string;
  turn: number;
}): RawEngineAgentPreviewRefreshReceiptV1 =>
  rawEngineAgentPreviewRefreshReceiptV1Schema.parse({
    colorPipeline: {
      encodedProfile: 'srgb-preview',
      outputProfile: 'srgb',
      previewTransform: 'editor-preview-to-srgb-jpeg',
      workingSpace: 'rawengine-scene-linear',
    },
    contentHash: buildPreviewReceiptContentHash({
      artifactId: preview.artifactId,
      graphRevision,
      imagePath,
      renderHash: preview.renderHash,
      requestId,
      sessionId,
    }),
    graphRevision,
    imagePath,
    preview,
    proofContext: {
      expectedRecipeHash: preview.recipeHash,
      sourceToolName,
      stale: false,
      transport: 'codex_app_server',
    },
    requestId,
    schemaVersion: 1,
    sessionId,
    toolName: 'rawengine.agent.preview.render',
    turn,
  });

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
        beforeEvidence: compareArtifactEvidenceSchema.optional(),
        currentArtifactId: z.string().trim().min(1),
        currentEvidence: compareArtifactEvidenceSchema.optional(),
        lineage: z
          .object({
            beforeGraphRevision: z.string().trim().min(1),
            beforeRecipeHash: z.string().trim().min(1),
            currentGraphRevision: z.string().trim().min(1),
            currentRecipeHash: z.string().trim().min(1),
            staleRecipeHash: z.boolean(),
          })
          .strict()
          .optional(),
        mediumPreview: z
          .object({
            longEdgePx: z.number().int().min(256).max(2048),
            maxPixelCount: z.number().int().min(65_536).max(4_194_304),
            quality: z.number().min(0.5).max(0.95),
          })
          .strict()
          .optional(),
      })
      .strict(),
    editCount: z.number().int().min(1),
    finalGraphRevision: z.string().trim().min(1),
    finalRecipeHash: z.string().trim().min(1),
    initialGraphRevision: z.string().trim().min(1),
    initialPreviewArtifactId: z.string().trim().min(1),
    initialPreviewReceipt: rawEngineAgentInitialPreviewReceiptV1Schema,
    initialRecipeHash: z.string().trim().min(1),
    previewIdentity: z.string().trim().min(1).nullable(),
    previewLineage: z.array(previewLineageSchema).min(1),
    previewRefreshCount: z.number().int().min(1),
    previewRefreshReceipts: z.array(rawEngineAgentPreviewRefreshReceiptV1Schema).min(1),
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

export const agentCurrentImagePreviewLoopApplyReviewRequestSchema = z
  .object({
    acceptedPreviewArtifactId: z.string().trim().min(1),
    acceptedPreviewReceiptHash: z.string().regex(/^sha256:[a-f0-9]{16,64}$/u),
    request: agentCurrentImagePreviewLoopRequestSchema,
    review: agentCurrentImagePreviewLoopResultSchema,
  })
  .strict();

export type AgentCurrentImagePreviewLoopApplyReviewRequest = z.infer<
  typeof agentCurrentImagePreviewLoopApplyReviewRequestSchema
>;

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
  const initialPreviewReceipt = buildSelectedImageInitialPreviewReceipt({
    operationId: parsedRequest.operationId,
    prompt: parsedRequest.prompt,
    requestId: `${parsedRequest.requestId}-initial-preview`,
    sessionId: parsedRequest.sessionId,
  });
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
  const previewRefreshReceipts = loopResult.previewLineage.map((lineage, index) => {
    const preview = loopResult.previewRefreshes[index];
    if (preview === undefined) {
      throw new Error('Agent selected-image preview loop missing refresh preview for lineage receipt.');
    }
    return buildSelectedImagePreviewRefreshReceipt({
      graphRevision: lineage.appliedGraphRevision,
      imagePath: initialSnapshot.activeImagePath,
      preview: {
        accessScope: preview.accessScope,
        artifactId: preview.artifactId,
        encodedFormat: preview.encodedFormat,
        height: preview.height,
        includesOriginalRaw: preview.includesOriginalRaw,
        longEdgePx: preview.longEdgePx,
        mediaType: preview.mediaType,
        previewRef: preview.previewRef,
        purpose: lineage.previewPurpose,
        quality: preview.quality,
        recipeHash: preview.recipeHash,
        renderHash: preview.renderHash,
        width: preview.width,
      },
      requestId: `${parsedRequest.requestId}-preview-${index + 1}`,
      sessionId: parsedRequest.sessionId,
      sourceToolName: lineage.sourceToolName,
      turn: lineage.turn,
    });
  });

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
      beforeEvidence: {
        contentHash: loopResult.compareReview.artifacts[0].contentHash,
        graphRevision: loopResult.compareReview.artifacts[0].graphRevision,
        previewRef: loopResult.compareReview.artifacts[0].previewRef,
        recipeHash: loopResult.compareReview.artifacts[0].recipeHash,
        renderHash: loopResult.compareReview.artifacts[0].renderHash,
      },
      currentArtifactId: loopResult.compareReview.currentArtifactId,
      currentEvidence: {
        contentHash: loopResult.compareReview.artifacts[1].contentHash,
        graphRevision: loopResult.compareReview.artifacts[1].graphRevision,
        previewRef: loopResult.compareReview.artifacts[1].previewRef,
        recipeHash: loopResult.compareReview.artifacts[1].recipeHash,
        renderHash: loopResult.compareReview.artifacts[1].renderHash,
      },
      lineage: loopResult.compareReview.lineage,
      mediumPreview: loopResult.compareReview.mediumPreview,
    },
    editCount: loopResult.editCount,
    finalGraphRevision: loopResult.appliedGraphRevision,
    finalRecipeHash: loopResult.finalRecipeHash,
    initialGraphRevision: initialSnapshot.graphRevision,
    initialPreviewArtifactId: initialSnapshot.initialPreview.artifactId,
    initialPreviewReceipt,
    initialRecipeHash: initialSnapshot.initialPreview.recipeHash,
    previewIdentity: initialSnapshot.previewIdentity,
    previewLineage: loopResult.previewLineage,
    previewRefreshCount: loopResult.previewRefreshCount,
    previewRefreshReceipts,
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

export const applyAgentCurrentImagePreviewLoopReviewedEdit = async (
  request: AgentCurrentImagePreviewLoopApplyReviewRequest,
): Promise<AgentCurrentImagePreviewLoopResult> => {
  const parsedRequest = agentCurrentImagePreviewLoopApplyReviewRequestSchema.parse(request);
  const latestPreview = parsedRequest.review.previewLineage.at(-1);
  const latestPreviewReceipt = parsedRequest.review.previewRefreshReceipts.at(-1);
  if (latestPreview === undefined || parsedRequest.review.previewRefreshCount < 2) {
    throw new Error('Agent selected-image preview loop apply requires at least two refreshed previews.');
  }
  if (latestPreviewReceipt === undefined) {
    throw new Error('Agent selected-image preview loop apply requires a latest preview refresh receipt.');
  }
  if (parsedRequest.acceptedPreviewArtifactId !== latestPreview.previewArtifactId) {
    throw new Error('Agent selected-image preview loop apply rejected stale preview artifact.');
  }
  if (parsedRequest.acceptedPreviewReceiptHash !== latestPreviewReceipt.contentHash) {
    throw new Error('Agent selected-image preview loop apply rejected stale preview receipt.');
  }

  const snapshot = buildAgentImageContextSnapshot();
  if (snapshot.activeImagePath !== parsedRequest.review.selectedImagePath) {
    throw new Error('Agent selected-image preview loop apply rejected a different selected image.');
  }
  if (
    snapshot.initialPreview.width !== parsedRequest.review.selectedImage.width ||
    snapshot.initialPreview.height !== parsedRequest.review.selectedImage.height
  ) {
    throw new Error('Agent selected-image preview loop apply rejected stale selected-image dimensions.');
  }
  if (snapshot.previewIdentity !== parsedRequest.review.selectedImage.previewIdentity) {
    throw new Error('Agent selected-image preview loop apply rejected stale preview identity.');
  }
  if (snapshot.graphRevision !== parsedRequest.review.rollbackCheckpoint.graphRevision) {
    throw new Error('Agent selected-image preview loop apply rejected stale rollback graph revision.');
  }
  if (snapshot.initialPreview.recipeHash !== parsedRequest.review.rollbackCheckpoint.previewRecipeHash) {
    throw new Error('Agent selected-image preview loop apply rejected stale rollback recipe hash.');
  }

  return runAgentCurrentImagePreviewLoop({
    ...parsedRequest.request,
    requestId: `${parsedRequest.request.requestId}-accepted-apply`,
    rollbackAfterReview: false,
  });
};
