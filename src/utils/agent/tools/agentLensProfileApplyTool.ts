import { z } from 'zod';
import {
  ActorKind,
  ApprovalClass,
  type LensProfileCommandEnvelopeV1,
  type LensProfileMutationResultV1,
  lensProfileDryRunResultV1Schema,
  lensProfileMutationResultV1Schema,
  RAW_ENGINE_SCHEMA_VERSION,
} from '../../../../packages/rawengine-schema/src/rawEngineSchemas';
import { useEditorStore } from '../../../store/useEditorStore';
import type { Adjustments } from '../../adjustments';
import { pushEditHistoryEntry } from '../../editHistory';
import { buildAgentImageContextSnapshot } from '../context/agentImageContextSnapshot';
import { createLiveEditorAppServerBridge } from '../session/agentLiveEditorCoreState';

export const AGENT_LENS_PROFILE_APPLY_TOOL_NAME = 'rawengine.agent.lens_profile.apply';
export const AGENT_LENS_PROFILE_APPLY_INPUT_SCHEMA_NAME = 'AgentLensProfileApplyRequestV1';
export const AGENT_LENS_PROFILE_APPLY_OUTPUT_SCHEMA_NAME = 'AgentLensProfileApplyResponseV1';

const lensDistortionParamsSchema = z
  .object({
    k1: z.number().min(-10).max(10),
    k2: z.number().min(-10).max(10),
    k3: z.number().min(-10).max(10),
    model: z.number().int().min(0).max(10),
    tca_vb: z.number().min(-10).max(10),
    tca_vr: z.number().min(-10).max(10),
    vig_k1: z.number().min(-10).max(10),
    vig_k2: z.number().min(-10).max(10),
    vig_k3: z.number().min(-10).max(10),
  })
  .strict();

const agentLensProfilePatchSchema = z
  .object({
    lensCorrectionMode: z.enum(['auto', 'manual']).optional(),
    lensDistortionAmount: z.number().int().min(0).max(200).optional(),
    lensDistortionEnabled: z.boolean().optional(),
    lensDistortionParams: lensDistortionParamsSchema.nullable().optional(),
    lensMaker: z.string().trim().min(1).max(160).nullable().optional(),
    lensModel: z.string().trim().min(1).max(240).nullable().optional(),
    lensTcaAmount: z.number().int().min(0).max(200).optional(),
    lensTcaEnabled: z.boolean().optional(),
    lensVignetteAmount: z.number().int().min(0).max(200).optional(),
    lensVignetteEnabled: z.boolean().optional(),
  })
  .strict()
  .refine((patch) => Object.keys(patch).length > 0, {
    message: 'At least one lens/profile adjustment is required.',
  })
  .refine((patch) => patch.lensModel === undefined || patch.lensMaker !== null, {
    message: 'Lens model cannot be set while lens maker is explicitly cleared.',
  });

export const agentLensProfileApplyRequestSchema = z
  .object({
    expectedRecipeHash: z.string().trim().min(1),
    lensProfile: agentLensProfilePatchSchema,
    operationId: z.string().trim().min(1),
    requestId: z.string().trim().min(1),
    sessionId: z.string().trim().min(1),
  })
  .strict();

export const agentLensProfileApplyResponseSchema = z
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
        typedCommand: z
          .object({
            appliedGraphRevision: z.string().trim().min(1),
            changedNodeIds: z.array(z.string().trim().min(1)).min(1),
            commandId: z.string().trim().min(1),
            commandType: z.literal('lensProfile.applyCorrection'),
            dryRunPlanHash: z.string().trim().min(1),
            dryRunPlanId: z.string().trim().min(1),
            provenanceEntryIds: z.array(z.string().trim().min(1)).min(1),
            sourceGraphRevision: z.string().trim().min(1),
          })
          .strict(),
        undoGraphRevision: z.string().trim().min(1),
      })
      .strict(),
    requestId: z.string().trim().min(1),
    staleRecipeHash: z.literal(false),
    toolName: z.literal(AGENT_LENS_PROFILE_APPLY_TOOL_NAME),
    undoGraphRevision: z.string().trim().min(1),
  })
  .strict();

export type AgentLensProfileApplyRequest = z.infer<typeof agentLensProfileApplyRequestSchema>;
export type AgentLensProfileApplyResponse = z.infer<typeof agentLensProfileApplyResponseSchema>;
type AgentLensProfilePatch = z.infer<typeof agentLensProfilePatchSchema>;

const LENS_PROFILE_PATCH_KEYS = [
  'lensCorrectionMode',
  'lensDistortionAmount',
  'lensDistortionEnabled',
  'lensDistortionParams',
  'lensMaker',
  'lensModel',
  'lensTcaAmount',
  'lensTcaEnabled',
  'lensVignetteAmount',
  'lensVignetteEnabled',
] as const satisfies ReadonlyArray<keyof AgentLensProfilePatch>;

const applyLensProfilePatchToAdjustments = (base: Adjustments, patch: AgentLensProfilePatch): Adjustments => {
  const next: Adjustments = { ...base };
  if (patch.lensCorrectionMode !== undefined) next.lensCorrectionMode = patch.lensCorrectionMode;
  if (patch.lensDistortionAmount !== undefined) next.lensDistortionAmount = patch.lensDistortionAmount;
  if (patch.lensDistortionEnabled !== undefined) next.lensDistortionEnabled = patch.lensDistortionEnabled;
  if (patch.lensDistortionParams !== undefined) next.lensDistortionParams = patch.lensDistortionParams;
  if (patch.lensMaker !== undefined) {
    next.lensMaker = patch.lensMaker;
    if (patch.lensMaker === null && patch.lensModel === undefined) next.lensModel = null;
  }
  if (patch.lensModel !== undefined) next.lensModel = patch.lensModel;
  if (patch.lensTcaAmount !== undefined) next.lensTcaAmount = patch.lensTcaAmount;
  if (patch.lensTcaEnabled !== undefined) next.lensTcaEnabled = patch.lensTcaEnabled;
  if (patch.lensVignetteAmount !== undefined) next.lensVignetteAmount = patch.lensVignetteAmount;
  if (patch.lensVignetteEnabled !== undefined) next.lensVignetteEnabled = patch.lensVignetteEnabled;
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
  const changedFieldCount = LENS_PROFILE_PATCH_KEYS.filter(
    (key) => JSON.stringify(before[key]) !== JSON.stringify(after[key]),
  ).length;
  return Math.max(1, Math.round((imageArea / 448) * Math.max(1, changedFieldCount)));
};

const buildAgentLensProfileCommand = ({
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
  commandType: 'lensProfile.dryRunCorrection' | 'lensProfile.applyCorrection';
  dryRun: boolean;
  expectedGraphRevision: string;
  imagePath: string;
  parameters: AgentLensProfilePatch & {
    acceptedDryRunPlanHash?: string;
    acceptedDryRunPlanId?: string;
  };
  request: AgentLensProfileApplyRequest;
}): LensProfileCommandEnvelopeV1 =>
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
  }) as LensProfileCommandEnvelopeV1;

const dispatchTypedLensProfileApply = async ({
  expectedGraphRevision,
  imagePath,
  request,
}: {
  expectedGraphRevision: string;
  imagePath: string;
  request: AgentLensProfileApplyRequest;
}): Promise<LensProfileMutationResultV1> => {
  const bridge = createLiveEditorAppServerBridge();
  const dryRunCommand = buildAgentLensProfileCommand({
    approval: {
      approvalClass: ApprovalClass.PreviewOnly,
      reason: 'Preview agent lens/profile patch through typed command dispatch.',
      state: 'not_required',
    },
    commandId: `${request.operationId}_dry_run`,
    commandType: 'lensProfile.dryRunCorrection',
    dryRun: true,
    expectedGraphRevision,
    imagePath,
    parameters: request.lensProfile,
    request,
  });
  const dryRun = await bridge.dispatch(dryRunCommand, { requestId: request.requestId, now: () => new Date() });
  if (!dryRun.ok) throw new Error(`Agent lens/profile typed dry-run failed: ${dryRun.message}`);
  const dryRunResult = lensProfileDryRunResultV1Schema.parse(dryRun.result);
  if (dryRunResult.sourceGraphRevision !== expectedGraphRevision) {
    throw new Error('Agent lens/profile typed dry-run receipt did not match the editor graph revision.');
  }

  const applyCommand = buildAgentLensProfileCommand({
    approval: {
      approvalClass: ApprovalClass.EditApply,
      reason: 'Apply accepted agent lens/profile dry-run plan through typed command dispatch.',
      state: 'approved',
    },
    commandId: `${request.operationId}_apply`,
    commandType: 'lensProfile.applyCorrection',
    dryRun: false,
    expectedGraphRevision,
    imagePath,
    parameters: {
      ...request.lensProfile,
      acceptedDryRunPlanHash: dryRunResult.dryRunPlanHash,
      acceptedDryRunPlanId: dryRunResult.dryRunPlanId,
    },
    request,
  });
  const apply = await bridge.dispatch(applyCommand, { requestId: request.requestId, now: () => new Date() });
  if (!apply.ok) throw new Error(`Agent lens/profile typed apply failed: ${apply.message}`);
  return lensProfileMutationResultV1Schema.parse(apply.result);
};

export const applyAgentLensProfile = async (
  request: AgentLensProfileApplyRequest,
): Promise<AgentLensProfileApplyResponse> => {
  const parsedRequest = agentLensProfileApplyRequestSchema.parse(request);
  const snapshot = buildAgentImageContextSnapshot();
  if (parsedRequest.expectedRecipeHash !== snapshot.initialPreview.recipeHash) {
    throw new Error('Agent lens/profile apply rejected stale recipe hash.');
  }

  const state = useEditorStore.getState();
  const selectedImage = state.selectedImage;
  if (selectedImage === null) throw new Error('Agent lens/profile apply requires a selected image.');

  const undoGraphRevision = `history_${state.historyIndex}`;
  const typedMutation = await dispatchTypedLensProfileApply({
    expectedGraphRevision: undoGraphRevision,
    imagePath: selectedImage.path,
    request: parsedRequest,
  });
  const nextAdjustments = applyLensProfilePatchToAdjustments(state.adjustments, parsedRequest.lensProfile);
  const history = pushEditHistoryEntry(state.history, state.historyIndex, nextAdjustments);
  useEditorStore.setState({
    adjustments: nextAdjustments,
    history: history.history,
    historyIndex: history.historyIndex,
    uncroppedAdjustedPreviewUrl: null,
  });

  const afterSnapshot = buildAgentImageContextSnapshot();
  const adjustedFields = LENS_PROFILE_PATCH_KEYS.filter((key) => parsedRequest.lensProfile[key] !== undefined);
  const appliedGraphRevision = `history_${useEditorStore.getState().historyIndex}`;

  return agentLensProfileApplyResponseSchema.parse({
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
      undoGraphRevision,
    },
    requestId: parsedRequest.requestId,
    staleRecipeHash: false,
    toolName: AGENT_LENS_PROFILE_APPLY_TOOL_NAME,
    undoGraphRevision,
  });
};
