import { z } from 'zod';
import { agentMediumPreviewArtifactSchema, agentPreviewEnvelopeSchema } from '../context/agentPreviewEnvelope';
import {
  AGENT_MEDIUM_PREVIEW_LONG_EDGE_PX,
  AGENT_MEDIUM_PREVIEW_QUALITY,
  AGENT_PREVIEW_COMPARE_TOOL_NAME,
  AGENT_PREVIEW_RENDER_TOOL_NAME,
  AGENT_STATE_GET_TOOL_NAME,
  agentPreviewCompareResponseSchema,
  agentPreviewRenderResponseSchema,
  agentStateGetResponseSchema,
} from '../context/agentReadOnlyAppServerTools';
import { dispatchAgentLiveEditorTool } from '../session/agentLiveToolDispatch';
import {
  AGENT_HISTORY_ROLLBACK_TOOL_NAME,
  agentHistoryRollbackResponseSchema,
  createAgentSessionCheckpoint,
  rollbackAgentSessionHistory,
} from '../session/agentSessionHistory';
import {
  AGENT_ADJUSTMENTS_APPLY_TOOL_NAME,
  AGENT_ADJUSTMENTS_DRY_RUN_TOOL_NAME,
  agentAdjustmentsApplyResponseSchema,
  agentAdjustmentsDryRunResponseSchema,
} from '../tools/agentAdjustmentApplyTool';
import { agentEditQualityReviewSchema, buildAgentEditQualityReview } from './agentEditQualityReview';

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

const agentLoopDryRunPlanSchema = z
  .object({
    adjustmentKeys: z.array(z.string().trim().min(1)).min(1),
    approvalState: z.literal('approved'),
    expectedGraphRevision: z.string().trim().min(1),
    expectedRecipeHash: z.string().trim().min(1),
    planHash: z.string().trim().min(1),
    planId: z.string().trim().min(1),
    turn: z.number().int().min(2),
  })
  .strict();

const agentLoopAuditEventSchema = z
  .object({
    approvalState: z.literal('approved').optional(),
    commandId: z.string().trim().min(1),
    dryRunPlanHash: z.string().trim().min(1).optional(),
    dryRunPlanId: z.string().trim().min(1).optional(),
    graphRevision: z.string().trim().min(1),
    predictedGraphRevision: z.string().trim().min(1).optional(),
    previewArtifactId: z.string().trim().min(1).optional(),
    recipeHash: z.string().trim().min(1),
    rollbackGraphRevision: z.string().trim().min(1).optional(),
    toolName: z.string().trim().min(1),
    turn: z.number().int().positive(),
    type: z.enum(['state_query', 'dry_run', 'apply', 'preview_render', 'edit_review', 'compare', 'rollback']),
  })
  .strict();

export const agentIterativeEditLoopRequestSchema = z
  .object({
    dryRunApprovals: z.array(agentLoopDryRunApprovalSchema).min(1),
    maxIterations: z.number().int().min(2).max(6).default(4),
    operationId: z.string().trim().min(1),
    prompt: z.string().trim().min(1),
    requestId: z.string().trim().min(1),
    rollbackAfterReview: z.boolean().default(false),
    sessionId: z.string().trim().min(1),
    steps: z.array(agentLoopStepSchema).min(2).max(6),
  })
  .strict();

export const agentIterativeEditLoopResultSchema = z
  .object({
    appliedGraphRevision: z.string().trim().min(1),
    compareReview: z
      .object({
        artifacts: z.tuple([
          z
            .object({
              artifactId: z.string().trim().min(1),
              contentHash: z.string().trim().min(1),
              graphRevision: z.string().trim().min(1),
              previewRef: z.string().trim().min(1),
              recipeHash: z.string().trim().min(1),
              renderHash: z.string().trim().min(1),
              role: z.literal('before'),
            })
            .strict(),
          z
            .object({
              artifactId: z.string().trim().min(1),
              contentHash: z.string().trim().min(1),
              graphRevision: z.string().trim().min(1),
              previewRef: z.string().trim().min(1),
              recipeHash: z.string().trim().min(1),
              renderHash: z.string().trim().min(1),
              role: z.literal('current'),
            })
            .strict(),
        ]),
        beforeArtifactId: z.string().trim().min(1),
        currentArtifactId: z.string().trim().min(1),
        currentRecipeHash: z.string().trim().min(1),
        lineage: z
          .object({
            beforeGraphRevision: z.string().trim().min(1),
            beforeRecipeHash: z.string().trim().min(1),
            currentGraphRevision: z.string().trim().min(1),
            currentRecipeHash: z.string().trim().min(1),
            staleRecipeHash: z.boolean(),
          })
          .strict(),
        mediumPreview: agentMediumPreviewArtifactSchema,
        toolName: z.literal(AGENT_PREVIEW_COMPARE_TOOL_NAME),
      })
      .strict(),
    acceptedDryRunPlanCount: z.number().int().min(1),
    auditEvents: z.array(agentLoopAuditEventSchema).min(5),
    editCount: z.number().int().min(2),
    editReview: agentEditQualityReviewSchema,
    finalRecipeHash: z.string().trim().min(1),
    applyReceipts: z
      .array(
        z
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
          .strict(),
      )
      .min(1),
    previewRefreshes: z.array(agentPreviewEnvelopeSchema).min(2),
    previewRefreshCount: z.number().int().min(2),
    previewLineage: z
      .array(
        z
          .object({
            appliedGraphRevision: z.string().trim().min(1),
            crop: z
              .object({
                height: z.number().positive(),
                unit: z.enum(['%', 'normalized', 'px']),
                width: z.number().positive(),
                x: z.number(),
                y: z.number(),
              })
              .strict()
              .nullable(),
            height: z.number().int().positive(),
            longEdgePx: z.number().int().min(256).max(2048),
            maxPixelCount: z.number().int().min(65_536).max(4_194_304),
            previewArtifactId: z.string().trim().min(1),
            previewPurpose: z.enum(['detail_review', 'refresh']),
            previewRef: z.string().trim().min(1),
            quality: z.number().min(0.5).max(0.95),
            recipeHash: z.string().trim().min(1),
            renderHash: z.string().trim().min(1),
            sourceToolName: z.literal('rawengine.agent.adjustments.apply'),
            turn: z.number().int().positive(),
            width: z.number().int().positive(),
            zoom: z
              .object({
                centerX: z.number().min(0).max(1),
                centerY: z.number().min(0).max(1),
                scale: z.number().min(1).max(8),
              })
              .strict()
              .nullable(),
          })
          .strict(),
      )
      .min(2),
    requestId: z.string().trim().min(1),
    reviewStatus: z.enum(['max_iterations_reached', 'needs_user_review']),
    rollbackCheckpoint: z
      .object({
        graphRevision: z.string().trim().min(1),
        previewRecipeHash: z.string().trim().min(1),
        sessionId: z.string().trim().min(1),
      })
      .strict(),
    rollbackReceipt: agentHistoryRollbackResponseSchema.optional(),
    stopReason: z.enum(['completed', 'max_iterations']),
    transcript: z
      .array(
        z
          .object({
            detail: z.string().trim().min(1),
            toolName: z.string().trim().min(1),
            turn: z.number().int().positive(),
          })
          .strict(),
      )
      .min(5),
    userFeedbackTurns: z
      .array(
        z
          .object({
            previewArtifactId: z.string().trim().min(1),
            recipeHash: z.string().trim().min(1),
            turn: z.number().int().positive(),
            userFollowUp: z.string().trim().min(1),
          })
          .strict(),
      )
      .min(1),
  })
  .strict();

export type AgentIterativeEditLoopRequest = z.infer<typeof agentIterativeEditLoopRequestSchema>;
export type AgentIterativeEditLoopResult = z.infer<typeof agentIterativeEditLoopResultSchema>;

const getSnapshotRecipeHash = (snapshot: unknown): string => {
  const parsed = z
    .looseObject({
      initialPreview: z.looseObject({ recipeHash: z.string().trim().min(1) }),
    })
    .parse(snapshot);
  return parsed.initialPreview.recipeHash;
};

const getSnapshotGraphRevision = (snapshot: unknown): string => {
  const parsed = z.looseObject({ graphRevision: z.string().trim().min(1) }).parse(snapshot);
  return parsed.graphRevision;
};

const buildAgentLoopDryRunPlan = (basis: {
  approval: z.infer<typeof agentLoopDryRunApprovalSchema>;
  dryRun: z.infer<typeof agentAdjustmentsDryRunResponseSchema>;
  expectedRecipeHash: string;
  turn: number;
}): z.infer<typeof agentLoopDryRunPlanSchema> => {
  if (basis.approval.expectedGraphRevision !== basis.dryRun.sourceGraphRevision) {
    throw new Error('Agent iterative loop rejected dry-run approval with stale graph revision.');
  }
  if (basis.approval.acceptedPlanHash !== basis.dryRun.dryRunPlanHash) {
    throw new Error('Agent iterative loop rejected dry-run approval with stale plan hash.');
  }
  if (basis.approval.acceptedPlanId !== basis.dryRun.dryRunPlanId) {
    throw new Error('Agent iterative loop rejected dry-run approval with stale plan id.');
  }
  return agentLoopDryRunPlanSchema.parse({
    adjustmentKeys: basis.dryRun.adjustedFields,
    approvalState: basis.approval.approvalState,
    expectedGraphRevision: basis.dryRun.sourceGraphRevision,
    expectedRecipeHash: basis.expectedRecipeHash,
    planHash: basis.dryRun.dryRunPlanHash,
    planId: basis.dryRun.dryRunPlanId,
    turn: basis.turn,
  });
};

export const runAgentIterativeEditLoop = async (
  request: AgentIterativeEditLoopRequest,
): Promise<AgentIterativeEditLoopResult> => {
  const parsedRequest = agentIterativeEditLoopRequestSchema.parse(request);
  const transcript: AgentIterativeEditLoopResult['transcript'] = [];
  const auditEvents: AgentIterativeEditLoopResult['auditEvents'] = [];
  const initialState = agentStateGetResponseSchema.parse(
    await dispatchAgentLiveEditorTool({
      args: { requestId: `${parsedRequest.requestId}-state-0` },
      requestId: `${parsedRequest.requestId}-state-0`,
      runtimeToolName: AGENT_STATE_GET_TOOL_NAME,
    }),
  );
  let recipeHash = getSnapshotRecipeHash(initialState.snapshot);
  let currentGraphRevision = getSnapshotGraphRevision(initialState.snapshot);
  let appliedGraphRevision = 'unapplied';
  let acceptedDryRunPlanCount = 0;
  let editCount = 0;
  let previewRefreshCount = 0;
  const previewRefreshes: AgentIterativeEditLoopResult['previewRefreshes'] = [];
  const previewLineage: AgentIterativeEditLoopResult['previewLineage'] = [];
  const applyReceipts: AgentIterativeEditLoopResult['applyReceipts'] = [];
  const toolReceipts: Array<{ graphRevision: string; summary: string; toolName: string }> = [];
  const userFeedbackTurns: AgentIterativeEditLoopResult['userFeedbackTurns'] = [];
  const rollbackCheckpoint = createAgentSessionCheckpoint(parsedRequest.sessionId);
  const approvalsByTurn = new Map(parsedRequest.dryRunApprovals.map((approval) => [approval.turn, approval]));

  transcript.push({
    detail: `initial inspect for ${parsedRequest.prompt}`,
    toolName: initialState.toolName,
    turn: 1,
  });
  auditEvents.push({
    commandId: initialState.requestId,
    graphRevision: currentGraphRevision,
    recipeHash,
    toolName: initialState.toolName,
    turn: 1,
    type: 'state_query',
  });

  for (const [index, step] of parsedRequest.steps.entries()) {
    const turn = index + 2;
    if (editCount >= parsedRequest.maxIterations) break;

    const { preview: previewRequest, ...adjustments } = step;
    const { assistantRationale, userFollowUp, ...adjustmentPatch } = adjustments;
    if (userFollowUp !== undefined) {
      transcript.push({
        detail: userFollowUp,
        toolName: 'rawengine.agent.user_feedback',
        turn,
      });
    }
    if (assistantRationale !== undefined) {
      transcript.push({
        detail: assistantRationale,
        toolName: 'rawengine.agent.plan.refine',
        turn,
      });
    }
    const approval = approvalsByTurn.get(turn);
    if (approval === undefined) {
      throw new Error(`Agent iterative loop rejected turn ${turn} without accepted dry-run approval.`);
    }
    const expectedGraphRevision = currentGraphRevision;
    const dryRunRequestId = `${parsedRequest.requestId}-dry-run-${index + 1}`;
    const dryRun = agentAdjustmentsDryRunResponseSchema.parse(
      await dispatchAgentLiveEditorTool({
        args: {
          adjustments: agentLoopAdjustmentPatchSchema.parse(adjustmentPatch),
          expectedGraphRevision,
          expectedRecipeHash: recipeHash,
          operationId: `${parsedRequest.operationId}-${index + 1}`,
          requestId: dryRunRequestId,
          sessionId: parsedRequest.sessionId,
        },
        requestId: dryRunRequestId,
        runtimeToolName: AGENT_ADJUSTMENTS_DRY_RUN_TOOL_NAME,
      }),
    );
    const dryRunPlan = buildAgentLoopDryRunPlan({
      approval,
      dryRun,
      expectedRecipeHash: recipeHash,
      turn,
    });
    acceptedDryRunPlanCount += 1;
    transcript.push({
      detail: `${dryRunPlan.planId} ${dryRunPlan.planHash}`,
      toolName: dryRun.toolName,
      turn,
    });
    auditEvents.push({
      approvalState: dryRunPlan.approvalState,
      commandId: dryRun.requestId,
      dryRunPlanHash: dryRunPlan.planHash,
      dryRunPlanId: dryRunPlan.planId,
      graphRevision: dryRunPlan.expectedGraphRevision,
      predictedGraphRevision: dryRun.predictedGraphRevision,
      recipeHash: dryRunPlan.expectedRecipeHash,
      toolName: dryRun.toolName,
      turn,
      type: 'dry_run',
    });
    const applyRequestId = `${parsedRequest.requestId}-apply-${index + 1}`;
    const apply = agentAdjustmentsApplyResponseSchema.parse(
      await dispatchAgentLiveEditorTool({
        args: {
          acceptedPlanHash: dryRunPlan.planHash,
          acceptedPlanId: dryRunPlan.planId,
          adjustments: agentLoopAdjustmentPatchSchema.parse(adjustmentPatch),
          expectedGraphRevision: dryRunPlan.expectedGraphRevision,
          expectedRecipeHash: recipeHash,
          operationId: `${parsedRequest.operationId}-${index + 1}`,
          requestId: applyRequestId,
          sessionId: parsedRequest.sessionId,
        },
        requestId: applyRequestId,
        runtimeToolName: AGENT_ADJUSTMENTS_APPLY_TOOL_NAME,
      }),
    );
    editCount += 1;
    appliedGraphRevision = apply.appliedGraphRevision;
    transcript.push({
      detail: `${apply.adjustedFields.join(',')} -> ${apply.appliedGraphRevision}`,
      toolName: apply.toolName,
      turn,
    });
    auditEvents.push({
      approvalState: dryRunPlan.approvalState,
      commandId: apply.requestId,
      dryRunPlanHash: dryRunPlan.planHash,
      dryRunPlanId: dryRunPlan.planId,
      graphRevision: apply.appliedGraphRevision,
      recipeHash: apply.afterPreviewHash,
      rollbackGraphRevision: apply.undoGraphRevision,
      toolName: apply.toolName,
      turn,
      type: 'apply',
    });
    applyReceipts.push({
      acceptedPlanHash: dryRunPlan.planHash,
      acceptedPlanId: dryRunPlan.planId,
      adjustedFields: apply.adjustedFields,
      appliedGraphRevision: apply.appliedGraphRevision,
      changedPixelCount: apply.changedPixelCount,
      changedPixelPercent: apply.changedPixelPercent,
      maxChannelDelta: apply.maxChannelDelta,
      meanLuminanceDelta: apply.meanLuminanceDelta,
      requestId: apply.requestId,
      sampledPixelCount: apply.sampledPixelCount,
      turn,
      undoGraphRevision: apply.undoGraphRevision,
    });
    toolReceipts.push({
      graphRevision: apply.appliedGraphRevision,
      summary: apply.adjustedFields.join(','),
      toolName: apply.toolName,
    });

    const stateRequestId = `${parsedRequest.requestId}-state-${index + 1}`;
    const state = agentStateGetResponseSchema.parse(
      await dispatchAgentLiveEditorTool({
        args: { requestId: stateRequestId },
        requestId: stateRequestId,
        runtimeToolName: AGENT_STATE_GET_TOOL_NAME,
      }),
    );
    recipeHash = getSnapshotRecipeHash(state.snapshot);
    currentGraphRevision = getSnapshotGraphRevision(state.snapshot);
    auditEvents.push({
      commandId: state.requestId,
      graphRevision: currentGraphRevision,
      recipeHash,
      toolName: state.toolName,
      turn,
      type: 'state_query',
    });
    const previewRequestId = `${parsedRequest.requestId}-preview-${index + 1}`;
    const preview = agentPreviewRenderResponseSchema.parse(
      await dispatchAgentLiveEditorTool({
        args: {
          crop: previewRequest?.crop,
          expectedRecipeHash: recipeHash,
          longEdgePx: previewRequest?.longEdgePx ?? AGENT_MEDIUM_PREVIEW_LONG_EDGE_PX,
          maxPixelCount: previewRequest?.maxPixelCount,
          purpose: previewRequest?.purpose ?? 'refresh',
          quality: previewRequest?.quality ?? AGENT_MEDIUM_PREVIEW_QUALITY,
          requestId: previewRequestId,
          zoom: previewRequest?.zoom,
        },
        requestId: previewRequestId,
        runtimeToolName: AGENT_PREVIEW_RENDER_TOOL_NAME,
      }),
    );
    previewRefreshCount += 1;
    previewRefreshes.push(preview.preview);
    const previewPurpose = z.enum(['detail_review', 'refresh']).parse(preview.preview.purpose);
    previewLineage.push({
      appliedGraphRevision: apply.appliedGraphRevision,
      crop: preview.preview.crop,
      height: preview.preview.height,
      longEdgePx: preview.preview.longEdgePx,
      maxPixelCount: preview.preview.maxPixelCount,
      previewArtifactId: preview.preview.artifactId,
      previewPurpose,
      previewRef: preview.preview.previewRef,
      quality: preview.preview.quality,
      recipeHash,
      renderHash: preview.preview.renderHash,
      sourceToolName: apply.toolName,
      turn,
      width: preview.preview.width,
      zoom: preview.preview.zoom,
    });
    if (userFollowUp !== undefined) {
      userFeedbackTurns.push({
        previewArtifactId: preview.preview.artifactId,
        recipeHash,
        turn,
        userFollowUp,
      });
    }
    auditEvents.push({
      commandId: preview.requestId,
      graphRevision: apply.appliedGraphRevision,
      previewArtifactId: preview.preview.artifactId,
      recipeHash,
      toolName: preview.toolName,
      turn,
      type: 'preview_render',
    });
    transcript.push({
      detail: `${preview.requestId} ${preview.preview.id} ${preview.staleRecipeHash ? 'stale' : 'fresh'}`,
      toolName: preview.toolName,
      turn,
    });
  }
  const finalPreview = previewRefreshes.at(-1);
  if (finalPreview === undefined) {
    throw new Error('Agent iterative loop cannot review an edit without a refreshed preview.');
  }
  const beforePreview = previewRefreshes[0];
  if (beforePreview === undefined) {
    throw new Error('Agent iterative loop cannot review an edit without an initial refreshed preview.');
  }
  const editReview = buildAgentEditQualityReview({
    beforePreview,
    maxIterationsReached: editCount >= parsedRequest.maxIterations,
    preview: finalPreview,
    prompt: parsedRequest.prompt,
    toolReceiptCount: transcript.filter((entry) => entry.toolName === 'rawengine.agent.adjustments.apply').length,
    toolReceipts,
  });
  transcript.push({
    detail: `${editReview.stopReason}: ${editReview.finalRationale}`,
    toolName: 'rawengine.agent.edit_review',
    turn: editCount + 2,
  });
  auditEvents.push({
    commandId: `${parsedRequest.requestId}-edit-review`,
    graphRevision: appliedGraphRevision,
    previewArtifactId: finalPreview.artifactId,
    recipeHash,
    toolName: 'rawengine.agent.edit_review',
    turn: editCount + 2,
    type: 'edit_review',
  });
  const compareToolCallId = `${parsedRequest.requestId}-compare-final`;
  const compare = agentPreviewCompareResponseSchema.parse(
    await dispatchAgentLiveEditorTool({
      args: {
        beforeGraphRevision: previewLineage[0]?.appliedGraphRevision ?? appliedGraphRevision,
        beforeRecipeHash: beforePreview.recipeHash,
        expectedRecipeHash: recipeHash,
        requestId: compareToolCallId,
      },
      requestId: compareToolCallId,
      runtimeToolName: AGENT_PREVIEW_COMPARE_TOOL_NAME,
    }),
  );
  transcript.push({
    detail: `${compare.compare.artifacts[0].artifactId} -> ${compare.compare.artifacts[1].artifactId}`,
    toolName: compare.toolName,
    turn: editCount + 2,
  });
  auditEvents.push({
    commandId: compare.requestId,
    graphRevision: appliedGraphRevision,
    previewArtifactId: compare.compare.artifacts[1].artifactId,
    recipeHash,
    toolName: compare.toolName,
    turn: editCount + 2,
    type: 'compare',
  });

  const rollbackReceipt = parsedRequest.rollbackAfterReview
    ? agentHistoryRollbackResponseSchema.parse(
        rollbackAgentSessionHistory({
          checkpoint: rollbackCheckpoint,
          expectedCurrentGraphRevision: appliedGraphRevision,
          expectedCurrentPreviewRecipeHash: recipeHash,
          expectedSelectedImagePath: rollbackCheckpoint.activeImagePath,
          requestId: `${parsedRequest.requestId}-rollback-review`,
          scope: 'session_start',
          sessionId: parsedRequest.sessionId,
        }),
      )
    : undefined;
  if (rollbackReceipt !== undefined) {
    auditEvents.push({
      commandId: rollbackReceipt.requestId,
      graphRevision: rollbackReceipt.graphRevision,
      recipeHash: rollbackReceipt.previewRecipeHash,
      rollbackGraphRevision: rollbackReceipt.graphRevision,
      toolName: AGENT_HISTORY_ROLLBACK_TOOL_NAME,
      turn: editCount + 3,
      type: 'rollback',
    });
  }

  return agentIterativeEditLoopResultSchema.parse({
    acceptedDryRunPlanCount,
    appliedGraphRevision,
    applyReceipts,
    auditEvents,
    compareReview: {
      artifacts: [
        {
          artifactId: compare.compare.artifacts[0].artifactId,
          contentHash: compare.compare.artifacts[0].contentHash,
          graphRevision: compare.compare.artifacts[0].graphRevision,
          previewRef: compare.compare.artifacts[0].preview.previewRef,
          recipeHash: compare.compare.artifacts[0].recipeHash,
          renderHash: compare.compare.artifacts[0].renderHash,
          role: 'before',
        },
        {
          artifactId: compare.compare.artifacts[1].artifactId,
          contentHash: compare.compare.artifacts[1].contentHash,
          graphRevision: compare.compare.artifacts[1].graphRevision,
          previewRef: compare.compare.artifacts[1].preview.previewRef,
          recipeHash: compare.compare.artifacts[1].recipeHash,
          renderHash: compare.compare.artifacts[1].renderHash,
          role: 'current',
        },
      ],
      beforeArtifactId: compare.compare.artifacts[0].artifactId,
      currentArtifactId: compare.compare.artifacts[1].artifactId,
      currentRecipeHash: compare.compare.lineage.currentRecipeHash,
      lineage: compare.compare.lineage,
      mediumPreview: compare.compare.mediumPreview,
      toolName: compare.toolName,
    },
    editCount,
    editReview,
    finalRecipeHash: recipeHash,
    previewLineage,
    previewRefreshes,
    previewRefreshCount,
    requestId: parsedRequest.requestId,
    reviewStatus: editCount >= parsedRequest.maxIterations ? 'max_iterations_reached' : 'needs_user_review',
    rollbackCheckpoint: {
      graphRevision: rollbackCheckpoint.graphRevision,
      previewRecipeHash: rollbackCheckpoint.previewRecipeHash,
      sessionId: rollbackCheckpoint.sessionId,
    },
    rollbackReceipt,
    stopReason: editCount >= parsedRequest.maxIterations ? 'max_iterations' : 'completed',
    transcript,
    userFeedbackTurns,
  });
};
