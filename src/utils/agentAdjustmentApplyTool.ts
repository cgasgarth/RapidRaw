import { z } from 'zod';

import { buildAgentImageContextSnapshot } from './agentImageContextSnapshot';
import { applyBasicToneToLiveEditor } from './agentLiveBasicTone';
import { BASIC_TONE_ADJUSTMENT_KEYS, type LegacyBasicToneAdjustmentPayload } from './basicToneCommandBridge';
import { pushEditHistoryEntry } from './editHistory';
import { useEditorStore } from '../store/useEditorStore';

import type { Adjustments } from './adjustments';

export const AGENT_ADJUSTMENTS_APPLY_TOOL_NAME = 'rawengine.agent.adjustments.apply';
export const AGENT_ADJUSTMENTS_APPLY_INPUT_SCHEMA_NAME = 'AgentAdjustmentsApplyRequestV1';
export const AGENT_ADJUSTMENTS_APPLY_OUTPUT_SCHEMA_NAME = 'AgentAdjustmentsApplyResponseV1';

const agentGlobalAdjustmentPatchSchema = z
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
  .refine((patch) => Object.keys(patch).length > 0, { message: 'At least one global adjustment is required.' });

export const agentAdjustmentsApplyRequestSchema = z
  .object({
    adjustments: agentGlobalAdjustmentPatchSchema,
    expectedRecipeHash: z.string().trim().min(1),
    operationId: z.string().trim().min(1),
    requestId: z.string().trim().min(1),
    sessionId: z.string().trim().min(1),
  })
  .strict();

export const agentAdjustmentsApplyResponseSchema = z
  .object({
    adjustedFields: z.array(z.string().trim().min(1)).min(1),
    afterPreviewHash: z.string().trim().min(1),
    appliedGraphRevision: z.string().trim().min(1),
    beforePreviewHash: z.string().trim().min(1),
    changedPixelCount: z.number().int().positive(),
    changedPixelPercent: z.number().min(0).max(100),
    maxChannelDelta: z.number().nonnegative(),
    meanLuminanceDelta: z.number().nonnegative(),
    receipt: z
      .object({
        adjustedFields: z.array(z.string().trim().min(1)).min(1),
        afterPreviewHash: z.string().trim().min(1),
        appliedGraphRevision: z.string().trim().min(1),
        beforePreviewHash: z.string().trim().min(1),
        operationId: z.string().trim().min(1),
        sessionId: z.string().trim().min(1),
        undoGraphRevision: z.string().trim().min(1),
      })
      .strict(),
    requestId: z.string().trim().min(1),
    sampledPixelCount: z.number().int().positive(),
    staleRecipeHash: z.literal(false),
    toolName: z.literal(AGENT_ADJUSTMENTS_APPLY_TOOL_NAME),
    undoGraphRevision: z.string().trim().min(1),
  })
  .strict();

export type AgentAdjustmentsApplyRequest = z.infer<typeof agentAdjustmentsApplyRequestSchema>;
export type AgentAdjustmentsApplyResponse = z.infer<typeof agentAdjustmentsApplyResponseSchema>;

const EXTRA_ADJUSTMENT_KEYS = ['temperature', 'tint', 'vibrance'] as const satisfies ReadonlyArray<keyof Adjustments>;

const buildRequestedBasicTone = (
  base: Adjustments,
  patch: z.infer<typeof agentGlobalAdjustmentPatchSchema>,
): LegacyBasicToneAdjustmentPayload => ({
  blacks: patch.blacks ?? base.blacks,
  brightness: patch.brightness ?? base.brightness,
  clarity: patch.clarity ?? base.clarity,
  contrast: patch.contrast ?? base.contrast,
  exposure: patch.exposure ?? base.exposure,
  highlights: patch.highlights ?? base.highlights,
  saturation: patch.saturation ?? base.saturation,
  shadows: patch.shadows ?? base.shadows,
  whites: patch.whites ?? base.whites,
});

export const applyAgentGlobalAdjustments = async (
  request: AgentAdjustmentsApplyRequest,
): Promise<AgentAdjustmentsApplyResponse> => {
  const parsedRequest = agentAdjustmentsApplyRequestSchema.parse(request);
  const snapshot = buildAgentImageContextSnapshot();
  if (parsedRequest.expectedRecipeHash !== snapshot.initialPreview.recipeHash) {
    throw new Error('Agent adjustment apply rejected stale recipe hash.');
  }

  const initialState = useEditorStore.getState();
  const undoGraphRevision = `history_${initialState.historyIndex}`;
  const basicToneResult = await applyBasicToneToLiveEditor({
    operationId: parsedRequest.operationId,
    requestedAdjustments: buildRequestedBasicTone(initialState.adjustments, parsedRequest.adjustments),
    sessionId: parsedRequest.sessionId,
  });

  const extraEntries = EXTRA_ADJUSTMENT_KEYS.flatMap((key) => {
    const value = parsedRequest.adjustments[key];
    return value === undefined ? [] : [{ key, value }];
  });

  if (extraEntries.length > 0) {
    useEditorStore.setState((state) => {
      const adjustments = { ...state.adjustments };
      for (const entry of extraEntries) {
        adjustments[entry.key] = entry.value;
      }
      const history = pushEditHistoryEntry(state.history.slice(0, -1), state.historyIndex - 1, adjustments);
      return {
        adjustments,
        history: history.history,
        historyIndex: history.historyIndex,
        uncroppedAdjustedPreviewUrl: null,
      };
    });
  }

  const adjustedFields = [
    ...BASIC_TONE_ADJUSTMENT_KEYS.filter((key) => parsedRequest.adjustments[key] !== undefined),
    ...EXTRA_ADJUSTMENT_KEYS.filter((key) => parsedRequest.adjustments[key] !== undefined),
  ];
  const appliedGraphRevision = `history_${useEditorStore.getState().historyIndex}`;

  return agentAdjustmentsApplyResponseSchema.parse({
    adjustedFields,
    afterPreviewHash: basicToneResult.afterPreviewHash,
    appliedGraphRevision,
    beforePreviewHash: basicToneResult.beforePreviewHash,
    changedPixelCount: basicToneResult.changedPixelCount,
    changedPixelPercent: basicToneResult.changedPixelPercent,
    maxChannelDelta: basicToneResult.maxChannelDelta,
    meanLuminanceDelta: basicToneResult.meanLuminanceDelta,
    receipt: {
      adjustedFields,
      afterPreviewHash: basicToneResult.afterPreviewHash,
      appliedGraphRevision,
      beforePreviewHash: basicToneResult.beforePreviewHash,
      operationId: parsedRequest.operationId,
      sessionId: parsedRequest.sessionId,
      undoGraphRevision,
    },
    requestId: parsedRequest.requestId,
    sampledPixelCount: basicToneResult.sampledPixelCount,
    staleRecipeHash: false,
    toolName: AGENT_ADJUSTMENTS_APPLY_TOOL_NAME,
    undoGraphRevision,
  });
};
