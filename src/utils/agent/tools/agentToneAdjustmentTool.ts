import { z } from 'zod';
import type { EditDocumentV2 } from '../../../../packages/rawengine-schema/src/editDocumentV2';

import type { RawEngineLocalAppServerBridge } from '../../../../packages/rawengine-schema/src/localAppServerBridge';
import {
  toneColorDryRunResultV1Schema,
  toneColorMutationResultV1Schema,
} from '../../../../packages/rawengine-schema/src/rawEngineSchemas';
import { useEditorStore } from '../../../store/useEditorStore';
import {
  type BasicToneAdjustmentPayload,
  buildBasicToneCommandEnvelope,
  buildBasicToneImageCommandContext,
} from '../../basicToneCommandBridge';
import { captureBasicToneCommitIdentity } from '../../basicToneEditTransaction';
import { selectEditDocumentControlValue, selectEditDocumentNode } from '../../editDocumentSelectors';
import { patchEditDocumentV2Node } from '../../editDocumentV2';
import { buildAgentImageContextSnapshot } from '../context/agentImageContextSnapshot';
import {
  type AgentLiveBasicTonePixel,
  hashBasicTonePreviewPixels,
  renderBasicTonePreviewPixels,
} from '../session/agentLiveBasicTone';
import { createLiveEditorAppServerBridge } from '../session/agentLiveEditorCoreState';

export const AGENT_TONE_ADJUSTMENT_APPLY_TOOL_NAME = 'rawengine.agent.tone_adjustment.apply';
export const AGENT_TONE_ADJUSTMENT_DRY_RUN_TOOL_NAME = 'rawengine.agent.tone_adjustment.dry_run';
export const AGENT_TONE_ADJUSTMENT_APPLY_INPUT_SCHEMA_NAME = 'AgentToneAdjustmentApplyRequestV1';
export const AGENT_TONE_ADJUSTMENT_APPLY_OUTPUT_SCHEMA_NAME = 'AgentToneAdjustmentApplyResponseV1';
export const AGENT_TONE_ADJUSTMENT_DRY_RUN_INPUT_SCHEMA_NAME = 'AgentToneAdjustmentDryRunRequestV1';
export const AGENT_TONE_ADJUSTMENT_DRY_RUN_OUTPUT_SCHEMA_NAME = 'AgentToneAdjustmentDryRunResponseV1';

const agentToneAdjustmentPatchSchema = z
  .object({
    blacks: z.number().min(-100).max(100).optional(),
    clarity: z.number().min(-100).max(100).optional(),
    contrast: z.number().min(-100).max(100).optional(),
    exposure: z.number().min(-2).max(2).optional(),
    highlights: z.number().min(-100).max(100).optional(),
    saturation: z.number().min(-100).max(100).optional(),
    shadows: z.number().min(-100).max(100).optional(),
    whites: z.number().min(-100).max(100).optional(),
  })
  .strict()
  .refine((patch) => Object.keys(patch).length > 0, { message: 'At least one tone adjustment is required.' });

export type AgentToneAdjustmentPatch = z.infer<typeof agentToneAdjustmentPatchSchema>;

export type AgentToneAdjustmentPromptDraft =
  | {
      adjustedFields: readonly (keyof AgentToneAdjustmentPatch)[];
      requestedAdjustments: AgentToneAdjustmentPatch;
      supported: true;
      summary: string;
    }
  | {
      reason: string;
      supported: false;
      summary: string;
    };

const baseToneAdjustmentRequestSchema = z
  .object({
    adjustments: agentToneAdjustmentPatchSchema,
    expectedGraphRevision: z.string().trim().min(1),
    expectedRecipeHash: z.string().trim().min(1),
    operationId: z.string().trim().min(1),
    requestId: z.string().trim().min(1),
    sessionId: z.string().trim().min(1),
  })
  .strict();

export const agentToneAdjustmentDryRunRequestSchema = baseToneAdjustmentRequestSchema;

export const agentToneAdjustmentApplyRequestSchema = baseToneAdjustmentRequestSchema
  .extend({
    acceptedPlanHash: z.string().trim().min(1),
    acceptedPlanId: z.string().trim().min(1),
  })
  .strict();

const previewAfterReceiptSchema = z
  .object({
    accessScope: z.literal('local_private'),
    artifactId: z.string().trim().min(1),
    graphRevision: z.string().trim().min(1),
    previewRef: z.string().trim().min(1),
    purpose: z.literal('tone_adjustment_preview_after'),
    renderHash: z.string().trim().min(1),
    sourceGraphRevision: z.string().trim().min(1),
  })
  .strict();

const staleReceiptSchema = z
  .object({
    actualGraphRevision: z.string().trim().min(1),
    actualRecipeHash: z.string().trim().min(1),
    expectedGraphRevision: z.string().trim().min(1),
    expectedRecipeHash: z.string().trim().min(1),
    staleGraphRevision: z.boolean(),
    staleRecipeHash: z.boolean(),
  })
  .strict();

export const agentToneAdjustmentDryRunResponseSchema = z
  .object({
    adjustedFields: z.array(z.string().trim().min(1)).min(1),
    auditEventIds: z.array(z.string().trim().min(1)).min(1),
    commandId: z.string().trim().min(1),
    dryRunPlanHash: z.string().trim().min(1),
    dryRunPlanId: z.string().trim().min(1),
    editRevision: z
      .object({
        current: z.string().trim().min(1),
        predicted: z.string().trim().min(1),
      })
      .strict(),
    expectedRevisionMatched: z.literal(true),
    predictedGraphRevision: z.string().trim().min(1),
    previewAfter: previewAfterReceiptSchema,
    receipt: z
      .object({
        adjustedFields: z.array(z.string().trim().min(1)).min(1),
        auditEventIds: z.array(z.string().trim().min(1)).min(1),
        commandId: z.string().trim().min(1),
        dryRunPlanHash: z.string().trim().min(1),
        dryRunPlanId: z.string().trim().min(1),
        expectedGraphRevision: z.string().trim().min(1),
        expectedRecipeHash: z.string().trim().min(1),
        operationId: z.string().trim().min(1),
        previewAfter: previewAfterReceiptSchema,
        sessionId: z.string().trim().min(1),
        sourceGraphRevision: z.string().trim().min(1),
      })
      .strict(),
    requestId: z.string().trim().min(1),
    sourceGraphRevision: z.string().trim().min(1),
    stale: staleReceiptSchema,
    toolName: z.literal(AGENT_TONE_ADJUSTMENT_DRY_RUN_TOOL_NAME),
    warnings: z.array(z.string().trim().min(1)),
  })
  .strict();

export const agentToneAdjustmentApplyResponseSchema = z
  .object({
    adjustedFields: z.array(z.string().trim().min(1)),
    afterPreviewHash: z.string().trim().min(1),
    appliedGraphRevision: z.string().trim().min(1),
    auditEventIds: z.array(z.string().trim().min(1)).min(1),
    beforePreviewHash: z.string().trim().min(1),
    editRevision: z
      .object({
        applied: z.string().trim().min(1),
        expected: z.string().trim().min(1),
        undo: z.string().trim().min(1),
      })
      .strict(),
    expectedRevisionMatched: z.literal(true),
    previewAfter: previewAfterReceiptSchema,
    receipt: z
      .object({
        acceptedPlanHash: z.string().trim().min(1),
        acceptedPlanId: z.string().trim().min(1),
        adjustedFields: z.array(z.string().trim().min(1)),
        afterPreviewHash: z.string().trim().min(1),
        appliedGraphRevision: z.string().trim().min(1),
        auditEventIds: z.array(z.string().trim().min(1)).min(1),
        beforePreviewHash: z.string().trim().min(1),
        expectedGraphRevision: z.string().trim().min(1),
        operationId: z.string().trim().min(1),
        previewAfter: previewAfterReceiptSchema,
        sessionId: z.string().trim().min(1),
        undoGraphRevision: z.string().trim().min(1),
      })
      .strict(),
    requestId: z.string().trim().min(1),
    stale: staleReceiptSchema,
    toolName: z.literal(AGENT_TONE_ADJUSTMENT_APPLY_TOOL_NAME),
    undoGraphRevision: z.string().trim().min(1),
    warnings: z.array(z.string().trim().min(1)),
  })
  .strict();

export type AgentToneAdjustmentApplyRequest = z.infer<typeof agentToneAdjustmentApplyRequestSchema>;
export type AgentToneAdjustmentApplyResponse = z.infer<typeof agentToneAdjustmentApplyResponseSchema>;
export type AgentToneAdjustmentDryRunRequest = z.infer<typeof agentToneAdjustmentDryRunRequestSchema>;
export type AgentToneAdjustmentDryRunResponse = z.infer<typeof agentToneAdjustmentDryRunResponseSchema>;

const PREVIEW_PROOF_PIXELS: readonly AgentLiveBasicTonePixel[] = Array.from(
  { length: 64 },
  (_, index): AgentLiveBasicTonePixel => {
    const x = index % 8;
    const y = Math.floor(index / 8);
    const base = 0.1 + x * 0.105;
    const rowLift = y * 0.012;
    return [
      Number(Math.min(1, base + rowLift).toFixed(6)),
      Number(Math.min(1, base * 0.9 + rowLift).toFixed(6)),
      Number(Math.min(1, base * 0.8 + rowLift * 0.5).toFixed(6)),
    ];
  },
);

const buildRequestedBasicTone = (
  base: EditDocumentV2,
  patch: z.infer<typeof agentToneAdjustmentPatchSchema>,
): BasicToneAdjustmentPayload => {
  const global = selectEditDocumentNode(base, 'scene_global_color_tone').params;
  return {
    blacks: patch.blacks ?? global.blacks,
    brightness: global.brightness,
    clarity: patch.clarity ?? selectEditDocumentNode(base, 'detail_denoise_dehaze').params['clarity'],
    contrast: patch.contrast ?? global.contrast,
    exposure: patch.exposure ?? global.exposure,
    highlights: patch.highlights ?? global.highlights,
    saturation: patch.saturation ?? selectEditDocumentNode(base, 'color_presence').params['saturation'],
    shadows: patch.shadows ?? global.shadows,
    whites: patch.whites ?? global.whites,
  };
};

const BASIC_TONE_ADJUSTMENT_PATCH_KEYS = [
  'blacks',
  'clarity',
  'contrast',
  'exposure',
  'highlights',
  'saturation',
  'shadows',
  'whites',
] as const satisfies readonly (keyof AgentToneAdjustmentPatch)[];

const getAdjustedFields = (adjustments: z.infer<typeof agentToneAdjustmentPatchSchema>) =>
  BASIC_TONE_ADJUSTMENT_PATCH_KEYS.filter((key) => adjustments[key] !== undefined);

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

const includesAny = (normalizedPrompt: string, patterns: readonly string[]): boolean =>
  patterns.some((pattern) => normalizedPrompt.includes(pattern));

export const buildAgentToneAdjustmentPromptDraft = (
  prompt: string,
  baseAdjustments: BasicToneAdjustmentPayload,
): AgentToneAdjustmentPromptDraft => {
  const normalizedPrompt = prompt.toLowerCase();
  const brightenRequested = includesAny(normalizedPrompt, [
    'brighten',
    'brighter',
    'lighten',
    'lift exposure',
    'too dark',
  ]);
  const contrastRequested = includesAny(normalizedPrompt, ['contrast', 'punch', 'pop', 'more depth']);
  const highlightRequested = includesAny(normalizedPrompt, [
    'highlight',
    'highlights',
    'recover highlights',
    'save highlights',
  ]);
  const shadowRequested = includesAny(normalizedPrompt, ['shadow', 'shadows', 'lift shadows', 'open shadows']);
  const basicToneRequested = includesAny(normalizedPrompt, ['basic tone']) || brightenRequested || contrastRequested;

  if (!brightenRequested && !contrastRequested && !highlightRequested && !shadowRequested && !basicToneRequested) {
    return {
      reason: 'Only basic tone prompts like brighten, contrast, lift shadows, or recover highlights are supported.',
      supported: false,
      summary: 'Unsupported live chat prompt. No editor state was mutated.',
    };
  }

  const requestedAdjustments: AgentToneAdjustmentPatch = {};
  if (brightenRequested || basicToneRequested) {
    requestedAdjustments.exposure = clamp(baseAdjustments.exposure + 0.32, -10, 10);
  }
  if (contrastRequested || basicToneRequested) {
    requestedAdjustments.clarity = clamp(baseAdjustments.clarity + 10, -100, 100);
    requestedAdjustments.contrast = clamp(baseAdjustments.contrast + 16, -100, 100);
  }
  if (highlightRequested || basicToneRequested) {
    requestedAdjustments.highlights = clamp(baseAdjustments.highlights - 18, -100, 100);
    requestedAdjustments.whites = clamp(baseAdjustments.whites + 6, -100, 100);
  }
  if (shadowRequested || basicToneRequested) {
    requestedAdjustments.blacks = clamp(baseAdjustments.blacks - 4, -100, 100);
    requestedAdjustments.shadows = clamp(baseAdjustments.shadows + 14, -100, 100);
  }
  if (basicToneRequested) {
    requestedAdjustments.saturation = clamp(baseAdjustments.saturation + 3, -100, 100);
  }

  const adjustedFields = getAdjustedFields(requestedAdjustments);
  return {
    adjustedFields,
    requestedAdjustments,
    supported: true,
    summary: `${adjustedFields.join(', ')} adjusted.`,
  };
};

const applyTonePatchToDocument = (document: EditDocumentV2, patch: AgentToneAdjustmentPatch): EditDocumentV2 => {
  let next = patchEditDocumentV2Node(document, 'scene_global_color_tone', {
    ...(patch.blacks === undefined ? {} : { blacks: patch.blacks }),
    ...(patch.contrast === undefined ? {} : { contrast: patch.contrast }),
    ...(patch.exposure === undefined ? {} : { exposure: patch.exposure }),
    ...(patch.highlights === undefined ? {} : { highlights: patch.highlights }),
    ...(patch.shadows === undefined ? {} : { shadows: patch.shadows }),
    ...(patch.whites === undefined ? {} : { whites: patch.whites }),
  });
  if (patch.clarity !== undefined)
    next = patchEditDocumentV2Node(next, 'detail_denoise_dehaze', { clarity: patch.clarity });
  if (patch.saturation !== undefined)
    next = patchEditDocumentV2Node(next, 'color_presence', { saturation: patch.saturation });
  return next;
};

const getSnapshotGraphAndRecipe = () => {
  const snapshot = buildAgentImageContextSnapshot();
  return {
    graphRevision: snapshot.graphRevision,
    recipeHash: snapshot.initialPreview.recipeHash,
  };
};

const buildStaleReceipt = ({
  expectedGraphRevision,
  expectedRecipeHash,
}: {
  expectedGraphRevision: string;
  expectedRecipeHash: string;
}) => {
  const snapshot = getSnapshotGraphAndRecipe();
  return staleReceiptSchema.parse({
    actualGraphRevision: snapshot.graphRevision,
    actualRecipeHash: snapshot.recipeHash,
    expectedGraphRevision,
    expectedRecipeHash,
    staleGraphRevision: expectedGraphRevision !== snapshot.graphRevision,
    staleRecipeHash: expectedRecipeHash !== snapshot.recipeHash,
  });
};

const assertExpectedEditorState = ({
  expectedGraphRevision,
  expectedRecipeHash,
}: {
  expectedGraphRevision: string;
  expectedRecipeHash: string;
}) => {
  const stale = buildStaleReceipt({ expectedGraphRevision, expectedRecipeHash });
  if (stale.staleRecipeHash || stale.staleGraphRevision) {
    throw new Error(
      `Agent tone adjustment rejected stale expected revision. expected=${expectedGraphRevision}/${expectedRecipeHash} actual=${stale.actualGraphRevision}/${stale.actualRecipeHash}`,
    );
  }
  return stale;
};

const stableHash = (value: string): string => {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
};

const buildPreviewAfter = ({
  commandId,
  graphRevision,
  renderHash,
  sessionId,
  sourceGraphRevision,
}: {
  commandId: string;
  graphRevision: string;
  renderHash: string;
  sessionId: string;
  sourceGraphRevision: string;
}) =>
  previewAfterReceiptSchema.parse({
    accessScope: 'local_private',
    artifactId: `agent-tone-preview-after-${stableHash(`${sessionId}:${commandId}:${renderHash}`)}`,
    graphRevision,
    previewRef: `rawengine://agent-tone-preview-after/${sessionId}/${commandId}/${renderHash}`,
    purpose: 'tone_adjustment_preview_after',
    renderHash,
    sourceGraphRevision,
  });

type StoredToneAdjustmentDryRunReceipt = AgentToneAdjustmentDryRunResponse['receipt'] & {
  adjustments: z.infer<typeof agentToneAdjustmentPatchSchema>;
  basicTonePlanHash: string;
  basicTonePlanId: string;
};

const acceptedToneAdjustmentDryRunReceipts = new Map<string, StoredToneAdjustmentDryRunReceipt>();

const buildDryRunReceiptKey = ({
  expectedGraphRevision,
  planHash,
  planId,
}: {
  expectedGraphRevision: string;
  planHash: string;
  planId: string;
}) => `${expectedGraphRevision}:${planId}:${planHash}`;

export const assertAgentToneDryRunPlanForProposal = ({
  adjustments,
  expectedGraphRevision,
  expectedRecipeHash,
  operationId,
  planHash,
  planId,
  sessionId,
}: {
  adjustments: AgentToneAdjustmentPatch;
  expectedGraphRevision: string;
  expectedRecipeHash: string;
  operationId: string;
  planHash: string;
  planId: string;
  sessionId: string;
}): void => {
  const receipt = acceptedToneAdjustmentDryRunReceipts.get(
    buildDryRunReceiptKey({ expectedGraphRevision, planHash, planId }),
  );
  if (receipt === undefined) throw new Error('Proposal renderer rejected missing dry-run receipt.');
  if (
    receipt.expectedRecipeHash !== expectedRecipeHash ||
    receipt.operationId !== operationId ||
    receipt.sessionId !== sessionId ||
    JSON.stringify(receipt.adjustments) !== JSON.stringify(adjustments)
  ) {
    throw new Error('Proposal renderer rejected mismatched dry-run receipt.');
  }
};

export const dryRunAgentToneAdjustment = async (
  request: AgentToneAdjustmentDryRunRequest,
): Promise<AgentToneAdjustmentDryRunResponse> => {
  const parsedRequest = agentToneAdjustmentDryRunRequestSchema.parse(request);
  const stale = assertExpectedEditorState(parsedRequest);
  const initialState = useEditorStore.getState();
  const imagePath = initialState.selectedImage?.path;
  if (imagePath === undefined) throw new Error('Cannot dry-run agent tone adjustment without a selected image.');

  const command = buildBasicToneCommandEnvelope(
    buildRequestedBasicTone(initialState.editDocumentV2, parsedRequest.adjustments),
    buildBasicToneImageCommandContext({
      expectedGraphRevision: parsedRequest.expectedGraphRevision,
      imagePath,
      operationId: parsedRequest.operationId,
      sessionId: parsedRequest.sessionId,
    }),
    { dryRun: true },
  );
  const bridge = createLiveEditorAppServerBridge();
  const dryRun = await bridge.dispatch(command, { now: () => new Date(), requestId: parsedRequest.requestId });
  if (!dryRun.ok) throw new Error(`Agent tone adjustment dry-run failed: ${dryRun.message}`);
  const dryRunResult = toneColorDryRunResultV1Schema.parse(dryRun.result);
  if (dryRunResult.dryRunPlanHash === undefined || dryRunResult.dryRunPlanId === undefined) {
    throw new Error('Agent tone adjustment dry-run did not return an accepted plan identity.');
  }

  const afterPixels = renderBasicTonePreviewPixels(PREVIEW_PROOF_PIXELS, command);
  const previewAfter = buildPreviewAfter({
    commandId: command.commandId,
    graphRevision: dryRunResult.predictedGraphRevision,
    renderHash: hashBasicTonePreviewPixels(afterPixels),
    sessionId: parsedRequest.sessionId,
    sourceGraphRevision: dryRunResult.sourceGraphRevision,
  });
  const adjustedFields = getAdjustedFields(parsedRequest.adjustments);
  const auditEventIds = bridge.listAuditEvents().map((event) => event.eventId);
  const receipt: AgentToneAdjustmentDryRunResponse['receipt'] = {
    adjustedFields,
    auditEventIds,
    commandId: command.commandId,
    dryRunPlanHash: dryRunResult.dryRunPlanHash,
    dryRunPlanId: dryRunResult.dryRunPlanId,
    expectedGraphRevision: parsedRequest.expectedGraphRevision,
    expectedRecipeHash: parsedRequest.expectedRecipeHash,
    operationId: parsedRequest.operationId,
    previewAfter,
    sessionId: parsedRequest.sessionId,
    sourceGraphRevision: dryRunResult.sourceGraphRevision,
  };
  acceptedToneAdjustmentDryRunReceipts.set(
    buildDryRunReceiptKey({
      expectedGraphRevision: parsedRequest.expectedGraphRevision,
      planHash: dryRunResult.dryRunPlanHash,
      planId: dryRunResult.dryRunPlanId,
    }),
    {
      ...receipt,
      adjustments: parsedRequest.adjustments,
      basicTonePlanHash: dryRunResult.dryRunPlanHash,
      basicTonePlanId: dryRunResult.dryRunPlanId,
    },
  );

  return agentToneAdjustmentDryRunResponseSchema.parse({
    adjustedFields,
    auditEventIds,
    commandId: command.commandId,
    dryRunPlanHash: dryRunResult.dryRunPlanHash,
    dryRunPlanId: dryRunResult.dryRunPlanId,
    editRevision: {
      current: dryRunResult.sourceGraphRevision,
      predicted: dryRunResult.predictedGraphRevision,
    },
    expectedRevisionMatched: true,
    predictedGraphRevision: dryRunResult.predictedGraphRevision,
    previewAfter,
    receipt,
    requestId: parsedRequest.requestId,
    sourceGraphRevision: dryRunResult.sourceGraphRevision,
    stale,
    toolName: AGENT_TONE_ADJUSTMENT_DRY_RUN_TOOL_NAME,
    warnings: dryRunResult.warnings,
  });
};

export const applyAgentToneAdjustment = async (
  request: AgentToneAdjustmentApplyRequest,
  bridge: RawEngineLocalAppServerBridge = createLiveEditorAppServerBridge(),
): Promise<AgentToneAdjustmentApplyResponse> => {
  const parsedRequest = agentToneAdjustmentApplyRequestSchema.parse(request);
  const stale = assertExpectedEditorState(parsedRequest);
  const acceptedReceipt = acceptedToneAdjustmentDryRunReceipts.get(
    buildDryRunReceiptKey({
      expectedGraphRevision: parsedRequest.expectedGraphRevision,
      planHash: parsedRequest.acceptedPlanHash,
      planId: parsedRequest.acceptedPlanId,
    }),
  );
  if (acceptedReceipt === undefined) throw new Error('Agent tone adjustment apply rejected missing dry-run receipt.');
  if (
    acceptedReceipt.operationId !== parsedRequest.operationId ||
    acceptedReceipt.sessionId !== parsedRequest.sessionId ||
    JSON.stringify(acceptedReceipt.adjustments) !== JSON.stringify(parsedRequest.adjustments)
  ) {
    throw new Error('Agent tone adjustment apply rejected mismatched dry-run receipt.');
  }

  const initialState = useEditorStore.getState();
  const imagePath = initialState.selectedImage?.path;
  if (imagePath === undefined) throw new Error('Cannot apply agent tone adjustment without a selected image.');
  const commitIdentity = captureBasicToneCommitIdentity(initialState);
  if (commitIdentity === null) throw new Error('Cannot apply agent tone adjustment without a selected image session.');

  const context = buildBasicToneImageCommandContext({
    expectedGraphRevision: parsedRequest.expectedGraphRevision,
    imagePath,
    operationId: parsedRequest.operationId,
    sessionId: parsedRequest.sessionId,
  });
  const requestedAdjustments = buildRequestedBasicTone(initialState.editDocumentV2, parsedRequest.adjustments);
  const dryRunCommand = buildBasicToneCommandEnvelope(requestedAdjustments, context, { dryRun: true });
  const applyCommand = buildBasicToneCommandEnvelope(requestedAdjustments, context, {
    acceptedDryRunPlanHash: acceptedReceipt.basicTonePlanHash,
    acceptedDryRunPlanId: acceptedReceipt.basicTonePlanId,
    dryRun: false,
  });
  const nextAdjustments = applyTonePatchToDocument(initialState.editDocumentV2, parsedRequest.adjustments);
  const adjustedFields = getAdjustedFields(parsedRequest.adjustments).filter(
    (key) =>
      selectEditDocumentControlValue(initialState.editDocumentV2, key) !==
      selectEditDocumentControlValue(nextAdjustments, key),
  );
  let mutation: z.infer<typeof toneColorMutationResultV1Schema> | undefined;
  if (adjustedFields.length > 0) {
    const dryRun = await bridge.dispatch(dryRunCommand, {
      now: () => new Date(),
      requestId: `${parsedRequest.requestId}:preflight`,
    });
    if (!dryRun.ok) throw new Error(`Agent tone adjustment apply preflight failed: ${dryRun.message}`);
    const dryRunResult = toneColorDryRunResultV1Schema.parse(dryRun.result);
    if (
      dryRunResult.dryRunPlanHash !== acceptedReceipt.basicTonePlanHash ||
      dryRunResult.dryRunPlanId !== acceptedReceipt.basicTonePlanId
    ) {
      throw new Error('Agent tone adjustment apply rejected a mismatched dry-run plan identity.');
    }

    const apply = await bridge.dispatch(applyCommand, { now: () => new Date(), requestId: parsedRequest.requestId });
    if (!apply.ok) throw new Error(`Agent tone adjustment apply failed: ${apply.message}`);
    mutation = toneColorMutationResultV1Schema.parse(apply.result);
  }

  const beforePreviewHash = hashBasicTonePreviewPixels(PREVIEW_PROOF_PIXELS);
  const afterPreviewHash = hashBasicTonePreviewPixels(renderBasicTonePreviewPixels(PREVIEW_PROOF_PIXELS, applyCommand));
  if (adjustedFields.length > 0 && beforePreviewHash === afterPreviewHash) {
    throw new Error('Agent tone adjustment apply did not change preview-after proof pixels.');
  }

  if (adjustedFields.length > 0) useEditorStore.getState().applyBasicToneCommand(applyCommand, commitIdentity);

  const appliedGraphRevision = `history_${useEditorStore.getState().historyIndex}`;
  const auditEventIds =
    adjustedFields.length === 0
      ? acceptedReceipt.auditEventIds
      : bridge.listAuditEvents().map((event) => event.eventId);
  const previewAfter = buildPreviewAfter({
    commandId: applyCommand.commandId,
    graphRevision: appliedGraphRevision,
    renderHash: afterPreviewHash,
    sessionId: parsedRequest.sessionId,
    sourceGraphRevision: mutation?.sourceGraphRevision ?? parsedRequest.expectedGraphRevision,
  });

  return agentToneAdjustmentApplyResponseSchema.parse({
    adjustedFields,
    afterPreviewHash,
    appliedGraphRevision,
    auditEventIds,
    beforePreviewHash,
    editRevision: {
      applied: appliedGraphRevision,
      expected: parsedRequest.expectedGraphRevision,
      undo: parsedRequest.expectedGraphRevision,
    },
    expectedRevisionMatched: true,
    previewAfter,
    receipt: {
      acceptedPlanHash: parsedRequest.acceptedPlanHash,
      acceptedPlanId: parsedRequest.acceptedPlanId,
      adjustedFields,
      afterPreviewHash,
      appliedGraphRevision,
      auditEventIds,
      beforePreviewHash,
      expectedGraphRevision: parsedRequest.expectedGraphRevision,
      operationId: parsedRequest.operationId,
      previewAfter,
      sessionId: parsedRequest.sessionId,
      undoGraphRevision: parsedRequest.expectedGraphRevision,
    },
    requestId: parsedRequest.requestId,
    stale,
    toolName: AGENT_TONE_ADJUSTMENT_APPLY_TOOL_NAME,
    undoGraphRevision: parsedRequest.expectedGraphRevision,
    warnings: mutation?.warnings ?? [],
  });
};
