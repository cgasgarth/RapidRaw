import { z } from 'zod';
import { toneColorDryRunResultV1Schema } from '../../../../packages/rawengine-schema/src/rawEngineSchemas';
import { useEditorStore } from '../../../store/useEditorStore';
import type { Adjustments } from '../../adjustments';
import {
  BASIC_TONE_ADJUSTMENT_KEYS,
  buildBasicToneCommandEnvelope,
  buildBasicToneImageCommandContext,
  type LegacyBasicToneAdjustmentPayload,
} from '../../basicToneCommandBridge';
import { pushEditHistoryEntry } from '../../editHistory';
import { buildAgentImageContextSnapshot } from '../context/agentImageContextSnapshot';
import { applyBasicToneToLiveEditor } from '../session/agentLiveBasicTone';
import { createLiveEditorAppServerBridge } from '../session/agentLiveEditorState';

export const AGENT_ADJUSTMENTS_APPLY_TOOL_NAME = 'rawengine.agent.adjustments.apply';
export const AGENT_ADJUSTMENTS_DRY_RUN_TOOL_NAME = 'rawengine.agent.adjustments.dry_run';
export const AGENT_ADJUSTMENTS_APPLY_INPUT_SCHEMA_NAME = 'AgentAdjustmentsApplyRequestV1';
export const AGENT_ADJUSTMENTS_APPLY_OUTPUT_SCHEMA_NAME = 'AgentAdjustmentsApplyResponseV1';
export const AGENT_ADJUSTMENTS_DRY_RUN_INPUT_SCHEMA_NAME = 'AgentAdjustmentsDryRunRequestV1';
export const AGENT_ADJUSTMENTS_DRY_RUN_OUTPUT_SCHEMA_NAME = 'AgentAdjustmentsDryRunResponseV1';

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

const agentAdjustmentsApplyApprovalSchema = z
  .object({
    approvalId: z.string().trim().min(1),
    approvedGraphRevision: z.string().trim().min(1),
    approvedPlanHash: z.string().trim().min(1),
    approvedPlanId: z.string().trim().min(1),
    approvedRecipeHash: z.string().trim().min(1),
    approvedSessionId: z.string().trim().min(1),
    status: z.literal('approved'),
  })
  .strict();

export const agentAdjustmentsApplyRequestSchema = z
  .object({
    acceptedPlanHash: z.string().trim().min(1),
    acceptedPlanId: z.string().trim().min(1),
    adjustments: agentGlobalAdjustmentPatchSchema,
    approval: agentAdjustmentsApplyApprovalSchema,
    expectedGraphRevision: z.string().trim().min(1),
    expectedRecipeHash: z.string().trim().min(1),
    proposalLineage: z
      .object({
        acceptedProposalHash: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
        acceptedProposalId: z.string().trim().min(1),
        lineageEpoch: z.number().int().positive(),
        lineageId: z.string().trim().min(1),
        sealedIterationId: z.string().trim().min(1),
      })
      .strict()
      .optional(),
    operationId: z.string().trim().min(1),
    requestId: z.string().trim().min(1),
    sessionId: z.string().trim().min(1),
  })
  .strict();

export const agentAdjustmentsDryRunRequestSchema = z
  .object({
    adjustments: agentGlobalAdjustmentPatchSchema,
    expectedGraphRevision: z.string().trim().min(1),
    expectedRecipeHash: z.string().trim().min(1),
    operationId: z.string().trim().min(1),
    requestId: z.string().trim().min(1),
    sessionId: z.string().trim().min(1),
  })
  .strict();

export const agentAdjustmentsDryRunResponseSchema = z
  .object({
    adjustedFields: z.array(z.string().trim().min(1)).min(1),
    dryRunPlanHash: z.string().trim().min(1),
    dryRunPlanId: z.string().trim().min(1),
    predictedGraphRevision: z.string().trim().min(1),
    receipt: z
      .object({
        adjustedFields: z.array(z.string().trim().min(1)).min(1),
        commandId: z.string().trim().min(1),
        dryRunPlanHash: z.string().trim().min(1),
        dryRunPlanId: z.string().trim().min(1),
        expectedGraphRevision: z.string().trim().min(1),
        expectedRecipeHash: z.string().trim().min(1),
        operationId: z.string().trim().min(1),
        predictedGraphRevision: z.string().trim().min(1),
        sessionId: z.string().trim().min(1),
        sourceGraphRevision: z.string().trim().min(1),
      })
      .strict(),
    requestId: z.string().trim().min(1),
    sourceGraphRevision: z.string().trim().min(1),
    staleRecipeHash: z.literal(false),
    toolName: z.literal(AGENT_ADJUSTMENTS_DRY_RUN_TOOL_NAME),
    warnings: z.array(z.string().trim().min(1)),
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
        acceptedPlanHash: z.string().trim().min(1),
        acceptedPlanId: z.string().trim().min(1),
        adjustedFields: z.array(z.string().trim().min(1)).min(1),
        afterPreviewHash: z.string().trim().min(1),
        appliedGraphRevision: z.string().trim().min(1),
        approvalId: z.string().trim().min(1),
        approvalState: z.literal('approved'),
        beforePreviewHash: z.string().trim().min(1),
        expectedGraphRevision: z.string().trim().min(1),
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
export type AgentAdjustmentsDryRunRequest = z.infer<typeof agentAdjustmentsDryRunRequestSchema>;
export type AgentAdjustmentsDryRunResponse = z.infer<typeof agentAdjustmentsDryRunResponseSchema>;
export type AgentAdjustmentsApplyApproval = z.infer<typeof agentAdjustmentsApplyApprovalSchema>;

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

const getSnapshotGraphAndRecipe = () => {
  const snapshot = buildAgentImageContextSnapshot();
  return {
    graphRevision: snapshot.graphRevision,
    recipeHash: snapshot.initialPreview.recipeHash,
  };
};

const assertExpectedEditorState = ({
  expectedGraphRevision,
  expectedRecipeHash,
}: {
  expectedGraphRevision: string;
  expectedRecipeHash: string;
}) => {
  const snapshot = getSnapshotGraphAndRecipe();
  if (expectedRecipeHash !== snapshot.recipeHash) {
    throw new Error('Agent adjustment apply rejected stale recipe hash.');
  }
  if (expectedGraphRevision !== snapshot.graphRevision) {
    throw new Error('Agent adjustment apply rejected stale graph revision.');
  }
  return snapshot;
};

const getAdjustedFields = (adjustments: z.infer<typeof agentGlobalAdjustmentPatchSchema>) => [
  ...BASIC_TONE_ADJUSTMENT_KEYS.filter((key) => adjustments[key] !== undefined),
  ...EXTRA_ADJUSTMENT_KEYS.filter((key) => adjustments[key] !== undefined),
];

type StoredAdjustmentDryRunReceipt = AgentAdjustmentsDryRunResponse['receipt'] & {
  adjustments: z.infer<typeof agentGlobalAdjustmentPatchSchema>;
  basicTonePlanHash: string;
  basicTonePlanId: string;
};

const acceptedAdjustmentDryRunReceipts = new Map<string, StoredAdjustmentDryRunReceipt>();

const stableAgentAdjustmentPlanHash = (value: string): string => {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
};

const buildAgentAdjustmentPlanIdentity = ({
  adjustments,
  basicTonePlanHash,
  basicTonePlanId,
}: {
  adjustments: z.infer<typeof agentGlobalAdjustmentPatchSchema>;
  basicTonePlanHash: string;
  basicTonePlanId: string;
}) => {
  const hash = stableAgentAdjustmentPlanHash(
    JSON.stringify({
      adjustments: Object.fromEntries(Object.entries(adjustments).sort(([left], [right]) => left.localeCompare(right))),
      basicTonePlanHash,
      basicTonePlanId,
    }),
  );
  return {
    planHash: `sha256:agent-adjustments:${hash}`,
    planId: `dryrun_agent_adjustments_${hash}`,
  };
};

const buildDryRunReceiptKey = ({
  expectedGraphRevision,
  planHash,
  planId,
}: {
  expectedGraphRevision: string;
  planHash: string;
  planId: string;
}) => `${expectedGraphRevision}:${planId}:${planHash}`;

export const assertAgentAdjustmentsDryRunPlanForProposal = ({
  adjustments,
  expectedGraphRevision,
  expectedRecipeHash,
  operationId,
  planHash,
  planId,
  sessionId,
}: {
  adjustments: AgentAdjustmentsDryRunRequest['adjustments'];
  expectedGraphRevision: string;
  expectedRecipeHash: string;
  operationId: string;
  planHash: string;
  planId: string;
  sessionId: string;
}): void => {
  const receipt = acceptedAdjustmentDryRunReceipts.get(
    buildDryRunReceiptKey({ expectedGraphRevision, planHash, planId }),
  );
  if (receipt === undefined) throw new Error('Proposal renderer rejected missing adjustment dry-run receipt.');
  if (
    receipt.expectedRecipeHash !== expectedRecipeHash ||
    receipt.operationId !== operationId ||
    receipt.sessionId !== sessionId ||
    JSON.stringify(receipt.adjustments) !== JSON.stringify(adjustments)
  ) {
    throw new Error('Proposal renderer rejected mismatched adjustment dry-run receipt.');
  }
};

export const buildAgentAdjustmentsApplyApproval = ({
  approvalId,
  dryRun,
  expectedRecipeHash,
  sessionId,
}: {
  approvalId: string;
  dryRun: Pick<AgentAdjustmentsDryRunResponse, 'dryRunPlanHash' | 'dryRunPlanId' | 'sourceGraphRevision'>;
  expectedRecipeHash: string;
  sessionId: string;
}): AgentAdjustmentsApplyApproval =>
  agentAdjustmentsApplyApprovalSchema.parse({
    approvalId,
    approvedGraphRevision: dryRun.sourceGraphRevision,
    approvedPlanHash: dryRun.dryRunPlanHash,
    approvedPlanId: dryRun.dryRunPlanId,
    approvedRecipeHash: expectedRecipeHash,
    approvedSessionId: sessionId,
    status: 'approved',
  });

export const dryRunAgentGlobalAdjustments = async (
  request: AgentAdjustmentsDryRunRequest,
): Promise<AgentAdjustmentsDryRunResponse> => {
  const parsedRequest = agentAdjustmentsDryRunRequestSchema.parse(request);
  const snapshot = assertExpectedEditorState({
    expectedGraphRevision: parsedRequest.expectedGraphRevision,
    expectedRecipeHash: parsedRequest.expectedRecipeHash,
  });
  const initialState = useEditorStore.getState();
  const imagePath = initialState.selectedImage?.path;
  if (imagePath === undefined) throw new Error('Cannot dry-run agent basic tone without a selected image.');

  const command = buildBasicToneCommandEnvelope(
    buildRequestedBasicTone(initialState.adjustments, parsedRequest.adjustments),
    buildBasicToneImageCommandContext({
      expectedGraphRevision: parsedRequest.expectedGraphRevision,
      imagePath,
      operationId: parsedRequest.operationId,
      sessionId: parsedRequest.sessionId,
    }),
    { dryRun: true },
  );
  const bridge = createLiveEditorAppServerBridge();
  const dryRun = await bridge.dispatch(command);
  if (!dryRun.ok) throw new Error(`Agent basic-tone dry-run failed: ${dryRun.message}`);
  const dryRunResult = toneColorDryRunResultV1Schema.parse(dryRun.result);
  if (dryRunResult.dryRunPlanHash === undefined || dryRunResult.dryRunPlanId === undefined) {
    throw new Error('Agent basic-tone dry-run did not return an accepted plan identity.');
  }
  if (dryRunResult.sourceGraphRevision !== snapshot.graphRevision) {
    throw new Error('Agent basic-tone dry-run receipt did not match the editor graph revision.');
  }

  const adjustedFields = getAdjustedFields(parsedRequest.adjustments);
  const agentPlan = buildAgentAdjustmentPlanIdentity({
    adjustments: parsedRequest.adjustments,
    basicTonePlanHash: dryRunResult.dryRunPlanHash,
    basicTonePlanId: dryRunResult.dryRunPlanId,
  });
  const receipt: AgentAdjustmentsDryRunResponse['receipt'] = {
    adjustedFields,
    commandId: dryRunResult.commandId,
    dryRunPlanHash: agentPlan.planHash,
    dryRunPlanId: agentPlan.planId,
    expectedGraphRevision: parsedRequest.expectedGraphRevision,
    expectedRecipeHash: parsedRequest.expectedRecipeHash,
    operationId: parsedRequest.operationId,
    predictedGraphRevision: dryRunResult.predictedGraphRevision,
    sessionId: parsedRequest.sessionId,
    sourceGraphRevision: dryRunResult.sourceGraphRevision,
  };
  const storedReceipt: StoredAdjustmentDryRunReceipt = {
    ...receipt,
    adjustments: parsedRequest.adjustments,
    basicTonePlanHash: dryRunResult.dryRunPlanHash,
    basicTonePlanId: dryRunResult.dryRunPlanId,
  };
  acceptedAdjustmentDryRunReceipts.set(
    buildDryRunReceiptKey({
      expectedGraphRevision: parsedRequest.expectedGraphRevision,
      planHash: agentPlan.planHash,
      planId: agentPlan.planId,
    }),
    storedReceipt,
  );

  return agentAdjustmentsDryRunResponseSchema.parse({
    adjustedFields,
    dryRunPlanHash: agentPlan.planHash,
    dryRunPlanId: agentPlan.planId,
    predictedGraphRevision: dryRunResult.predictedGraphRevision,
    receipt,
    requestId: parsedRequest.requestId,
    sourceGraphRevision: dryRunResult.sourceGraphRevision,
    staleRecipeHash: false,
    toolName: AGENT_ADJUSTMENTS_DRY_RUN_TOOL_NAME,
    warnings: dryRunResult.warnings,
  });
};

export const applyAgentGlobalAdjustments = async (
  request: AgentAdjustmentsApplyRequest,
): Promise<AgentAdjustmentsApplyResponse> => {
  const parsedRequest = agentAdjustmentsApplyRequestSchema.parse(request);
  assertExpectedEditorState({
    expectedGraphRevision: parsedRequest.expectedGraphRevision,
    expectedRecipeHash: parsedRequest.expectedRecipeHash,
  });
  const acceptedReceipt = acceptedAdjustmentDryRunReceipts.get(
    buildDryRunReceiptKey({
      expectedGraphRevision: parsedRequest.expectedGraphRevision,
      planHash: parsedRequest.acceptedPlanHash,
      planId: parsedRequest.acceptedPlanId,
    }),
  );
  if (acceptedReceipt === undefined) {
    throw new Error('Agent adjustment apply rejected missing dry-run receipt.');
  }
  if (
    parsedRequest.approval.approvedPlanHash !== parsedRequest.acceptedPlanHash ||
    parsedRequest.approval.approvedPlanId !== parsedRequest.acceptedPlanId ||
    parsedRequest.approval.approvedGraphRevision !== parsedRequest.expectedGraphRevision ||
    parsedRequest.approval.approvedRecipeHash !== parsedRequest.expectedRecipeHash ||
    parsedRequest.approval.approvedSessionId !== parsedRequest.sessionId
  ) {
    throw new Error('Agent adjustment apply rejected mismatched approval receipt.');
  }
  if (
    acceptedReceipt.operationId !== parsedRequest.operationId ||
    acceptedReceipt.sessionId !== parsedRequest.sessionId ||
    JSON.stringify(acceptedReceipt.adjustments) !== JSON.stringify(parsedRequest.adjustments)
  ) {
    throw new Error('Agent adjustment apply rejected mismatched dry-run receipt.');
  }

  const initialState = useEditorStore.getState();
  const undoGraphRevision = parsedRequest.expectedGraphRevision;
  const basicToneResult = await applyBasicToneToLiveEditor({
    acceptedPlanHash: acceptedReceipt.basicTonePlanHash,
    acceptedPlanId: acceptedReceipt.basicTonePlanId,
    expectedGraphRevision: parsedRequest.expectedGraphRevision,
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

  const adjustedFields = getAdjustedFields(parsedRequest.adjustments);
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
      acceptedPlanHash: parsedRequest.acceptedPlanHash,
      acceptedPlanId: parsedRequest.acceptedPlanId,
      adjustedFields,
      afterPreviewHash: basicToneResult.afterPreviewHash,
      appliedGraphRevision,
      approvalId: parsedRequest.approval.approvalId,
      approvalState: parsedRequest.approval.status,
      beforePreviewHash: basicToneResult.beforePreviewHash,
      expectedGraphRevision: parsedRequest.expectedGraphRevision,
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
