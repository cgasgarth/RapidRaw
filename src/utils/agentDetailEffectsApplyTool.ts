import { z } from 'zod';

import { buildAgentImageContextSnapshot } from './agentImageContextSnapshot';
import { pushEditHistoryEntry } from './editHistory';
import { useEditorStore } from '../store/useEditorStore';

import type { Adjustments } from './adjustments';

export const AGENT_DETAIL_EFFECTS_APPLY_TOOL_NAME = 'rawengine.agent.detail_effects.apply';
export const AGENT_DETAIL_EFFECTS_APPLY_INPUT_SCHEMA_NAME = 'AgentDetailEffectsApplyRequestV1';
export const AGENT_DETAIL_EFFECTS_APPLY_OUTPUT_SCHEMA_NAME = 'AgentDetailEffectsApplyResponseV1';

const agentDetailEffectsPatchSchema = z
  .object({
    chromaticAberrationBlueYellow: z.number().min(-100).max(100).optional(),
    chromaticAberrationRedCyan: z.number().min(-100).max(100).optional(),
    clarity: z.number().min(-100).max(100).optional(),
    colorNoiseReduction: z.number().min(0).max(100).optional(),
    deblurEnabled: z.boolean().optional(),
    deblurSigmaPx: z.number().min(0.45).max(1.35).optional(),
    deblurStrength: z.number().min(0).max(100).optional(),
    dehaze: z.number().min(-100).max(100).optional(),
    dustSpotMinRadiusPx: z.number().int().min(1).max(12).optional(),
    dustSpotOverlayEnabled: z.boolean().optional(),
    dustSpotSensitivity: z.number().int().min(0).max(100).optional(),
    flareAmount: z.number().min(0).max(100).optional(),
    glowAmount: z.number().min(0).max(100).optional(),
    grainAmount: z.number().min(0).max(100).optional(),
    grainRoughness: z.number().min(0).max(100).optional(),
    grainSize: z.number().min(0).max(100).optional(),
    halationAmount: z.number().min(0).max(100).optional(),
    localContrastHaloGuard: z.number().min(0).max(100).optional(),
    localContrastMidtoneMask: z.number().min(0).max(100).optional(),
    localContrastRadiusPx: z.number().min(4).max(96).optional(),
    lumaNoiseReduction: z.number().min(0).max(100).optional(),
    sharpness: z.number().min(-100).max(100).optional(),
    sharpnessThreshold: z.number().min(0).max(80).optional(),
    structure: z.number().min(-100).max(100).optional(),
    vignetteAmount: z.number().min(-100).max(100).optional(),
    vignetteFeather: z.number().min(0).max(100).optional(),
    vignetteMidpoint: z.number().min(0).max(100).optional(),
    vignetteRoundness: z.number().min(-100).max(100).optional(),
  })
  .strict()
  .refine((patch) => Object.keys(patch).length > 0, {
    message: 'At least one detail or effect adjustment is required.',
  });

export const agentDetailEffectsApplyRequestSchema = z
  .object({
    detailEffects: agentDetailEffectsPatchSchema,
    expectedRecipeHash: z.string().trim().min(1),
    operationId: z.string().trim().min(1),
    requestId: z.string().trim().min(1),
    sessionId: z.string().trim().min(1),
  })
  .strict();

export const agentDetailEffectsApplyResponseSchema = z
  .object({
    adjustedFields: z.array(z.string().trim().min(1)).min(1),
    afterPreviewHash: z.string().trim().min(1),
    appliedGraphRevision: z.string().trim().min(1),
    beforePreviewHash: z.string().trim().min(1),
    changedPixelCount: z.number().int().positive(),
    receipt: z
      .object({
        adjustedFields: z.array(z.string().trim().min(1)).min(1),
        appliedGraphRevision: z.string().trim().min(1),
        operationId: z.string().trim().min(1),
        sessionId: z.string().trim().min(1),
        undoGraphRevision: z.string().trim().min(1),
      })
      .strict(),
    requestId: z.string().trim().min(1),
    staleRecipeHash: z.literal(false),
    toolName: z.literal(AGENT_DETAIL_EFFECTS_APPLY_TOOL_NAME),
    undoGraphRevision: z.string().trim().min(1),
  })
  .strict();

export type AgentDetailEffectsApplyRequest = z.infer<typeof agentDetailEffectsApplyRequestSchema>;
export type AgentDetailEffectsApplyResponse = z.infer<typeof agentDetailEffectsApplyResponseSchema>;
type AgentDetailEffectsPatch = z.infer<typeof agentDetailEffectsPatchSchema>;

const DETAIL_EFFECTS_PATCH_KEYS = [
  'chromaticAberrationBlueYellow',
  'chromaticAberrationRedCyan',
  'clarity',
  'colorNoiseReduction',
  'deblurEnabled',
  'deblurSigmaPx',
  'deblurStrength',
  'dehaze',
  'dustSpotMinRadiusPx',
  'dustSpotOverlayEnabled',
  'dustSpotSensitivity',
  'flareAmount',
  'glowAmount',
  'grainAmount',
  'grainRoughness',
  'grainSize',
  'halationAmount',
  'localContrastHaloGuard',
  'localContrastMidtoneMask',
  'localContrastRadiusPx',
  'lumaNoiseReduction',
  'sharpness',
  'sharpnessThreshold',
  'structure',
  'vignetteAmount',
  'vignetteFeather',
  'vignetteMidpoint',
  'vignetteRoundness',
] as const satisfies ReadonlyArray<keyof AgentDetailEffectsPatch>;

const applyDetailEffectsPatchToAdjustments = (base: Adjustments, patch: AgentDetailEffectsPatch): Adjustments => {
  const next: Adjustments = { ...base };
  if (patch.chromaticAberrationBlueYellow !== undefined)
    next.chromaticAberrationBlueYellow = patch.chromaticAberrationBlueYellow;
  if (patch.chromaticAberrationRedCyan !== undefined)
    next.chromaticAberrationRedCyan = patch.chromaticAberrationRedCyan;
  if (patch.clarity !== undefined) next.clarity = patch.clarity;
  if (patch.colorNoiseReduction !== undefined) next.colorNoiseReduction = patch.colorNoiseReduction;
  if (patch.deblurEnabled !== undefined) next.deblurEnabled = patch.deblurEnabled;
  if (patch.deblurSigmaPx !== undefined) next.deblurSigmaPx = patch.deblurSigmaPx;
  if (patch.deblurStrength !== undefined) next.deblurStrength = patch.deblurStrength;
  if (patch.dehaze !== undefined) next.dehaze = patch.dehaze;
  if (patch.dustSpotMinRadiusPx !== undefined) next.dustSpotMinRadiusPx = patch.dustSpotMinRadiusPx;
  if (patch.dustSpotOverlayEnabled !== undefined) next.dustSpotOverlayEnabled = patch.dustSpotOverlayEnabled;
  if (patch.dustSpotSensitivity !== undefined) next.dustSpotSensitivity = patch.dustSpotSensitivity;
  if (patch.flareAmount !== undefined) next.flareAmount = patch.flareAmount;
  if (patch.glowAmount !== undefined) next.glowAmount = patch.glowAmount;
  if (patch.grainAmount !== undefined) next.grainAmount = patch.grainAmount;
  if (patch.grainRoughness !== undefined) next.grainRoughness = patch.grainRoughness;
  if (patch.grainSize !== undefined) next.grainSize = patch.grainSize;
  if (patch.halationAmount !== undefined) next.halationAmount = patch.halationAmount;
  if (patch.localContrastHaloGuard !== undefined) next.localContrastHaloGuard = patch.localContrastHaloGuard;
  if (patch.localContrastMidtoneMask !== undefined) next.localContrastMidtoneMask = patch.localContrastMidtoneMask;
  if (patch.localContrastRadiusPx !== undefined) next.localContrastRadiusPx = patch.localContrastRadiusPx;
  if (patch.lumaNoiseReduction !== undefined) next.lumaNoiseReduction = patch.lumaNoiseReduction;
  if (patch.sharpness !== undefined) next.sharpness = patch.sharpness;
  if (patch.sharpnessThreshold !== undefined) next.sharpnessThreshold = patch.sharpnessThreshold;
  if (patch.structure !== undefined) next.structure = patch.structure;
  if (patch.vignetteAmount !== undefined) next.vignetteAmount = patch.vignetteAmount;
  if (patch.vignetteFeather !== undefined) next.vignetteFeather = patch.vignetteFeather;
  if (patch.vignetteMidpoint !== undefined) next.vignetteMidpoint = patch.vignetteMidpoint;
  if (patch.vignetteRoundness !== undefined) next.vignetteRoundness = patch.vignetteRoundness;
  return next;
};

const estimateChangedPixels = ({
  after,
  before,
  imageArea,
}: {
  after: Adjustments;
  before: Adjustments;
  imageArea: number;
}) => {
  const changedFieldCount = DETAIL_EFFECTS_PATCH_KEYS.filter(
    (key) => JSON.stringify(before[key]) !== JSON.stringify(after[key]),
  ).length;
  return Math.max(1, Math.round((imageArea / 512) * Math.max(1, changedFieldCount)));
};

export const applyAgentDetailEffects = (request: AgentDetailEffectsApplyRequest): AgentDetailEffectsApplyResponse => {
  const parsedRequest = agentDetailEffectsApplyRequestSchema.parse(request);
  const snapshot = buildAgentImageContextSnapshot();
  if (parsedRequest.expectedRecipeHash !== snapshot.initialPreview.recipeHash) {
    throw new Error('Agent detail/effects apply rejected stale recipe hash.');
  }

  const state = useEditorStore.getState();
  const selectedImage = state.selectedImage;
  if (selectedImage === null) throw new Error('Agent detail/effects apply requires a selected image.');

  const undoGraphRevision = `history_${state.historyIndex}`;
  const nextAdjustments = applyDetailEffectsPatchToAdjustments(state.adjustments, parsedRequest.detailEffects);
  const history = pushEditHistoryEntry(state.history, state.historyIndex, nextAdjustments);
  useEditorStore.setState({
    adjustments: nextAdjustments,
    history: history.history,
    historyIndex: history.historyIndex,
    uncroppedAdjustedPreviewUrl: null,
  });

  const afterSnapshot = buildAgentImageContextSnapshot();
  const adjustedFields = DETAIL_EFFECTS_PATCH_KEYS.filter((key) => parsedRequest.detailEffects[key] !== undefined);
  const appliedGraphRevision = `history_${useEditorStore.getState().historyIndex}`;

  return agentDetailEffectsApplyResponseSchema.parse({
    adjustedFields,
    afterPreviewHash: afterSnapshot.initialPreview.renderHash,
    appliedGraphRevision,
    beforePreviewHash: snapshot.initialPreview.renderHash,
    changedPixelCount: estimateChangedPixels({
      after: nextAdjustments,
      before: state.adjustments,
      imageArea: selectedImage.width * selectedImage.height,
    }),
    receipt: {
      adjustedFields,
      appliedGraphRevision,
      operationId: parsedRequest.operationId,
      sessionId: parsedRequest.sessionId,
      undoGraphRevision,
    },
    requestId: parsedRequest.requestId,
    staleRecipeHash: false,
    toolName: AGENT_DETAIL_EFFECTS_APPLY_TOOL_NAME,
    undoGraphRevision,
  });
};
