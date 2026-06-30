import { z } from 'zod';
import {
  ActorKind,
  ApprovalClass,
  type ArtifactHandleV1,
  artifactHandleV1Schema,
  BrushMaskCommandRuntime,
  layerMaskBlendModeV1Schema,
  layerMaskBrushStrokeV1Schema,
  layerMaskCommandEnvelopeV1Schema,
  layerScopedToneAdjustmentV1Schema,
  RAW_ENGINE_SCHEMA_VERSION,
} from '../../packages/rawengine-schema/src';
import { Mask, type SubMask, SubMaskMode } from '../components/panel/right/layers/Masks';
import { useEditorStore } from '../store/useEditorStore';
import {
  DEFAULT_LAYER_BLEND_MODE,
  INITIAL_MASK_ADJUSTMENTS,
  type MaskAdjustments,
  type MaskContainer,
} from './adjustments';
import { agentApprovalStateSchema, assertAgentApprovalGate } from './agentApprovalGate';
import { buildAgentImageContextSnapshot } from './agentImageContextSnapshot';
import { stableAgentPreviewHash } from './agentPreviewEnvelope';
import { pushEditHistoryEntry } from './editHistory';
import { applyLayerStackCommandBridgeOperation } from './layerStackCommandBridge';

export const AGENT_LAYER_CREATE_TOOL_NAME = 'rawengine.agent.layer.create';
export const AGENT_MASK_CREATE_OR_UPDATE_TOOL_NAME = 'rawengine.agent.mask.create_or_update';
export const AGENT_LAYER_SCOPED_ADJUST_TOOL_NAME = 'rawengine.agent.layer.adjustments.apply';
export const AGENT_OBJECT_SELECTION_APPLY_TOOL_NAME = 'rawengine.agent.object_selection.apply';
export const AGENT_LAYER_CREATE_INPUT_SCHEMA_NAME = 'AgentLayerCreateRequestV1';
export const AGENT_LAYER_CREATE_OUTPUT_SCHEMA_NAME = 'AgentLayerCreateResponseV1';
export const AGENT_MASK_CREATE_OR_UPDATE_INPUT_SCHEMA_NAME = 'AgentMaskCreateOrUpdateRequestV1';
export const AGENT_MASK_CREATE_OR_UPDATE_OUTPUT_SCHEMA_NAME = 'AgentMaskCreateOrUpdateResponseV1';
export const AGENT_LAYER_SCOPED_ADJUST_INPUT_SCHEMA_NAME = 'AgentLayerScopedAdjustRequestV1';
export const AGENT_LAYER_SCOPED_ADJUST_OUTPUT_SCHEMA_NAME = 'AgentLayerScopedAdjustResponseV1';
export const AGENT_OBJECT_SELECTION_APPLY_INPUT_SCHEMA_NAME = 'AgentObjectSelectionApplyRequestV1';
export const AGENT_OBJECT_SELECTION_APPLY_OUTPUT_SCHEMA_NAME = 'AgentObjectSelectionApplyResponseV1';

const idSegmentSchema = z
  .string()
  .trim()
  .min(1)
  .max(96)
  .regex(/^[a-zA-Z0-9_-]+$/u);
const normalizedPointSchema = z
  .object({
    label: z.enum(['foreground', 'background']).default('foreground'),
    x: z.number().min(0).max(1),
    y: z.number().min(0).max(1),
  })
  .strict();
const normalizedBoxSchema = z
  .object({
    height: z.number().positive().max(1),
    width: z.number().positive().max(1),
    x: z.number().min(0).max(1),
    y: z.number().min(0).max(1),
  })
  .strict()
  .superRefine((box, context) => {
    if (box.x + box.width > 1) {
      context.addIssue({ code: 'custom', message: 'Object selection box exceeds normalized width.', path: ['width'] });
    }
    if (box.y + box.height > 1) {
      context.addIssue({
        code: 'custom',
        message: 'Object selection box exceeds normalized height.',
        path: ['height'],
      });
    }
  });

const objectMaskProposalSchema = z
  .object({
    clickToMaskLatencyMs: z.number().nonnegative(),
    decoderLatencyMs: z.number().nonnegative(),
    embeddingLatencyMs: z.number().nonnegative().nullable().optional(),
    imageHeight: z.number().int().positive(),
    imageWidth: z.number().int().positive(),
    maskDataBase64: z.string().trim().startsWith('data:image/png;base64,'),
    modelId: z.string().trim().min(1),
    promptCount: z.number().int().positive(),
    promptKind: z.enum(['box', 'point']),
    providerId: z.string().trim().min(1),
  })
  .strict();

const agentLayerMaskOverlayPreviewSchema = z
  .object({
    artifact: artifactHandleV1Schema,
    layerId: z.string().trim().min(1),
    maskId: z.string().trim().min(1).optional(),
    opacity: z.number().int().min(0).max(100),
    recipeHash: z.string().trim().min(1),
    renderHash: z.string().trim().min(1),
    visible: z.boolean(),
  })
  .strict();

const agentLayerMaskApplyReceiptSchema = z
  .object({
    appliedGraphRevision: z.string().trim().min(1),
    approvalId: z.string().trim().min(1).optional(),
    commandId: z.string().trim().min(1),
    commandType: z.string().trim().min(1),
    dryRunPlanId: z.string().trim().min(1),
    operationId: z.string().trim().min(1),
    rollbackGraphRevision: z.string().trim().min(1),
    sessionId: z.string().trim().min(1),
  })
  .strict();

const agentLayerMaskRollbackTargetSchema = z
  .object({
    graphRevision: z.string().trim().min(1),
    historyIndex: z.number().int().min(0),
    previewUrl: z.string().nullable(),
  })
  .strict();

export const agentLayerCreateRequestSchema = z
  .object({
    adjustments: layerScopedToneAdjustmentV1Schema.optional(),
    approval: agentApprovalStateSchema.optional(),
    blendMode: layerMaskBlendModeV1Schema.default(DEFAULT_LAYER_BLEND_MODE),
    dryRun: z.boolean(),
    expectedRecipeHash: z.string().trim().min(1),
    layerId: idSegmentSchema.optional(),
    name: z.string().trim().min(1).max(80),
    opacity: z.number().int().min(0).max(100).default(100),
    operationId: idSegmentSchema,
    requestId: z.string().trim().min(1),
    sessionId: z.string().trim().min(1),
    visible: z.boolean().default(true),
  })
  .strict();

export const agentMaskCreateOrUpdateRequestSchema = z
  .object({
    approval: agentApprovalStateSchema.optional(),
    dryRun: z.boolean(),
    expectedRecipeHash: z.string().trim().min(1),
    layerId: idSegmentSchema,
    maskId: idSegmentSchema.optional(),
    maskName: z.string().trim().min(1).max(80),
    operationId: idSegmentSchema,
    requestId: z.string().trim().min(1),
    sessionId: z.string().trim().min(1),
    strokes: z.array(layerMaskBrushStrokeV1Schema).min(1).max(16),
  })
  .strict();

export const agentLayerScopedAdjustRequestSchema = z
  .object({
    adjustments: layerScopedToneAdjustmentV1Schema,
    approval: agentApprovalStateSchema.optional(),
    dryRun: z.boolean(),
    expectedRecipeHash: z.string().trim().min(1),
    layerId: idSegmentSchema,
    operationId: idSegmentSchema,
    requestId: z.string().trim().min(1),
    sessionId: z.string().trim().min(1),
  })
  .strict();

export const agentObjectSelectionApplyRequestSchema = z
  .object({
    adjustments: layerScopedToneAdjustmentV1Schema.optional(),
    boxPrompt: normalizedBoxSchema.optional(),
    expectedRecipeHash: z.string().trim().min(1),
    layerId: idSegmentSchema.optional(),
    layerName: z.string().trim().min(1).max(80).default('Object selection'),
    maskId: idSegmentSchema.optional(),
    operationId: idSegmentSchema,
    pointPrompts: z.array(normalizedPointSchema).max(12).default([]),
    proposal: objectMaskProposalSchema.optional(),
    requestId: z.string().trim().min(1),
    sessionId: z.string().trim().min(1),
  })
  .strict()
  .superRefine((request, context) => {
    if (request.boxPrompt === undefined && request.pointPrompts.length === 0) {
      context.addIssue({
        code: 'custom',
        message: 'Object selection requires at least one point prompt or a box prompt.',
        path: ['pointPrompts'],
      });
    }
    if (
      request.pointPrompts.length > 0 &&
      !request.pointPrompts.some((prompt) => prompt.label === 'foreground') &&
      request.boxPrompt === undefined
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Point-only object selection requires at least one foreground point.',
        path: ['pointPrompts'],
      });
    }
  });

export const agentLayerCreateResponseSchema = z
  .object({
    afterPreviewHash: z.string().trim().min(1),
    appliedGraphRevision: z.string().trim().min(1),
    beforePreviewHash: z.string().trim().min(1),
    layerId: z.string().trim().min(1),
    layerName: z.string().trim().min(1),
    mutates: z.boolean(),
    overlayPreview: agentLayerMaskOverlayPreviewSchema,
    receipt: agentLayerMaskApplyReceiptSchema.optional(),
    requestId: z.string().trim().min(1),
    rollbackTarget: agentLayerMaskRollbackTargetSchema.optional(),
    staleRecipeHash: z.literal(false),
    toolName: z.literal(AGENT_LAYER_CREATE_TOOL_NAME),
    undoGraphRevision: z.string().trim().min(1),
  })
  .strict();

export const agentMaskCreateOrUpdateResponseSchema = z
  .object({
    afterPreviewHash: z.string().trim().min(1),
    appliedGraphRevision: z.string().trim().min(1),
    beforePreviewHash: z.string().trim().min(1),
    layerId: z.string().trim().min(1),
    maskContentHash: z.string().trim().min(1),
    maskId: z.string().trim().min(1),
    mutates: z.boolean(),
    overlayPreview: agentLayerMaskOverlayPreviewSchema,
    receipt: agentLayerMaskApplyReceiptSchema.optional(),
    requestId: z.string().trim().min(1),
    rollbackTarget: agentLayerMaskRollbackTargetSchema.optional(),
    staleRecipeHash: z.literal(false),
    toolName: z.literal(AGENT_MASK_CREATE_OR_UPDATE_TOOL_NAME),
    undoGraphRevision: z.string().trim().min(1),
  })
  .strict();

export const agentLayerScopedAdjustResponseSchema = z
  .object({
    adjustedFields: z.array(z.string().trim().min(1)).min(1),
    afterPreviewHash: z.string().trim().min(1),
    appliedGraphRevision: z.string().trim().min(1),
    beforePreviewHash: z.string().trim().min(1),
    layerId: z.string().trim().min(1),
    mutates: z.boolean(),
    overlayPreview: agentLayerMaskOverlayPreviewSchema,
    receipt: agentLayerMaskApplyReceiptSchema.optional(),
    requestId: z.string().trim().min(1),
    rollbackTarget: agentLayerMaskRollbackTargetSchema.optional(),
    staleRecipeHash: z.literal(false),
    toolName: z.literal(AGENT_LAYER_SCOPED_ADJUST_TOOL_NAME),
    undoGraphRevision: z.string().trim().min(1),
  })
  .strict();

export const agentObjectSelectionApplyResponseSchema = z
  .object({
    afterPreviewHash: z.string().trim().min(1),
    appliedGraphRevision: z.string().trim().min(1),
    beforePreviewHash: z.string().trim().min(1),
    layerId: z.string().trim().min(1),
    maskId: z.string().trim().min(1),
    objectPromptHash: z.string().trim().min(1),
    overlayPreview: agentLayerMaskOverlayPreviewSchema,
    providerStatus: z.enum(['local_sam_proposal_v1', 'prompt_proxy_mask_v1']),
    requestId: z.string().trim().min(1),
    staleRecipeHash: z.literal(false),
    toolName: z.literal(AGENT_OBJECT_SELECTION_APPLY_TOOL_NAME),
    undoGraphRevision: z.string().trim().min(1),
  })
  .strict();

export type AgentLayerCreateRequest = z.infer<typeof agentLayerCreateRequestSchema>;
export type AgentLayerCreateResponse = z.infer<typeof agentLayerCreateResponseSchema>;
export type AgentMaskCreateOrUpdateRequest = z.infer<typeof agentMaskCreateOrUpdateRequestSchema>;
export type AgentMaskCreateOrUpdateResponse = z.infer<typeof agentMaskCreateOrUpdateResponseSchema>;
export type AgentLayerScopedAdjustRequest = z.infer<typeof agentLayerScopedAdjustRequestSchema>;
export type AgentLayerScopedAdjustResponse = z.infer<typeof agentLayerScopedAdjustResponseSchema>;
export type AgentObjectSelectionApplyRequest = z.infer<typeof agentObjectSelectionApplyRequestSchema>;
export type AgentObjectSelectionApplyResponse = z.infer<typeof agentObjectSelectionApplyResponseSchema>;
export type AgentLayerMaskOverlayPreview = z.infer<typeof agentLayerMaskOverlayPreviewSchema>;
type ObjectSelectionProviderStatus = z.infer<typeof agentObjectSelectionApplyResponseSchema>['providerStatus'];

const toIdSegment = (value: string): string =>
  value
    .toLocaleLowerCase('en-US')
    .replace(/[^a-z0-9_-]+/gu, '_')
    .replace(/^_+|_+$/gu, '')
    .slice(0, 80) || 'agent_layer';

const cloneInitialMaskAdjustments = (): MaskAdjustments => structuredClone(INITIAL_MASK_ADJUSTMENTS);

const toMaskAdjustments = (
  adjustments: z.infer<typeof layerScopedToneAdjustmentV1Schema> | undefined,
): MaskAdjustments => {
  const next = cloneInitialMaskAdjustments();
  if (adjustments === undefined) return next;

  next.blacks = adjustments.blackPoint;
  next.clarity = adjustments.clarity;
  next.contrast = adjustments.contrast;
  next.exposure = adjustments.exposureEv;
  next.highlights = adjustments.highlights;
  next.saturation = adjustments.saturation;
  next.shadows = adjustments.shadows;
  next.whites = adjustments.whitePoint;
  return next;
};

const ensureFreshRecipe = (expectedRecipeHash: string): ReturnType<typeof buildAgentImageContextSnapshot> => {
  const snapshot = buildAgentImageContextSnapshot();
  if (expectedRecipeHash !== snapshot.initialPreview.recipeHash) {
    throw new Error('Agent layer/mask tool rejected stale recipe hash.');
  }
  return snapshot;
};

const assertApprovedLayerMaskApply = ({
  approval,
  operation,
  sessionId,
  snapshot,
}: {
  approval: z.infer<typeof agentApprovalStateSchema> | undefined;
  operation: string;
  sessionId: string;
  snapshot: ReturnType<typeof buildAgentImageContextSnapshot>;
}): z.infer<typeof agentApprovalStateSchema> => {
  if (approval === undefined) throw new Error(`Agent ${operation} requires approved backend approval state.`);
  return assertAgentApprovalGate({
    approval,
    expectedGraphRevision: snapshot.graphRevision,
    expectedRecipeHash: snapshot.initialPreview.recipeHash,
    expectedSessionId: sessionId,
    operation,
    selectedImagePath: snapshot.activeImagePath,
  });
};

const buildPredictedPreviewHash = (beforeHash: string, seed: unknown): string =>
  `agent-preview:${stableAgentPreviewHash(JSON.stringify({ beforeHash, seed }))}`;

const buildDryRunPlanId = (operationId: string, seed: unknown): string =>
  `dry_run_layer_mask_${operationId}_${stableAgentPreviewHash(JSON.stringify(seed))}`;

const buildApplyReceipt = ({
  appliedGraphRevision,
  approvalId,
  commandId,
  commandType,
  dryRunPlanId,
  operationId,
  rollbackGraphRevision,
  sessionId,
}: {
  appliedGraphRevision: string;
  approvalId?: string;
  commandId: string;
  commandType: string;
  dryRunPlanId: string;
  operationId: string;
  rollbackGraphRevision: string;
  sessionId: string;
}): z.infer<typeof agentLayerMaskApplyReceiptSchema> =>
  agentLayerMaskApplyReceiptSchema.parse({
    appliedGraphRevision,
    ...(approvalId === undefined ? {} : { approvalId }),
    commandId,
    commandType,
    dryRunPlanId,
    operationId,
    rollbackGraphRevision,
    sessionId,
  });

const buildRollbackTarget = (
  graphRevision: string,
  state: ReturnType<typeof useEditorStore.getState>,
): z.infer<typeof agentLayerMaskRollbackTargetSchema> =>
  agentLayerMaskRollbackTargetSchema.parse({
    graphRevision,
    historyIndex: state.historyIndex,
    previewUrl: state.finalPreviewUrl,
  });

const makeLayer = (request: z.infer<typeof agentLayerCreateRequestSchema>): MaskContainer => ({
  adjustments: toMaskAdjustments(request.adjustments),
  blendMode: request.blendMode,
  id: request.layerId ?? `agent_layer_${toIdSegment(request.operationId)}`,
  invert: false,
  name: request.name,
  opacity: request.opacity,
  subMasks: [],
  visible: request.visible,
});

const pushMaskHistory = (masks: ReadonlyArray<MaskContainer>): { historyIndex: number } => {
  let nextHistoryIndex = 0;
  useEditorStore.setState((state) => {
    const adjustments = { ...state.adjustments, masks: [...masks] };
    const history = pushEditHistoryEntry(state.history, state.historyIndex, adjustments);
    nextHistoryIndex = history.historyIndex;
    return {
      adjustments,
      history: history.history,
      historyIndex: history.historyIndex,
      uncroppedAdjustedPreviewUrl: null,
    };
  });
  return { historyIndex: nextHistoryIndex };
};

const buildOverlayArtifact = ({
  contentSeed,
  height,
  layerId,
  maskId,
  operationId,
  width,
}: {
  contentSeed: unknown;
  height: number;
  layerId: string;
  maskId?: string;
  operationId: string;
  width: number;
}): ArtifactHandleV1 => {
  const hash = stableAgentPreviewHash(JSON.stringify(contentSeed));
  return artifactHandleV1Schema.parse({
    artifactId: `artifact_agent_overlay_${operationId}_${maskId ?? layerId}_${hash}`,
    contentHash: `sha256:${hash}`,
    dimensions: { height, width },
    kind: 'preview',
    storage: 'temp_cache',
  });
};

const buildOverlayPreview = ({
  afterSnapshot,
  contentSeed,
  layer,
  maskId,
  operationId,
}: {
  afterSnapshot: ReturnType<typeof buildAgentImageContextSnapshot>;
  contentSeed: unknown;
  layer: MaskContainer;
  maskId?: string;
  operationId: string;
}): AgentLayerMaskOverlayPreview =>
  agentLayerMaskOverlayPreviewSchema.parse({
    artifact: buildOverlayArtifact({
      contentSeed,
      height: afterSnapshot.initialPreview.height,
      layerId: layer.id,
      ...(maskId === undefined ? {} : { maskId }),
      operationId,
      width: afterSnapshot.initialPreview.width,
    }),
    layerId: layer.id,
    ...(maskId === undefined ? {} : { maskId }),
    opacity: layer.opacity,
    recipeHash: afterSnapshot.initialPreview.recipeHash,
    renderHash: afterSnapshot.initialPreview.renderHash,
    visible: layer.visible,
  });

export const applyAgentLayerCreate = (request: AgentLayerCreateRequest): AgentLayerCreateResponse => {
  const parsedRequest = agentLayerCreateRequestSchema.parse(request);
  const beforeSnapshot = ensureFreshRecipe(parsedRequest.expectedRecipeHash);
  const state = useEditorStore.getState();
  const selectedImage = state.selectedImage;
  if (selectedImage === null) throw new Error('Agent layer create requires a selected image.');
  const layer = makeLayer(parsedRequest);
  const undoGraphRevision = beforeSnapshot.graphRevision;
  const dryRunPlanId = buildDryRunPlanId(parsedRequest.operationId, { layer, toolName: AGENT_LAYER_CREATE_TOOL_NAME });
  const predictedHash = buildPredictedPreviewHash(beforeSnapshot.initialPreview.renderHash, { dryRunPlanId, layer });

  if (parsedRequest.dryRun) {
    return agentLayerCreateResponseSchema.parse({
      afterPreviewHash: predictedHash,
      appliedGraphRevision: beforeSnapshot.graphRevision,
      beforePreviewHash: beforeSnapshot.initialPreview.renderHash,
      layerId: layer.id,
      layerName: parsedRequest.name,
      mutates: false,
      overlayPreview: {
        artifact: buildOverlayArtifact({
          contentSeed: { dryRunPlanId, layer, operationId: parsedRequest.operationId },
          height: beforeSnapshot.initialPreview.height,
          layerId: layer.id,
          operationId: parsedRequest.operationId,
          width: beforeSnapshot.initialPreview.width,
        }),
        layerId: layer.id,
        opacity: layer.opacity,
        recipeHash: beforeSnapshot.initialPreview.recipeHash,
        renderHash: predictedHash,
        visible: layer.visible,
      },
      requestId: parsedRequest.requestId,
      staleRecipeHash: false,
      toolName: AGENT_LAYER_CREATE_TOOL_NAME,
      undoGraphRevision,
    });
  }

  const approval = assertApprovedLayerMaskApply({
    approval: parsedRequest.approval,
    operation: 'layer create',
    sessionId: parsedRequest.sessionId,
    snapshot: beforeSnapshot,
  });
  const rollbackTarget = buildRollbackTarget(undoGraphRevision, state);

  const result = applyLayerStackCommandBridgeOperation(
    state.adjustments.masks,
    { layer, type: 'create' },
    {
      graphRevision: beforeSnapshot.graphRevision,
      imagePath: selectedImage.path,
      operationId: parsedRequest.operationId,
      sessionId: parsedRequest.sessionId,
    },
  );
  pushMaskHistory(result.masks);
  const layerId = result.commandResult.changedLayerIds[0] ?? result.masks[0]?.id;
  if (layerId === undefined) throw new Error('Agent layer create did not return a layer id.');
  useEditorStore.setState({ activeMaskContainerId: layerId });
  const afterSnapshot = buildAgentImageContextSnapshot();
  const overlayLayer = result.masks.find((mask) => mask.id === layerId);
  if (overlayLayer === undefined) throw new Error('Agent layer create could not build an overlay preview.');

  return agentLayerCreateResponseSchema.parse({
    afterPreviewHash: afterSnapshot.initialPreview.renderHash,
    appliedGraphRevision: afterSnapshot.graphRevision,
    beforePreviewHash: beforeSnapshot.initialPreview.renderHash,
    layerId,
    layerName: parsedRequest.name,
    mutates: true,
    overlayPreview: buildOverlayPreview({
      afterSnapshot,
      contentSeed: { layer: overlayLayer, operationId: parsedRequest.operationId },
      layer: overlayLayer,
      operationId: parsedRequest.operationId,
    }),
    receipt: buildApplyReceipt({
      appliedGraphRevision: afterSnapshot.graphRevision,
      approvalId: approval.approvalId,
      commandId: result.command.commandId,
      commandType: result.command.commandType,
      dryRunPlanId,
      operationId: parsedRequest.operationId,
      rollbackGraphRevision: undoGraphRevision,
      sessionId: parsedRequest.sessionId,
    }),
    requestId: parsedRequest.requestId,
    rollbackTarget,
    staleRecipeHash: false,
    toolName: AGENT_LAYER_CREATE_TOOL_NAME,
    undoGraphRevision,
  });
};

const buildBrushMaskCommand = (
  request: z.infer<typeof agentMaskCreateOrUpdateRequestSchema>,
  dryRun: boolean,
  expectedGraphRevision: string,
  imagePath: string,
) =>
  layerMaskCommandEnvelopeV1Schema.parse({
    actor: {
      id: 'rawengine-agent',
      kind: ActorKind.Agent,
      sessionId: request.sessionId,
    },
    approval: {
      approvalClass: dryRun ? ApprovalClass.PreviewOnly : ApprovalClass.EditApply,
      reason: 'Apply agent-requested brush mask to a local adjustment layer.',
      state: 'approved',
    },
    commandId: `agent_mask_${request.operationId}`,
    commandType: 'layerMask.createBrushMask',
    correlationId: `agent_mask_corr_${request.operationId}`,
    dryRun,
    expectedGraphRevision,
    idempotencyKey: `agent_mask_idem_${request.operationId}`,
    parameters: {
      maskName: request.maskName,
      strokes: request.strokes,
    },
    schemaVersion: RAW_ENGINE_SCHEMA_VERSION,
    target: {
      imagePath,
      kind: 'image',
    },
  });

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));

const buildObjectSelectionStrokes = (
  request: z.infer<typeof agentObjectSelectionApplyRequestSchema>,
  imageWidth: number,
  imageHeight: number,
): z.infer<typeof layerMaskBrushStrokeV1Schema>[] => {
  const box = request.boxPrompt;
  const foregroundPoints = request.pointPrompts.filter((prompt) => prompt.label === 'foreground');
  const boxRadius =
    box === undefined ? 0.045 : Math.max(16 / Math.max(imageWidth, imageHeight), Math.min(box.width, box.height) / 5);
  const promptRadiusPx = Math.max(12, Math.min(imageWidth, imageHeight) * boxRadius);
  const boxStroke =
    box === undefined
      ? []
      : [
          {
            flow: 0.95,
            hardness: 0.55,
            mode: 'paint' as const,
            points: [
              { x: clamp01(box.x + box.width * 0.25), y: clamp01(box.y + box.height * 0.25) },
              { x: clamp01(box.x + box.width * 0.75), y: clamp01(box.y + box.height * 0.25) },
              { x: clamp01(box.x + box.width * 0.75), y: clamp01(box.y + box.height * 0.75) },
              { x: clamp01(box.x + box.width * 0.25), y: clamp01(box.y + box.height * 0.75) },
              { x: clamp01(box.x + box.width * 0.5), y: clamp01(box.y + box.height * 0.5) },
            ],
            radiusPx: promptRadiusPx,
            strokeId: `${request.operationId}_box_prompt`,
          },
        ];
  const pointStrokes = foregroundPoints.map((point, index) => ({
    flow: 0.85,
    hardness: 0.45,
    mode: 'paint' as const,
    points: [
      { x: point.x, y: point.y },
      { x: clamp01(point.x + 0.001), y: point.y },
    ],
    radiusPx: Math.max(10, promptRadiusPx * 0.8),
    strokeId: `${request.operationId}_point_${index + 1}`,
  }));

  return z
    .array(layerMaskBrushStrokeV1Schema)
    .min(1)
    .max(16)
    .parse([...boxStroke, ...pointStrokes]);
};

export const applyAgentBrushMaskCreateOrUpdate = (
  request: AgentMaskCreateOrUpdateRequest,
): AgentMaskCreateOrUpdateResponse => {
  const parsedRequest = agentMaskCreateOrUpdateRequestSchema.parse(request);
  const beforeSnapshot = ensureFreshRecipe(parsedRequest.expectedRecipeHash);
  const state = useEditorStore.getState();
  const selectedImage = state.selectedImage;
  if (selectedImage === null) throw new Error('Agent mask create/update requires a selected image.');
  const targetLayer = state.adjustments.masks.find((mask) => mask.id === parsedRequest.layerId);
  if (targetLayer === undefined)
    throw new Error(`Agent mask create/update could not find layer ${parsedRequest.layerId}.`);

  const width = Math.max(1, Math.min(2048, beforeSnapshot.initialPreview.width));
  const height = Math.max(1, Math.min(2048, beforeSnapshot.initialPreview.height));
  const runtime = new BrushMaskCommandRuntime();
  const dryRunCommand = buildBrushMaskCommand(parsedRequest, true, beforeSnapshot.graphRevision, selectedImage.path);
  const dryRunResult = runtime.dispatch(dryRunCommand, { height, width });
  if (!dryRunResult.dryRun) throw new Error('Agent mask create/update expected a dry-run result.');
  const maskId = parsedRequest.maskId ?? `mask_brush_${toIdSegment(parsedRequest.operationId)}`;
  const maskContentHash = dryRunResult.maskArtifacts[0]?.contentHash;
  if (maskContentHash === undefined) throw new Error('Agent mask create/update did not return mask artifact proof.');
  const dryRunPlanId = buildDryRunPlanId(parsedRequest.operationId, {
    maskContentHash,
    maskId,
    strokes: parsedRequest.strokes,
    toolName: AGENT_MASK_CREATE_OR_UPDATE_TOOL_NAME,
  });
  const predictedHash = buildPredictedPreviewHash(beforeSnapshot.initialPreview.renderHash, {
    dryRunPlanId,
    maskContentHash,
  });

  if (parsedRequest.dryRun) {
    return agentMaskCreateOrUpdateResponseSchema.parse({
      afterPreviewHash: predictedHash,
      appliedGraphRevision: beforeSnapshot.graphRevision,
      beforePreviewHash: beforeSnapshot.initialPreview.renderHash,
      layerId: parsedRequest.layerId,
      maskContentHash,
      maskId,
      mutates: false,
      overlayPreview: {
        artifact: buildOverlayArtifact({
          contentSeed: { dryRunPlanId, maskContentHash, operationId: parsedRequest.operationId },
          height: beforeSnapshot.initialPreview.height,
          layerId: targetLayer.id,
          maskId,
          operationId: parsedRequest.operationId,
          width: beforeSnapshot.initialPreview.width,
        }),
        layerId: targetLayer.id,
        maskId,
        opacity: targetLayer.opacity,
        recipeHash: beforeSnapshot.initialPreview.recipeHash,
        renderHash: predictedHash,
        visible: targetLayer.visible,
      },
      requestId: parsedRequest.requestId,
      staleRecipeHash: false,
      toolName: AGENT_MASK_CREATE_OR_UPDATE_TOOL_NAME,
      undoGraphRevision: beforeSnapshot.graphRevision,
    });
  }

  const approval = assertApprovedLayerMaskApply({
    approval: parsedRequest.approval,
    operation: 'mask create/update',
    sessionId: parsedRequest.sessionId,
    snapshot: beforeSnapshot,
  });
  const rollbackTarget = buildRollbackTarget(beforeSnapshot.graphRevision, state);
  const applyCommand = buildBrushMaskCommand(parsedRequest, false, beforeSnapshot.graphRevision, selectedImage.path);
  const mutation = runtime.dispatch(applyCommand, { height, width });
  if (mutation.dryRun) throw new Error('Agent mask create/update expected a mutation result.');

  const subMask: SubMask = {
    id: maskId,
    invert: false,
    mode: SubMaskMode.Additive,
    name: parsedRequest.maskName,
    opacity: 100,
    parameters: {
      commandId: mutation.commandId,
      contentHash: maskContentHash,
      height,
      strokes: parsedRequest.strokes,
      width,
    },
    type: Mask.Brush,
    visible: true,
  };

  const nextMasks = state.adjustments.masks.map((mask) =>
    mask.id === parsedRequest.layerId
      ? {
          ...mask,
          subMasks: [...mask.subMasks.filter((candidate) => candidate.id !== maskId), subMask],
        }
      : mask,
  );

  const undoGraphRevision = beforeSnapshot.graphRevision;
  pushMaskHistory(nextMasks);
  useEditorStore.setState({ activeMaskContainerId: parsedRequest.layerId, activeMaskId: maskId });
  const afterSnapshot = buildAgentImageContextSnapshot();
  const overlayLayer = nextMasks.find((mask) => mask.id === parsedRequest.layerId);
  if (overlayLayer === undefined) throw new Error('Agent mask create/update could not build an overlay preview.');

  return agentMaskCreateOrUpdateResponseSchema.parse({
    afterPreviewHash: afterSnapshot.initialPreview.renderHash,
    appliedGraphRevision: afterSnapshot.graphRevision,
    beforePreviewHash: beforeSnapshot.initialPreview.renderHash,
    layerId: parsedRequest.layerId,
    maskContentHash,
    maskId,
    mutates: true,
    overlayPreview: buildOverlayPreview({
      afterSnapshot,
      contentSeed: { maskContentHash, operationId: parsedRequest.operationId, strokes: parsedRequest.strokes },
      layer: overlayLayer,
      maskId,
      operationId: parsedRequest.operationId,
    }),
    receipt: buildApplyReceipt({
      appliedGraphRevision: afterSnapshot.graphRevision,
      approvalId: approval.approvalId,
      commandId: applyCommand.commandId,
      commandType: applyCommand.commandType,
      dryRunPlanId,
      operationId: parsedRequest.operationId,
      rollbackGraphRevision: undoGraphRevision,
      sessionId: parsedRequest.sessionId,
    }),
    requestId: parsedRequest.requestId,
    rollbackTarget,
    staleRecipeHash: false,
    toolName: AGENT_MASK_CREATE_OR_UPDATE_TOOL_NAME,
    undoGraphRevision,
  });
};

const layerScopedAdjustmentFields = (
  adjustments: z.infer<typeof layerScopedToneAdjustmentV1Schema>,
): Array<keyof z.infer<typeof layerScopedToneAdjustmentV1Schema>> =>
  (
    ['blackPoint', 'clarity', 'contrast', 'exposureEv', 'highlights', 'saturation', 'shadows', 'whitePoint'] as const
  ).filter((key) => adjustments[key] !== 0);

export const applyAgentLayerScopedAdjustments = (
  request: AgentLayerScopedAdjustRequest,
): AgentLayerScopedAdjustResponse => {
  const parsedRequest = agentLayerScopedAdjustRequestSchema.parse(request);
  const beforeSnapshot = ensureFreshRecipe(parsedRequest.expectedRecipeHash);
  const state = useEditorStore.getState();
  const selectedImage = state.selectedImage;
  if (selectedImage === null) throw new Error('Agent layer scoped adjustment requires a selected image.');
  const targetLayer = state.adjustments.masks.find((mask) => mask.id === parsedRequest.layerId);
  if (targetLayer === undefined)
    throw new Error(`Agent layer scoped adjustment could not find layer ${parsedRequest.layerId}.`);

  const adjustedFields = layerScopedAdjustmentFields(parsedRequest.adjustments);
  const previewLayer = { ...targetLayer, adjustments: toMaskAdjustments(parsedRequest.adjustments) };
  const dryRunPlanId = buildDryRunPlanId(parsedRequest.operationId, {
    adjustments: parsedRequest.adjustments,
    layerId: parsedRequest.layerId,
    toolName: AGENT_LAYER_SCOPED_ADJUST_TOOL_NAME,
  });
  const predictedHash = buildPredictedPreviewHash(beforeSnapshot.initialPreview.renderHash, {
    dryRunPlanId,
    layer: previewLayer,
  });

  if (parsedRequest.dryRun) {
    return agentLayerScopedAdjustResponseSchema.parse({
      adjustedFields,
      afterPreviewHash: predictedHash,
      appliedGraphRevision: beforeSnapshot.graphRevision,
      beforePreviewHash: beforeSnapshot.initialPreview.renderHash,
      layerId: parsedRequest.layerId,
      mutates: false,
      overlayPreview: {
        artifact: buildOverlayArtifact({
          contentSeed: { dryRunPlanId, layer: previewLayer, operationId: parsedRequest.operationId },
          height: beforeSnapshot.initialPreview.height,
          layerId: parsedRequest.layerId,
          operationId: parsedRequest.operationId,
          width: beforeSnapshot.initialPreview.width,
        }),
        layerId: parsedRequest.layerId,
        opacity: previewLayer.opacity,
        recipeHash: beforeSnapshot.initialPreview.recipeHash,
        renderHash: predictedHash,
        visible: previewLayer.visible,
      },
      requestId: parsedRequest.requestId,
      staleRecipeHash: false,
      toolName: AGENT_LAYER_SCOPED_ADJUST_TOOL_NAME,
      undoGraphRevision: beforeSnapshot.graphRevision,
    });
  }

  const approval = assertApprovedLayerMaskApply({
    approval: parsedRequest.approval,
    operation: 'layer scoped adjustment',
    sessionId: parsedRequest.sessionId,
    snapshot: beforeSnapshot,
  });
  const rollbackTarget = buildRollbackTarget(beforeSnapshot.graphRevision, state);
  const result = applyLayerStackCommandBridgeOperation(
    state.adjustments.masks,
    {
      layerId: parsedRequest.layerId,
      toneColor: parsedRequest.adjustments,
      type: 'applyToneAdjustment',
    },
    {
      graphRevision: beforeSnapshot.graphRevision,
      imagePath: selectedImage.path,
      operationId: parsedRequest.operationId,
      sessionId: parsedRequest.sessionId,
    },
  );
  pushMaskHistory(result.masks);
  useEditorStore.setState({ activeMaskContainerId: parsedRequest.layerId });
  const afterSnapshot = buildAgentImageContextSnapshot();
  const overlayLayer = result.masks.find((mask) => mask.id === parsedRequest.layerId);
  if (overlayLayer === undefined) throw new Error('Agent layer scoped adjustment could not build an overlay preview.');

  return agentLayerScopedAdjustResponseSchema.parse({
    adjustedFields,
    afterPreviewHash: afterSnapshot.initialPreview.renderHash,
    appliedGraphRevision: afterSnapshot.graphRevision,
    beforePreviewHash: beforeSnapshot.initialPreview.renderHash,
    layerId: parsedRequest.layerId,
    mutates: true,
    overlayPreview: buildOverlayPreview({
      afterSnapshot,
      contentSeed: { adjustments: parsedRequest.adjustments, operationId: parsedRequest.operationId },
      layer: overlayLayer,
      operationId: parsedRequest.operationId,
    }),
    receipt: buildApplyReceipt({
      appliedGraphRevision: afterSnapshot.graphRevision,
      approvalId: approval.approvalId,
      commandId: result.command.commandId,
      commandType: result.command.commandType,
      dryRunPlanId,
      operationId: parsedRequest.operationId,
      rollbackGraphRevision: beforeSnapshot.graphRevision,
      sessionId: parsedRequest.sessionId,
    }),
    requestId: parsedRequest.requestId,
    rollbackTarget,
    staleRecipeHash: false,
    toolName: AGENT_LAYER_SCOPED_ADJUST_TOOL_NAME,
    undoGraphRevision: beforeSnapshot.graphRevision,
  });
};

export const applyAgentObjectSelection = (
  request: AgentObjectSelectionApplyRequest,
): AgentObjectSelectionApplyResponse => {
  const parsedRequest = agentObjectSelectionApplyRequestSchema.parse(request);
  const beforeSnapshot = ensureFreshRecipe(parsedRequest.expectedRecipeHash);
  const state = useEditorStore.getState();
  const selectedImage = state.selectedImage;
  if (selectedImage === null) throw new Error('Agent object selection requires a selected image.');

  const layerId = parsedRequest.layerId ?? `agent_object_${toIdSegment(parsedRequest.operationId)}`;
  const maskId = parsedRequest.maskId ?? `${layerId}_prompt_mask`;
  const strokes = buildObjectSelectionStrokes(parsedRequest, selectedImage.width, selectedImage.height);
  const providerStatus: ObjectSelectionProviderStatus =
    parsedRequest.proposal === undefined ? 'prompt_proxy_mask_v1' : 'local_sam_proposal_v1';
  const objectParameters = {
    boxPrompt: parsedRequest.boxPrompt ?? null,
    generatedPreviewStrokes: strokes,
    maskDataBase64: parsedRequest.proposal?.maskDataBase64 ?? null,
    pointPrompts: parsedRequest.pointPrompts,
    proposal: parsedRequest.proposal ?? null,
    providerStatus,
  };
  const layer: MaskContainer = {
    adjustments: toMaskAdjustments(parsedRequest.adjustments),
    blendMode: DEFAULT_LAYER_BLEND_MODE,
    id: layerId,
    invert: false,
    name: parsedRequest.layerName,
    opacity: 100,
    subMasks: [
      {
        id: maskId,
        invert: false,
        mode: SubMaskMode.Additive,
        name: 'Object prompt mask',
        opacity: 100,
        parameters: objectParameters,
        type: Mask.AiObject,
        visible: true,
      },
    ],
    visible: true,
  };

  const result = applyLayerStackCommandBridgeOperation(
    state.adjustments.masks,
    { layer, type: 'create' },
    {
      graphRevision: beforeSnapshot.graphRevision,
      imagePath: selectedImage.path,
      operationId: parsedRequest.operationId,
      sessionId: parsedRequest.sessionId,
    },
  );
  const undoGraphRevision = beforeSnapshot.graphRevision;
  pushMaskHistory(result.masks);
  useEditorStore.setState({ activeMaskContainerId: layerId, activeMaskId: maskId });
  const afterSnapshot = buildAgentImageContextSnapshot();
  const overlayLayer = result.masks.find((mask) => mask.id === layerId);
  if (overlayLayer === undefined) throw new Error('Agent object selection could not build an overlay preview.');
  const objectPromptHash = stableAgentPreviewHash(
    JSON.stringify({
      boxPrompt: parsedRequest.boxPrompt ?? null,
      pointPrompts: parsedRequest.pointPrompts,
      proposal: parsedRequest.proposal ?? null,
      providerStatus,
      strokes,
    }),
  );

  return agentObjectSelectionApplyResponseSchema.parse({
    afterPreviewHash: afterSnapshot.initialPreview.renderHash,
    appliedGraphRevision: afterSnapshot.graphRevision,
    beforePreviewHash: beforeSnapshot.initialPreview.renderHash,
    layerId,
    maskId,
    objectPromptHash: `sha256:${objectPromptHash}`,
    overlayPreview: buildOverlayPreview({
      afterSnapshot,
      contentSeed: { maskId, objectPromptHash, operationId: parsedRequest.operationId, strokes },
      layer: overlayLayer,
      maskId,
      operationId: parsedRequest.operationId,
    }),
    providerStatus,
    requestId: parsedRequest.requestId,
    staleRecipeHash: false,
    toolName: AGENT_OBJECT_SELECTION_APPLY_TOOL_NAME,
    undoGraphRevision,
  });
};
