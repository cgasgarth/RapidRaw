import { z } from 'zod';
import type { EditDocumentNodeParamsV2 } from '../../../../packages/rawengine-schema/src/editDocumentV2';
import type { RawEngineLocalAppServerBridge } from '../../../../packages/rawengine-schema/src/localAppServerBridge';
import {
  ActorKind,
  ApprovalClass,
  type DetailEffectsCommandEnvelopeV1,
  type DetailEffectsMutationResultV1,
  detailEffectsDryRunResultV1Schema,
  detailEffectsMutationResultV1Schema,
  RAW_ENGINE_SCHEMA_VERSION,
} from '../../../../packages/rawengine-schema/src/rawEngineSchemas';
import { useEditorStore } from '../../../store/useEditorStore';
import { buildAgentToolEditTransaction, captureAgentToolCommitIdentity } from '../../agentToolEditTransaction';
import { selectEditDocumentNode } from '../../editDocumentSelectors';
import { buildAgentImageContextSnapshot } from '../context/agentImageContextSnapshot';
import { createLiveEditorAppServerBridge } from '../session/agentLiveEditorCoreState';

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
    denoiseContrastProtection: z.number().min(0).max(100).optional(),
    denoiseDetail: z.number().min(0).max(100).optional(),
    denoiseNaturalGrain: z.number().min(0).max(100).optional(),
    denoiseShadowBias: z.number().min(-100).max(100).optional(),
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
    adjustedFields: z.array(z.string().trim().min(1)),
    afterPreviewHash: z.string().trim().min(1),
    appliedGraphRevision: z.string().trim().min(1),
    beforePreviewHash: z.string().trim().min(1),
    changedPixelCount: z.number().int().nonnegative(),
    receipt: z
      .object({
        adjustedFields: z.array(z.string().trim().min(1)),
        appliedGraphRevision: z.string().trim().min(1),
        operationId: z.string().trim().min(1),
        sessionId: z.string().trim().min(1),
        typedCommand: z
          .object({
            appliedGraphRevision: z.string().trim().min(1),
            changedNodeIds: z.array(z.string().trim().min(1)).min(1),
            commandId: z.string().trim().min(1),
            commandType: z.literal('detailEffects.applyAdjustments'),
            dryRunPlanHash: z.string().trim().min(1),
            dryRunPlanId: z.string().trim().min(1),
            provenanceEntryIds: z.array(z.string().trim().min(1)).min(1),
            sourceGraphRevision: z.string().trim().min(1),
          })
          .strict()
          .optional(),
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
  'denoiseContrastProtection',
  'denoiseDetail',
  'denoiseNaturalGrain',
  'denoiseShadowBias',
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

type DetailEffectsView = EditDocumentNodeParamsV2<'detail_denoise_dehaze'> &
  EditDocumentNodeParamsV2<'display_creative'> &
  EditDocumentNodeParamsV2<'lens_correction'>;

const applyDetailEffectsPatchToAdjustments = (
  base: DetailEffectsView,
  patch: AgentDetailEffectsPatch,
): DetailEffectsView => {
  const next: DetailEffectsView = { ...base };
  if (patch.chromaticAberrationBlueYellow !== undefined)
    next.chromaticAberrationBlueYellow = patch.chromaticAberrationBlueYellow;
  if (patch.chromaticAberrationRedCyan !== undefined)
    next.chromaticAberrationRedCyan = patch.chromaticAberrationRedCyan;
  if (patch.clarity !== undefined) next.clarity = patch.clarity;
  if (patch.colorNoiseReduction !== undefined) next.colorNoiseReduction = patch.colorNoiseReduction;
  if (patch.deblurEnabled !== undefined) next.deblurEnabled = patch.deblurEnabled;
  if (patch.deblurSigmaPx !== undefined) next.deblurSigmaPx = patch.deblurSigmaPx;
  if (patch.deblurStrength !== undefined) next.deblurStrength = patch.deblurStrength;
  if (patch.denoiseContrastProtection !== undefined) next.denoiseContrastProtection = patch.denoiseContrastProtection;
  if (patch.denoiseDetail !== undefined) next.denoiseDetail = patch.denoiseDetail;
  if (patch.denoiseNaturalGrain !== undefined) next.denoiseNaturalGrain = patch.denoiseNaturalGrain;
  if (patch.denoiseShadowBias !== undefined) next.denoiseShadowBias = patch.denoiseShadowBias;
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
  after: DetailEffectsView;
  before: DetailEffectsView;
  imageArea: number;
}) => {
  const changedFieldCount = DETAIL_EFFECTS_PATCH_KEYS.filter(
    (key) => JSON.stringify(before[key]) !== JSON.stringify(after[key]),
  ).length;
  return changedFieldCount === 0 ? 0 : Math.max(1, Math.round((imageArea / 512) * changedFieldCount));
};

const buildAgentDetailEffectsCommand = ({
  approval,
  commandId,
  commandType,
  dryRun,
  expectedGraphRevision,
  imagePath,
  parameters,
  request,
}: {
  approval:
    | { approvalClass: typeof ApprovalClass.PreviewOnly; reason: string; state: 'not_required' }
    | { approvalClass: typeof ApprovalClass.EditApply; reason: string; state: 'approved' };
  commandId: string;
  commandType: 'detailEffects.dryRunAdjustments' | 'detailEffects.applyAdjustments';
  dryRun: boolean;
  expectedGraphRevision: string;
  imagePath: string;
  parameters: AgentDetailEffectsPatch & {
    acceptedDryRunPlanHash?: string;
    acceptedDryRunPlanId?: string;
  };
  request: AgentDetailEffectsApplyRequest;
}): DetailEffectsCommandEnvelopeV1 =>
  ({
    actor: {
      id: 'rawengine-agent',
      kind: ActorKind.Agent,
      sessionId: request.sessionId,
    },
    approval,
    commandId,
    commandType,
    correlationId: `corr_${request.operationId}`,
    dryRun,
    expectedGraphRevision,
    idempotencyKey: `${request.operationId}:${commandType}`,
    parameters,
    schemaVersion: RAW_ENGINE_SCHEMA_VERSION,
    target: {
      imagePath,
      kind: 'image',
    },
  }) as DetailEffectsCommandEnvelopeV1;

const dispatchTypedDetailEffectsApply = async (
  {
    expectedGraphRevision,
    imagePath,
    request,
  }: {
    expectedGraphRevision: string;
    imagePath: string;
    request: AgentDetailEffectsApplyRequest;
  },
  bridge: RawEngineLocalAppServerBridge = createLiveEditorAppServerBridge(),
): Promise<DetailEffectsMutationResultV1> => {
  const dryRunCommand = buildAgentDetailEffectsCommand({
    approval: {
      approvalClass: ApprovalClass.PreviewOnly,
      reason: 'Preview agent detail/effects patch through typed command dispatch.',
      state: 'not_required',
    },
    commandId: `${request.operationId}_dry_run`,
    commandType: 'detailEffects.dryRunAdjustments',
    dryRun: true,
    expectedGraphRevision,
    imagePath,
    parameters: request.detailEffects,
    request,
  });
  const dryRun = await bridge.dispatch(dryRunCommand, { requestId: request.requestId, now: () => new Date() });
  if (!dryRun.ok) throw new Error(`Agent detail/effects typed dry-run failed: ${dryRun.message}`);
  const dryRunResult = detailEffectsDryRunResultV1Schema.parse(dryRun.result);
  if (dryRunResult.sourceGraphRevision !== expectedGraphRevision) {
    throw new Error('Agent detail/effects typed dry-run receipt did not match the editor graph revision.');
  }

  const applyCommand = buildAgentDetailEffectsCommand({
    approval: {
      approvalClass: ApprovalClass.EditApply,
      reason: 'Apply accepted agent detail/effects dry-run plan through typed command dispatch.',
      state: 'approved',
    },
    commandId: `${request.operationId}_apply`,
    commandType: 'detailEffects.applyAdjustments',
    dryRun: false,
    expectedGraphRevision,
    imagePath,
    parameters: {
      ...request.detailEffects,
      acceptedDryRunPlanHash: dryRunResult.dryRunPlanHash,
      acceptedDryRunPlanId: dryRunResult.dryRunPlanId,
    },
    request,
  });
  const apply = await bridge.dispatch(applyCommand, { requestId: request.requestId, now: () => new Date() });
  if (!apply.ok) throw new Error(`Agent detail/effects typed apply failed: ${apply.message}`);
  return detailEffectsMutationResultV1Schema.parse(apply.result);
};

export const applyAgentDetailEffects = async (
  request: AgentDetailEffectsApplyRequest,
  bridge: RawEngineLocalAppServerBridge = createLiveEditorAppServerBridge(),
): Promise<AgentDetailEffectsApplyResponse> => {
  const parsedRequest = agentDetailEffectsApplyRequestSchema.parse(request);
  const snapshot = buildAgentImageContextSnapshot();
  if (parsedRequest.expectedRecipeHash !== snapshot.initialPreview.recipeHash) {
    throw new Error('Agent detail/effects apply rejected stale recipe hash.');
  }

  const state = useEditorStore.getState();
  const selectedImage = state.selectedImage;
  if (selectedImage === null) throw new Error('Agent detail/effects apply requires a selected image.');
  const commitIdentity = captureAgentToolCommitIdentity(state);
  if (commitIdentity === null) throw new Error('Agent detail/effects apply requires a selected image session.');

  const undoGraphRevision = `history_${state.historyIndex}`;
  const beforeAdjustments: DetailEffectsView = {
    ...selectEditDocumentNode(state.editDocumentV2, 'detail_denoise_dehaze').params,
    ...selectEditDocumentNode(state.editDocumentV2, 'display_creative').params,
    ...selectEditDocumentNode(state.editDocumentV2, 'lens_correction').params,
  };
  const nextAdjustments = applyDetailEffectsPatchToAdjustments(beforeAdjustments, parsedRequest.detailEffects);
  const adjustedFields = DETAIL_EFFECTS_PATCH_KEYS.filter(
    (key) =>
      parsedRequest.detailEffects[key] !== undefined &&
      JSON.stringify(beforeAdjustments[key]) !== JSON.stringify(nextAdjustments[key]),
  );
  const typedMutation =
    adjustedFields.length === 0
      ? undefined
      : await dispatchTypedDetailEffectsApply(
          {
            expectedGraphRevision: undoGraphRevision,
            imagePath: selectedImage.path,
            request: parsedRequest,
          },
          bridge,
        );
  const currentState = useEditorStore.getState();
  currentState.applyEditTransaction(
    buildAgentToolEditTransaction(
      currentState,
      commitIdentity,
      [
        {
          nodeType: 'detail_denoise_dehaze',
          patch: {
            clarity: nextAdjustments.clarity,
            colorNoiseReduction: nextAdjustments.colorNoiseReduction,
            deblurEnabled: nextAdjustments.deblurEnabled,
            deblurSigmaPx: nextAdjustments.deblurSigmaPx,
            deblurStrength: nextAdjustments.deblurStrength,
            dehaze: nextAdjustments.dehaze,
            denoiseContrastProtection: nextAdjustments.denoiseContrastProtection,
            denoiseDetail: nextAdjustments.denoiseDetail,
            denoiseNaturalGrain: nextAdjustments.denoiseNaturalGrain,
            denoiseShadowBias: nextAdjustments.denoiseShadowBias,
            localContrastHaloGuard: nextAdjustments.localContrastHaloGuard,
            localContrastMidtoneMask: nextAdjustments.localContrastMidtoneMask,
            localContrastRadiusPx: nextAdjustments.localContrastRadiusPx,
            lumaNoiseReduction: nextAdjustments.lumaNoiseReduction,
            sharpness: nextAdjustments.sharpness,
            sharpnessThreshold: nextAdjustments.sharpnessThreshold,
            structure: nextAdjustments.structure,
          },
          type: 'patch-edit-document-node',
        },
        {
          nodeType: 'display_creative',
          patch: {
            flareAmount: nextAdjustments.flareAmount,
            glowAmount: nextAdjustments.glowAmount,
            grainAmount: nextAdjustments.grainAmount,
            grainRoughness: nextAdjustments.grainRoughness,
            grainSize: nextAdjustments.grainSize,
            halationAmount: nextAdjustments.halationAmount,
            vignetteAmount: nextAdjustments.vignetteAmount,
            vignetteFeather: nextAdjustments.vignetteFeather,
            vignetteMidpoint: nextAdjustments.vignetteMidpoint,
            vignetteRoundness: nextAdjustments.vignetteRoundness,
          },
          type: 'patch-edit-document-node',
        },
        {
          nodeType: 'lens_correction',
          patch: {
            chromaticAberrationBlueYellow: nextAdjustments.chromaticAberrationBlueYellow,
            chromaticAberrationRedCyan: nextAdjustments.chromaticAberrationRedCyan,
          },
          type: 'patch-edit-document-node',
        },
        {
          patch: {
            dustSpotMinRadiusPx: nextAdjustments.dustSpotMinRadiusPx,
            dustSpotOverlayEnabled: nextAdjustments.dustSpotOverlayEnabled,
            dustSpotSensitivity: nextAdjustments.dustSpotSensitivity,
          },
          nodeType: 'detail_denoise_dehaze',
          type: 'patch-edit-document-node',
        },
      ],
      `${parsedRequest.operationId}_apply`,
    ),
  );

  const afterSnapshot = buildAgentImageContextSnapshot();
  const appliedGraphRevision = `history_${useEditorStore.getState().historyIndex}`;

  return agentDetailEffectsApplyResponseSchema.parse({
    adjustedFields,
    afterPreviewHash: afterSnapshot.initialPreview.renderHash,
    appliedGraphRevision,
    beforePreviewHash: snapshot.initialPreview.renderHash,
    changedPixelCount: estimateChangedPixels({
      after: nextAdjustments,
      before: beforeAdjustments,
      imageArea: selectedImage.width * selectedImage.height,
    }),
    receipt: {
      adjustedFields,
      appliedGraphRevision,
      operationId: parsedRequest.operationId,
      sessionId: parsedRequest.sessionId,
      ...(typedMutation === undefined
        ? {}
        : {
            typedCommand: {
              appliedGraphRevision: typedMutation.appliedGraphRevision,
              changedNodeIds: typedMutation.changedNodeIds,
              commandId: typedMutation.commandId,
              commandType: typedMutation.commandType,
              dryRunPlanHash: typedMutation.dryRunPlanHash,
              dryRunPlanId: typedMutation.dryRunPlanId,
              provenanceEntryIds: typedMutation.provenanceEntryIds,
              sourceGraphRevision: typedMutation.sourceGraphRevision,
            },
          }),
      undoGraphRevision,
    },
    requestId: parsedRequest.requestId,
    staleRecipeHash: false,
    toolName: AGENT_DETAIL_EFFECTS_APPLY_TOOL_NAME,
    undoGraphRevision,
  });
};
