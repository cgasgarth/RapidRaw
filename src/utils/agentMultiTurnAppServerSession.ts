import { z } from 'zod';

import { AGENT_ADJUSTMENTS_APPLY_TOOL_NAME, agentAdjustmentsApplyResponseSchema } from './agentAdjustmentApplyTool';
import { AGENT_COLOR_APPLY_TOOL_NAME, agentColorApplyResponseSchema } from './agentColorApplyTool';
import {
  AGENT_DETAIL_EFFECTS_APPLY_TOOL_NAME,
  agentDetailEffectsApplyResponseSchema,
} from './agentDetailEffectsApplyTool';
import { agentEditQualityReviewSchema, buildAgentEditQualityReview } from './agentEditQualityReview';
import { agentInitialPromptContextSchema, buildAgentInitialPromptContext } from './agentInitialPromptContext';
import { dispatchAgentLiveEditorTool } from './agentLiveToolDispatch';
import { agentPreviewEnvelopeSchema } from './agentPreviewEnvelope';
import {
  AGENT_PREVIEW_RENDER_TOOL_NAME,
  AGENT_STATE_GET_TOOL_NAME,
  agentPreviewRenderResponseSchema,
  agentStateGetResponseSchema,
} from './agentReadOnlyAppServerTools';
import { createAgentSessionCheckpoint } from './agentSessionHistory';

const sessionAdjustmentPatchSchema = z
  .object({
    blacks: z.number().min(-100).max(100).optional(),
    brightness: z.number().min(-100).max(100).optional(),
    clarity: z.number().min(-100).max(100).optional(),
    contrast: z.number().min(-100).max(100).optional(),
    exposure: z.number().min(-2).max(2).optional(),
    highlights: z.number().min(-100).max(100).optional(),
    saturation: z.number().min(-100).max(100).optional(),
    shadows: z.number().min(-100).max(100).optional(),
    temperature: z.number().min(-100).max(100).optional(),
    tint: z.number().min(-100).max(100).optional(),
    vibrance: z.number().min(-100).max(100).optional(),
    whites: z.number().min(-100).max(100).optional(),
  })
  .strict()
  .refine((patch) => Object.keys(patch).length > 0, { message: 'Session turn needs at least one adjustment.' });

const sessionPreviewRequestSchema = z
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
    purpose: z.enum(['detail_review', 'refresh']).default('refresh'),
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

const sessionTurnRequestSchema = z
  .object({
    adjustment: sessionAdjustmentPatchSchema.optional(),
    assistantRationale: z.string().trim().min(1),
    color: z.record(z.string(), z.unknown()).optional(),
    detailEffects: z.record(z.string(), z.unknown()).optional(),
    preview: sessionPreviewRequestSchema.optional(),
    userFollowUp: z.string().trim().min(1).optional(),
  })
  .strict()
  .refine((turn) => turn.adjustment !== undefined || turn.color !== undefined || turn.detailEffects !== undefined, {
    message: 'Session turn needs at least one adjustment, color, or detail/effects patch.',
  });

export const agentMultiTurnAppServerSessionRequestSchema = z
  .object({
    modelId: z.string().trim().min(1).default('gpt-5.1-codex-app-server'),
    operationId: z.string().trim().min(1),
    prompt: z.string().trim().min(1),
    requestId: z.string().trim().min(1),
    sessionId: z.string().trim().min(1),
    turns: z.array(sessionTurnRequestSchema).min(2).max(6),
  })
  .strict();

const sessionToolCallSchema = z
  .object({
    id: z.string().trim().min(1),
    name: z.string().trim().min(1),
    previewArtifactId: z.string().trim().min(1).optional(),
    receiptGraphRevision: z.string().trim().min(1).optional(),
    status: z.enum(['succeeded']),
    turn: z.number().int().nonnegative(),
  })
  .strict();

const sessionMessageSchema = z
  .object({
    content: z.string().trim().min(1),
    previewArtifactId: z.string().trim().min(1).optional(),
    role: z.enum(['assistant', 'tool', 'user']),
    toolCallId: z.string().trim().min(1).optional(),
    turn: z.number().int().nonnegative(),
  })
  .strict();

export const agentMultiTurnAppServerSessionResultSchema = z
  .object({
    changedPixelCount: z.number().int().positive(),
    changedPixelPercent: z.number().min(0).max(100),
    editReview: agentEditQualityReviewSchema,
    finalGraphRevision: z.string().trim().min(1),
    finalRecipeHash: z.string().trim().min(1),
    initialContext: agentInitialPromptContextSchema,
    maxChannelDelta: z.number().nonnegative(),
    meanLuminanceDelta: z.number().nonnegative(),
    messages: z.array(sessionMessageSchema).min(5),
    modelId: z.string().trim().min(1),
    previewLineage: z
      .array(
        z
          .object({
            artifactId: z.string().trim().min(1),
            graphRevision: z.string().trim().min(1),
            purpose: z.enum(['detail_review', 'initial_context', 'refresh']),
            recipeHash: z.string().trim().min(1),
            renderHash: z.string().trim().min(1),
            toolCallId: z.string().trim().min(1),
            turn: z.number().int().nonnegative(),
          })
          .strict(),
      )
      .min(3),
    previews: z.array(agentPreviewEnvelopeSchema).min(3),
    rollbackGraphRevision: z.string().trim().min(1),
    sampledPixelCount: z.number().int().positive(),
    sessionId: z.string().trim().min(1),
    toolCalls: z.array(sessionToolCallSchema).min(5),
    turnCount: z.number().int().min(2),
  })
  .strict();

export type AgentMultiTurnAppServerSessionRequest = z.infer<typeof agentMultiTurnAppServerSessionRequestSchema>;
export type AgentMultiTurnAppServerSessionResult = z.infer<typeof agentMultiTurnAppServerSessionResultSchema>;

const stateRecipeHashSchema = agentStateGetResponseSchema.safeExtend({
  snapshot: z.looseObject({
    initialPreview: z.looseObject({ recipeHash: z.string().trim().min(1) }),
  }),
});

const getRecipeHash = (stateResult: unknown): string =>
  stateRecipeHashSchema.parse(stateResult).snapshot.initialPreview.recipeHash;

const buildStateToolCallId = (requestId: string, turnNumber: number, suffix: string): string =>
  `${requestId}-turn-${turnNumber}-${suffix}-state`;

const refreshRecipeHash = async (requestId: string): Promise<string> =>
  getRecipeHash(
    await dispatchAgentLiveEditorTool({
      args: { requestId },
      requestId,
      runtimeToolName: AGENT_STATE_GET_TOOL_NAME,
    }),
  );

export const runAgentMultiTurnAppServerSession = async (
  request: AgentMultiTurnAppServerSessionRequest,
): Promise<AgentMultiTurnAppServerSessionResult> => {
  const parsedRequest = agentMultiTurnAppServerSessionRequestSchema.parse(request);
  const checkpoint = createAgentSessionCheckpoint(parsedRequest.sessionId);
  const initialContext = buildAgentInitialPromptContext({
    operationId: parsedRequest.operationId,
    prompt: parsedRequest.prompt,
    sessionId: parsedRequest.sessionId,
  });
  const messages: AgentMultiTurnAppServerSessionResult['messages'] = [
    {
      content: parsedRequest.prompt,
      previewArtifactId: initialContext.preview.artifactId,
      role: 'user',
      turn: 0,
    },
  ];
  const previews: AgentMultiTurnAppServerSessionResult['previews'] = [initialContext.imageContext.initialPreview];
  const previewLineage: AgentMultiTurnAppServerSessionResult['previewLineage'] = [
    {
      artifactId: initialContext.preview.artifactId,
      graphRevision: initialContext.imageContext.graphRevision,
      purpose: 'initial_context',
      recipeHash: initialContext.preview.recipeHash,
      renderHash: initialContext.preview.renderHash,
      toolCallId: `${parsedRequest.requestId}-initial-preview`,
      turn: 0,
    },
  ];
  const toolCalls: AgentMultiTurnAppServerSessionResult['toolCalls'] = [];
  let recipeHash = initialContext.preview.recipeHash;
  let finalGraphRevision = initialContext.imageContext.graphRevision;
  let changedPixelCount = 0;
  let changedPixelPercent = 0;
  let maxChannelDelta = 0;
  let meanLuminanceDelta = 0;
  let sampledPixelCount = 0;

  for (const [index, turn] of parsedRequest.turns.entries()) {
    const turnNumber = index + 1;
    if (turn.userFollowUp !== undefined) {
      messages.push({ content: turn.userFollowUp, role: 'user', turn: turnNumber });
    }
    messages.push({ content: turn.assistantRationale, role: 'assistant', turn: turnNumber });

    if (turn.adjustment !== undefined) {
      const applyToolCallId = `${parsedRequest.requestId}-turn-${turnNumber}-apply`;
      const applyResult = agentAdjustmentsApplyResponseSchema.parse(
        await dispatchAgentLiveEditorTool({
          args: {
            adjustments: turn.adjustment,
            expectedRecipeHash: recipeHash,
            operationId: `${parsedRequest.operationId}-${turnNumber}`,
            requestId: applyToolCallId,
            sessionId: parsedRequest.sessionId,
          },
          requestId: applyToolCallId,
          runtimeToolName: AGENT_ADJUSTMENTS_APPLY_TOOL_NAME,
        }),
      );
      finalGraphRevision = applyResult.appliedGraphRevision;
      changedPixelCount += applyResult.changedPixelCount;
      sampledPixelCount += applyResult.sampledPixelCount;
      maxChannelDelta = Math.max(maxChannelDelta, applyResult.maxChannelDelta);
      meanLuminanceDelta += applyResult.meanLuminanceDelta;
      toolCalls.push({
        id: applyToolCallId,
        name: applyResult.toolName,
        receiptGraphRevision: applyResult.appliedGraphRevision,
        status: 'succeeded',
        turn: turnNumber,
      });
      messages.push({
        content: `Applied ${applyResult.adjustedFields.join(', ')} at ${applyResult.appliedGraphRevision}.`,
        role: 'tool',
        toolCallId: applyToolCallId,
        turn: turnNumber,
      });
      const stateToolCallId = buildStateToolCallId(parsedRequest.requestId, turnNumber, 'adjustments');
      recipeHash = await refreshRecipeHash(stateToolCallId);
      toolCalls.push({ id: stateToolCallId, name: AGENT_STATE_GET_TOOL_NAME, status: 'succeeded', turn: turnNumber });
    }

    if (turn.color !== undefined) {
      const colorToolCallId = `${parsedRequest.requestId}-turn-${turnNumber}-color`;
      const colorResult = agentColorApplyResponseSchema.parse(
        await dispatchAgentLiveEditorTool({
          args: {
            color: turn.color,
            expectedRecipeHash: recipeHash,
            operationId: `${parsedRequest.operationId}-${turnNumber}-color`,
            requestId: colorToolCallId,
            sessionId: parsedRequest.sessionId,
          },
          requestId: colorToolCallId,
          runtimeToolName: AGENT_COLOR_APPLY_TOOL_NAME,
        }),
      );
      finalGraphRevision = colorResult.appliedGraphRevision;
      changedPixelCount += colorResult.changedPixelCount;
      sampledPixelCount += colorResult.changedPixelCount;
      toolCalls.push({
        id: colorToolCallId,
        name: colorResult.toolName,
        receiptGraphRevision: colorResult.appliedGraphRevision,
        status: 'succeeded',
        turn: turnNumber,
      });
      messages.push({
        content: `Applied color ${colorResult.adjustedFields.join(', ')} at ${colorResult.appliedGraphRevision}.`,
        role: 'tool',
        toolCallId: colorToolCallId,
        turn: turnNumber,
      });
      const stateToolCallId = buildStateToolCallId(parsedRequest.requestId, turnNumber, 'color');
      recipeHash = await refreshRecipeHash(stateToolCallId);
      toolCalls.push({ id: stateToolCallId, name: AGENT_STATE_GET_TOOL_NAME, status: 'succeeded', turn: turnNumber });
    }

    if (turn.detailEffects !== undefined) {
      const detailToolCallId = `${parsedRequest.requestId}-turn-${turnNumber}-detail`;
      const detailResult = agentDetailEffectsApplyResponseSchema.parse(
        await dispatchAgentLiveEditorTool({
          args: {
            detailEffects: turn.detailEffects,
            expectedRecipeHash: recipeHash,
            operationId: `${parsedRequest.operationId}-${turnNumber}-detail`,
            requestId: detailToolCallId,
            sessionId: parsedRequest.sessionId,
          },
          requestId: detailToolCallId,
          runtimeToolName: AGENT_DETAIL_EFFECTS_APPLY_TOOL_NAME,
        }),
      );
      finalGraphRevision = detailResult.appliedGraphRevision;
      changedPixelCount += detailResult.changedPixelCount;
      sampledPixelCount += detailResult.changedPixelCount;
      toolCalls.push({
        id: detailToolCallId,
        name: detailResult.toolName,
        receiptGraphRevision: detailResult.appliedGraphRevision,
        status: 'succeeded',
        turn: turnNumber,
      });
      messages.push({
        content: `Applied detail ${detailResult.adjustedFields.join(', ')} at ${detailResult.appliedGraphRevision}.`,
        role: 'tool',
        toolCallId: detailToolCallId,
        turn: turnNumber,
      });
      const stateToolCallId = buildStateToolCallId(parsedRequest.requestId, turnNumber, 'detail');
      recipeHash = await refreshRecipeHash(stateToolCallId);
      toolCalls.push({ id: stateToolCallId, name: AGENT_STATE_GET_TOOL_NAME, status: 'succeeded', turn: turnNumber });
    }

    changedPixelPercent =
      sampledPixelCount === 0 ? 0 : Number(((changedPixelCount / sampledPixelCount) * 100).toFixed(1));

    const previewToolCallId = `${parsedRequest.requestId}-turn-${turnNumber}-preview`;
    const previewResult = agentPreviewRenderResponseSchema.parse(
      await dispatchAgentLiveEditorTool({
        args: {
          ...turn.preview,
          expectedRecipeHash: recipeHash,
          requestId: previewToolCallId,
        },
        requestId: previewToolCallId,
        runtimeToolName: AGENT_PREVIEW_RENDER_TOOL_NAME,
      }),
    );
    previews.push(previewResult.preview);
    previewLineage.push({
      artifactId: previewResult.preview.artifactId,
      graphRevision: finalGraphRevision,
      purpose: previewResult.preview.purpose,
      recipeHash: previewResult.preview.recipeHash,
      renderHash: previewResult.preview.renderHash,
      toolCallId: previewToolCallId,
      turn: turnNumber,
    });
    toolCalls.push({
      id: previewToolCallId,
      name: previewResult.toolName,
      previewArtifactId: previewResult.preview.artifactId,
      status: 'succeeded',
      turn: turnNumber,
    });
    messages.push({
      content: `Preview ${previewResult.preview.artifactId} is ready for inspection.`,
      previewArtifactId: previewResult.preview.artifactId,
      role: 'tool',
      toolCallId: previewToolCallId,
      turn: turnNumber,
    });
  }

  const beforePreview = previews[0];
  const afterPreview = previews.at(-1);
  if (beforePreview === undefined || afterPreview === undefined) {
    throw new Error('Agent multi-turn session requires before and after previews.');
  }
  const editReview = buildAgentEditQualityReview({
    beforePreview,
    maxIterationsReached: false,
    preview: afterPreview,
    prompt: parsedRequest.prompt,
    toolReceiptCount: toolCalls.filter((toolCall) => toolCall.name === AGENT_ADJUSTMENTS_APPLY_TOOL_NAME).length,
    toolReceipts: toolCalls
      .filter((toolCall) => toolCall.receiptGraphRevision !== undefined)
      .map((toolCall) => ({
        graphRevision: toolCall.receiptGraphRevision ?? finalGraphRevision,
        summary: toolCall.name,
        toolName: toolCall.name,
      })),
  });
  messages.push({ content: editReview.finalRationale, role: 'assistant', turn: parsedRequest.turns.length + 1 });

  return agentMultiTurnAppServerSessionResultSchema.parse({
    changedPixelCount,
    changedPixelPercent,
    editReview,
    finalGraphRevision,
    finalRecipeHash: recipeHash,
    initialContext,
    maxChannelDelta,
    meanLuminanceDelta: Number((meanLuminanceDelta / parsedRequest.turns.length).toFixed(4)),
    messages,
    modelId: parsedRequest.modelId,
    previewLineage,
    previews,
    rollbackGraphRevision: checkpoint.graphRevision,
    sampledPixelCount,
    sessionId: parsedRequest.sessionId,
    toolCalls,
    turnCount: parsedRequest.turns.length,
  });
};
