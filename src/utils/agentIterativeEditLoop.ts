import { z } from 'zod';

import { AGENT_ADJUSTMENTS_APPLY_TOOL_NAME, agentAdjustmentsApplyResponseSchema } from './agentAdjustmentApplyTool';
import { agentEditQualityReviewSchema, buildAgentEditQualityReview } from './agentEditQualityReview';
import { agentPreviewEnvelopeSchema } from './agentPreviewEnvelope';
import {
  AGENT_PREVIEW_RENDER_TOOL_NAME,
  AGENT_STATE_GET_TOOL_NAME,
  agentPreviewRenderResponseSchema,
  agentStateGetResponseSchema,
} from './agentReadOnlyAppServerTools';
import { handleRawEngineAppServerHostRequestAsync } from './rawEngineAppServerHost';
import { RawEngineAppServerHostToolName } from '../schemas/agentRuntimeSchemas';

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
  preview: agentLoopPreviewRequestSchema.optional(),
});

export const agentIterativeEditLoopRequestSchema = z
  .object({
    maxIterations: z.number().int().min(2).max(6).default(4),
    operationId: z.string().trim().min(1),
    prompt: z.string().trim().min(1),
    requestId: z.string().trim().min(1),
    sessionId: z.string().trim().min(1),
    steps: z.array(agentLoopStepSchema).min(2).max(6),
  })
  .strict();

export const agentIterativeEditLoopResultSchema = z
  .object({
    appliedGraphRevision: z.string().trim().min(1),
    editCount: z.number().int().min(2),
    editReview: agentEditQualityReviewSchema,
    finalRecipeHash: z.string().trim().min(1),
    previewRefreshes: z.array(agentPreviewEnvelopeSchema).min(2),
    previewRefreshCount: z.number().int().min(2),
    previewLineage: z
      .array(
        z
          .object({
            appliedGraphRevision: z.string().trim().min(1),
            previewArtifactId: z.string().trim().min(1),
            previewPurpose: z.enum(['detail_review', 'refresh']),
            recipeHash: z.string().trim().min(1),
            sourceToolName: z.literal('rawengine.agent.adjustments.apply'),
            turn: z.number().int().positive(),
          })
          .strict(),
      )
      .min(2),
    requestId: z.string().trim().min(1),
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

const dispatchResultSchema = z.looseObject({
  dispatchStatus: z.enum(['completed']),
  result: z.unknown(),
  runtimeToolName: z.string().trim().min(1),
});

const dispatchAgentTool = async ({
  args,
  requestId,
  runtimeToolName,
}: {
  args: unknown;
  requestId: string;
  runtimeToolName: string;
}): Promise<unknown> => {
  const response = dispatchResultSchema.parse(
    await handleRawEngineAppServerHostRequestAsync({
      arguments: args,
      requestId,
      runtimeToolName,
      toolName: RawEngineAppServerHostToolName.DispatchTool,
    }),
  );
  return response.result;
};

export const runAgentIterativeEditLoop = async (
  request: AgentIterativeEditLoopRequest,
): Promise<AgentIterativeEditLoopResult> => {
  const parsedRequest = agentIterativeEditLoopRequestSchema.parse(request);
  const transcript: AgentIterativeEditLoopResult['transcript'] = [];
  const initialState = agentStateGetResponseSchema.parse(
    await dispatchAgentTool({
      args: { requestId: `${parsedRequest.requestId}-state-0` },
      requestId: `${parsedRequest.requestId}-state-0`,
      runtimeToolName: AGENT_STATE_GET_TOOL_NAME,
    }),
  );
  let recipeHash = getSnapshotRecipeHash(initialState.snapshot);
  let appliedGraphRevision = 'unapplied';
  let editCount = 0;
  let previewRefreshCount = 0;
  const previewRefreshes: AgentIterativeEditLoopResult['previewRefreshes'] = [];
  const previewLineage: AgentIterativeEditLoopResult['previewLineage'] = [];
  const toolReceipts: Array<{ graphRevision: string; summary: string; toolName: string }> = [];

  transcript.push({
    detail: `initial inspect for ${parsedRequest.prompt}`,
    toolName: initialState.toolName,
    turn: 1,
  });

  for (const [index, step] of parsedRequest.steps.entries()) {
    const turn = index + 2;
    if (editCount >= parsedRequest.maxIterations) break;

    const { preview: previewRequest, ...adjustments } = step;
    const applyRequestId = `${parsedRequest.requestId}-apply-${index + 1}`;
    const apply = agentAdjustmentsApplyResponseSchema.parse(
      await dispatchAgentTool({
        args: {
          adjustments: agentLoopAdjustmentPatchSchema.parse(adjustments),
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
    toolReceipts.push({
      graphRevision: apply.appliedGraphRevision,
      summary: apply.adjustedFields.join(','),
      toolName: apply.toolName,
    });

    const stateRequestId = `${parsedRequest.requestId}-state-${index + 1}`;
    const state = agentStateGetResponseSchema.parse(
      await dispatchAgentTool({
        args: { requestId: stateRequestId },
        requestId: stateRequestId,
        runtimeToolName: AGENT_STATE_GET_TOOL_NAME,
      }),
    );
    recipeHash = getSnapshotRecipeHash(state.snapshot);
    const previewRequestId = `${parsedRequest.requestId}-preview-${index + 1}`;
    const preview = agentPreviewRenderResponseSchema.parse(
      await dispatchAgentTool({
        args: {
          crop: previewRequest?.crop,
          expectedRecipeHash: recipeHash,
          longEdgePx: previewRequest?.longEdgePx ?? 1024,
          maxPixelCount: previewRequest?.maxPixelCount,
          purpose: previewRequest?.purpose ?? 'refresh',
          quality: previewRequest?.quality ?? 0.82,
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
      previewArtifactId: preview.preview.artifactId,
      previewPurpose,
      recipeHash,
      sourceToolName: apply.toolName,
      turn,
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

  return agentIterativeEditLoopResultSchema.parse({
    appliedGraphRevision,
    editCount,
    editReview,
    finalRecipeHash: recipeHash,
    previewLineage,
    previewRefreshes,
    previewRefreshCount,
    requestId: parsedRequest.requestId,
    stopReason: editCount >= parsedRequest.maxIterations ? 'max_iterations' : 'completed',
    transcript,
  });
};
