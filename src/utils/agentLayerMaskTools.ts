import { z } from 'zod';

import {
  DEFAULT_LAYER_BLEND_MODE,
  INITIAL_MASK_ADJUSTMENTS,
  type MaskContainer,
  type MaskAdjustments,
} from './adjustments';
import { buildAgentImageContextSnapshot } from './agentImageContextSnapshot';
import { stableAgentPreviewHash } from './agentPreviewEnvelope';
import { pushEditHistoryEntry } from './editHistory';
import { applyLayerStackCommandBridgeOperation } from './layerStackCommandBridge';
import { artifactHandleV1Schema, type ArtifactHandleV1 } from '../../packages/rawengine-schema/src';
import {
  ActorKind,
  ApprovalClass,
  BrushMaskCommandRuntime,
  RAW_ENGINE_SCHEMA_VERSION,
  layerMaskBlendModeV1Schema,
  layerMaskBrushStrokeV1Schema,
  layerScopedToneAdjustmentV1Schema,
  layerMaskCommandEnvelopeV1Schema,
} from '../../packages/rawengine-schema/src';
import { Mask, SubMaskMode, type SubMask } from '../components/panel/right/Masks';
import { useEditorStore } from '../store/useEditorStore';

export const AGENT_LAYER_CREATE_TOOL_NAME = 'rawengine.agent.layer.create';
export const AGENT_MASK_CREATE_OR_UPDATE_TOOL_NAME = 'rawengine.agent.mask.create_or_update';
export const AGENT_LAYER_CREATE_INPUT_SCHEMA_NAME = 'AgentLayerCreateRequestV1';
export const AGENT_LAYER_CREATE_OUTPUT_SCHEMA_NAME = 'AgentLayerCreateResponseV1';
export const AGENT_MASK_CREATE_OR_UPDATE_INPUT_SCHEMA_NAME = 'AgentMaskCreateOrUpdateRequestV1';
export const AGENT_MASK_CREATE_OR_UPDATE_OUTPUT_SCHEMA_NAME = 'AgentMaskCreateOrUpdateResponseV1';

const idSegmentSchema = z
  .string()
  .trim()
  .min(1)
  .max(96)
  .regex(/^[a-zA-Z0-9_-]+$/u);

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

export const agentLayerCreateRequestSchema = z
  .object({
    adjustments: layerScopedToneAdjustmentV1Schema.optional(),
    blendMode: layerMaskBlendModeV1Schema.default(DEFAULT_LAYER_BLEND_MODE),
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

export const agentLayerCreateResponseSchema = z
  .object({
    afterPreviewHash: z.string().trim().min(1),
    appliedGraphRevision: z.string().trim().min(1),
    beforePreviewHash: z.string().trim().min(1),
    layerId: z.string().trim().min(1),
    layerName: z.string().trim().min(1),
    requestId: z.string().trim().min(1),
    overlayPreview: agentLayerMaskOverlayPreviewSchema,
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
    overlayPreview: agentLayerMaskOverlayPreviewSchema,
    requestId: z.string().trim().min(1),
    staleRecipeHash: z.literal(false),
    toolName: z.literal(AGENT_MASK_CREATE_OR_UPDATE_TOOL_NAME),
    undoGraphRevision: z.string().trim().min(1),
  })
  .strict();

export type AgentLayerCreateRequest = z.infer<typeof agentLayerCreateRequestSchema>;
export type AgentLayerCreateResponse = z.infer<typeof agentLayerCreateResponseSchema>;
export type AgentMaskCreateOrUpdateRequest = z.infer<typeof agentMaskCreateOrUpdateRequestSchema>;
export type AgentMaskCreateOrUpdateResponse = z.infer<typeof agentMaskCreateOrUpdateResponseSchema>;
export type AgentLayerMaskOverlayPreview = z.infer<typeof agentLayerMaskOverlayPreviewSchema>;

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

  const result = applyLayerStackCommandBridgeOperation(
    state.adjustments.masks,
    { layer: makeLayer(parsedRequest), type: 'create' },
    {
      graphRevision: beforeSnapshot.graphRevision,
      imagePath: selectedImage.path,
      operationId: parsedRequest.operationId,
      sessionId: parsedRequest.sessionId,
    },
  );
  const undoGraphRevision = beforeSnapshot.graphRevision;
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
    overlayPreview: buildOverlayPreview({
      afterSnapshot,
      contentSeed: { layer: overlayLayer, operationId: parsedRequest.operationId },
      layer: overlayLayer,
      operationId: parsedRequest.operationId,
    }),
    requestId: parsedRequest.requestId,
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
  const applyCommand = buildBrushMaskCommand(parsedRequest, false, beforeSnapshot.graphRevision, selectedImage.path);
  const mutation = runtime.dispatch(applyCommand, { height, width });
  if (mutation.dryRun) throw new Error('Agent mask create/update expected a mutation result.');

  const maskId =
    parsedRequest.maskId ?? mutation.changedMaskIds[0] ?? `mask_brush_${toIdSegment(parsedRequest.operationId)}`;
  const maskContentHash = dryRunResult.maskArtifacts[0]?.contentHash;
  if (maskContentHash === undefined) throw new Error('Agent mask create/update did not return mask artifact proof.');
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
    overlayPreview: buildOverlayPreview({
      afterSnapshot,
      contentSeed: { maskContentHash, operationId: parsedRequest.operationId, strokes: parsedRequest.strokes },
      layer: overlayLayer,
      maskId,
      operationId: parsedRequest.operationId,
    }),
    requestId: parsedRequest.requestId,
    staleRecipeHash: false,
    toolName: AGENT_MASK_CREATE_OR_UPDATE_TOOL_NAME,
    undoGraphRevision,
  });
};
