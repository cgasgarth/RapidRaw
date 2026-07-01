import { z } from 'zod';
import {
  type ArtifactHandleV1,
  artifactHandleV1Schema,
  type LayerRgbPixel,
  layerBlendOutputDeltaSchema,
  renderLayerExportStack,
  renderLayerPreviewStack,
} from '../../../../packages/rawengine-schema/src';
import { Mask, SubMaskMode } from '../../../components/panel/right/layers/Masks';
import { useEditorStore } from '../../../store/useEditorStore';
import {
  DEFAULT_LAYER_BLEND_MODE,
  INITIAL_MASK_ADJUSTMENTS,
  type MaskContainer,
  type RetouchCloneSource,
  type RetouchLayerRuntimeProvenance,
  type RetouchRemoveSource,
} from '../../adjustments';
import { pushEditHistoryEntry } from '../../editHistory';
import { applyLayerStackCommandBridgeOperation } from '../../layers/layerStackCommandBridge';
import { buildAgentImageContextSnapshot } from '../context/agentImageContextSnapshot';
import { stableAgentPreviewHash } from '../context/agentPreviewEnvelope';

export const AGENT_RETOUCH_APPLY_TOOL_NAME = 'rawengine.agent.retouch.apply';
export const AGENT_RETOUCH_APPLY_INPUT_SCHEMA_NAME = 'AgentRetouchApplyRequestV1';
export const AGENT_RETOUCH_APPLY_OUTPUT_SCHEMA_NAME = 'AgentRetouchApplyResponseV1';

const normalizedPointSchema = z
  .object({
    pressure: z.number().min(0).max(1).optional(),
    x: z.number().min(0).max(1),
    y: z.number().min(0).max(1),
  })
  .strict();

const retouchModeSchema = z.enum(['clone', 'heal', 'remove']);
const idSegmentSchema = z
  .string()
  .trim()
  .min(1)
  .max(96)
  .regex(/^[a-zA-Z0-9_-]+$/u);

const agentRetouchOverlayPreviewSchema = z
  .object({
    artifact: artifactHandleV1Schema,
    layerId: z.string().trim().min(1),
    mode: retouchModeSchema,
    opacity: z.number().int().min(0).max(100),
    overlayMaskId: z.string().trim().min(1),
    recipeHash: z.string().trim().min(1),
    renderHash: z.string().trim().min(1),
    visible: z.boolean(),
  })
  .strict();

const agentRetouchOutputProofSchema = z
  .object({
    applyDelta: layerBlendOutputDeltaSchema,
    applyHash: z.string().regex(/^fnv1a32:[0-9a-f]{8}$/u),
    changedOutput: z.boolean(),
    maskAlphaHash: z.string().regex(/^fnv1a32:[0-9a-f]{8}$/u),
    previewApplyParity: z.literal(true),
    previewDelta: layerBlendOutputDeltaSchema,
    previewHash: z.string().regex(/^fnv1a32:[0-9a-f]{8}$/u),
    proofSource: z.literal('mask_aware_retouch_runtime_fixture_v1'),
    resolvedRemoveSourcePoint: normalizedPointSchema.optional(),
    resolvedRemoveSourceOutputSampleHash: z
      .string()
      .regex(/^fnv1a32:[0-9a-f]{8}$/u)
      .optional(),
    resolvedRemoveSourceSampleHash: z
      .string()
      .regex(/^fnv1a32:[0-9a-f]{8}$/u)
      .optional(),
    resolvedRemoveSourceStatus: z.enum(['fallback_unchanged', 'ready']).optional(),
  })
  .strict();

export const agentRetouchApplyRequestSchema = z
  .object({
    expectedRecipeHash: z.string().trim().min(1),
    featherRadiusPx: z.number().min(0).max(256).optional(),
    layerId: idSegmentSchema.optional(),
    mode: retouchModeSchema,
    operationId: idSegmentSchema,
    radiusPx: z.number().positive().max(256),
    requestId: z.string().trim().min(1),
    searchRadiusMultiplier: z.number().min(1).max(8).default(4),
    seed: z.number().int().min(0).max(0xffffffff).default(0),
    sessionId: z.string().trim().min(1),
    sourcePoint: normalizedPointSchema.optional(),
    targetPoint: normalizedPointSchema,
    userConfirmedGenerativeRetouch: z.boolean().default(false),
  })
  .strict()
  .superRefine((request, context) => {
    if ((request.mode === 'clone' || request.mode === 'heal') && request.sourcePoint === undefined) {
      context.addIssue({
        code: 'custom',
        message: 'Clone/heal retouch requires a sourcePoint.',
        path: ['sourcePoint'],
      });
    }
    if (request.mode === 'remove' && !request.userConfirmedGenerativeRetouch) {
      context.addIssue({
        code: 'custom',
        message: 'Remove retouch requires explicit user confirmation.',
        path: ['userConfirmedGenerativeRetouch'],
      });
    }
  });

export const agentRetouchApplyResponseSchema = z
  .object({
    afterPreviewHash: z.string().trim().min(1),
    appliedGraphRevision: z.string().trim().min(1),
    beforePreviewHash: z.string().trim().min(1),
    layerId: z.string().trim().min(1),
    mode: retouchModeSchema,
    overlayPreview: agentRetouchOverlayPreviewSchema,
    overlayMaskId: z.string().trim().min(1),
    outputProof: agentRetouchOutputProofSchema,
    requestId: z.string().trim().min(1),
    staleRecipeHash: z.literal(false),
    toolName: z.literal(AGENT_RETOUCH_APPLY_TOOL_NAME),
    undoGraphRevision: z.string().trim().min(1),
  })
  .strict();

export type AgentRetouchApplyRequest = z.infer<typeof agentRetouchApplyRequestSchema>;
export type AgentRetouchApplyResponse = z.infer<typeof agentRetouchApplyResponseSchema>;
export type AgentRetouchOverlayPreview = z.infer<typeof agentRetouchOverlayPreviewSchema>;
export type AgentRetouchOutputProof = z.infer<typeof agentRetouchOutputProofSchema>;

const toIdSegment = (value: string): string =>
  value
    .toLocaleLowerCase('en-US')
    .replace(/[^a-z0-9_-]+/gu, '_')
    .replace(/^_+|_+$/gu, '')
    .slice(0, 80) || 'retouch';

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));

const ensureFreshRecipe = (expectedRecipeHash: string): ReturnType<typeof buildAgentImageContextSnapshot> => {
  const snapshot = buildAgentImageContextSnapshot();
  if (expectedRecipeHash !== snapshot.initialPreview.recipeHash) {
    throw new Error('Agent retouch apply rejected stale recipe hash.');
  }
  return snapshot;
};

const buildTargetSubMask = ({
  height,
  maskId,
  point,
  radiusPx,
  width,
}: {
  height: number;
  maskId: string;
  point: z.infer<typeof normalizedPointSchema>;
  radiusPx: number;
  width: number;
}): MaskContainer['subMasks'][number] => ({
  id: maskId,
  invert: false,
  mode: SubMaskMode.Additive,
  name: 'Agent retouch target',
  opacity: 100,
  parameters: {
    centerX: clamp01(point.x) * width,
    centerY: clamp01(point.y) * height,
    feather: 0.35,
    radiusX: radiusPx,
    radiusY: radiusPx,
    rotation: 0,
  },
  type: Mask.Radial,
  visible: true,
});

const buildRetouchLayer = (
  request: z.infer<typeof agentRetouchApplyRequestSchema>,
  width: number,
  height: number,
): MaskContainer => {
  const layerId = request.layerId ?? `agent_retouch_${toIdSegment(request.operationId)}`;
  const overlayMaskId = `${layerId}_target`;
  const baseLayer: MaskContainer = {
    adjustments: structuredClone(INITIAL_MASK_ADJUSTMENTS),
    blendMode: DEFAULT_LAYER_BLEND_MODE,
    id: layerId,
    invert: false,
    name: `Agent ${request.mode}`,
    opacity: 100,
    subMasks: [
      buildTargetSubMask({
        height,
        maskId: overlayMaskId,
        point: request.targetPoint,
        radiusPx: request.radiusPx,
        width,
      }),
    ],
    visible: true,
  };

  if (request.mode === 'clone' || request.mode === 'heal') {
    const sourcePoint = request.sourcePoint;
    if (sourcePoint === undefined) throw new Error('Clone/heal retouch requires a sourcePoint.');
    const source: RetouchCloneSource = {
      alignmentErrorPx: 0,
      featherRadiusPx: request.featherRadiusPx,
      radiusPx: request.radiusPx,
      retouchMode: request.mode,
      rotationDegrees: 0,
      scale: 1,
      sourcePoint,
      targetPoint: request.targetPoint,
    };
    return { ...baseLayer, retouchCloneSource: source };
  }

  const removeSource: RetouchRemoveSource = {
    featherRadiusPx: request.featherRadiusPx,
    generator: 'local_patch_fill_v1',
    generatorVersion: 1,
    radiusPx: request.radiusPx,
    searchRadiusMultiplier: request.searchRadiusMultiplier,
    seed: request.seed,
    status: 'needs_regeneration',
    targetMaskId: overlayMaskId,
  };
  return { ...baseLayer, retouchRemoveSource: removeSource };
};

const proofWidth = 17;
const proofHeight = 17;

const hashProofPixels = (label: number, pixels: ReadonlyArray<LayerRgbPixel>): string => {
  let hash = 0x811c9dc5;
  const update = (value: number) => {
    hash ^= value & 0xff;
    hash = Math.imul(hash, 0x01000193) >>> 0;
    hash ^= (value >>> 8) & 0xff;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  };
  update(label);
  for (const pixel of pixels) {
    update(pixel.r);
    update(pixel.g);
    update(pixel.b);
  }
  return `fnv1a32:${hash.toString(16).padStart(8, '0')}`;
};

const buildProofBasePixels = (targetPoint: AgentRetouchApplyRequest['targetPoint']): Array<LayerRgbPixel> => {
  const targetX = Math.round(clamp01(targetPoint.x) * (proofWidth - 1));
  const targetY = Math.round(clamp01(targetPoint.y) * (proofHeight - 1));
  return Array.from({ length: proofWidth * proofHeight }, (_, index) => {
    const x = index % proofWidth;
    const y = Math.floor(index / proofWidth);
    const blemish = Math.hypot(x - targetX, y - targetY) <= 1 ? 58 : 0;
    return {
      b: Math.max(0, ((41 + x * 17 + y * 7) % 256) - blemish),
      g: Math.max(0, ((73 + x * 5 + y * 19) % 256) - blemish),
      r: Math.max(0, ((29 + x * 23 + y * 11) % 256) - blemish),
    };
  });
};

const buildNoOpProofBasePixels = (): Array<LayerRgbPixel> =>
  Array.from({ length: proofWidth * proofHeight }, (_, index) => {
    const x = index % proofWidth;
    const y = Math.floor(index / proofWidth);
    return {
      b: (41 + x * 17 + y * 7) % 256,
      g: (73 + x * 5 + y * 19) % 256,
      r: (29 + x * 23 + y * 11) % 256,
    };
  });

const buildProofMaskAlpha = (request: AgentRetouchApplyRequest): Array<number> => {
  const targetX = clamp01(request.targetPoint.x) * (proofWidth - 1);
  const targetY = clamp01(request.targetPoint.y) * (proofHeight - 1);
  const radiusPx = request.mode === 'remove' ? 1.25 : Math.max(2, Math.min(6, request.radiusPx / 10));
  const featherPx =
    request.mode === 'remove' ? 0.25 : Math.min(radiusPx, Math.max(0, request.featherRadiusPx ?? radiusPx * 0.35) / 10);
  const solidRadius = Math.max(0, radiusPx - featherPx);

  return Array.from({ length: proofWidth * proofHeight }, (_, index) => {
    const x = index % proofWidth;
    const y = Math.floor(index / proofWidth);
    const distance = Math.hypot(x - targetX, y - targetY);
    if (distance <= solidRadius) return 1;
    if (distance >= radiusPx) return 0;
    return clamp01((radiusPx - distance) / Math.max(featherPx, 1));
  });
};

const buildRetouchOutputProof = (request: AgentRetouchApplyRequest, layer: MaskContainer): AgentRetouchOutputProof => {
  const proofLayer = {
    blendMode: 'normal' as const,
    id: layer.id,
    maskAlpha: buildProofMaskAlpha(request),
    name: layer.name,
    opacity: clamp01(layer.opacity / 100),
    ...(layer.retouchCloneSource === undefined
      ? {}
      : {
          retouchCloneSource: {
            ...layer.retouchCloneSource,
            featherRadiusPx: Math.min(2, layer.retouchCloneSource.featherRadiusPx ?? 2),
            radiusPx: 3,
          },
        }),
    ...(layer.retouchRemoveSource === undefined
      ? {}
      : {
          retouchRemoveSource: {
            ...layer.retouchRemoveSource,
            featherRadiusPx: Math.min(1, layer.retouchRemoveSource.featherRadiusPx ?? 1),
            radiusPx: 1,
          },
        }),
    visible: layer.visible,
  };
  const renderInput = {
    basePixels:
      request.mode === 'clone' &&
      request.sourcePoint?.x === request.targetPoint.x &&
      request.sourcePoint.y === request.targetPoint.y
        ? buildNoOpProofBasePixels()
        : buildProofBasePixels(request.targetPoint),
    height: proofHeight,
    layers: [proofLayer],
    width: proofWidth,
  };
  const preview = renderLayerPreviewStack(renderInput);
  const applied = renderLayerExportStack(renderInput);
  const previewDelta = preview.outputDeltaByLayer.find((delta) => delta.id === layer.id);
  const applyDelta = applied.outputDeltaByLayer.find((delta) => delta.id === layer.id);
  if (previewDelta === undefined || applyDelta === undefined) {
    throw new Error('Agent retouch apply did not produce mask-aware runtime output proof.');
  }

  const previewHash = hashProofPixels(3, preview.pixels);
  const applyHash = hashProofPixels(3, applied.pixels);
  const previewApplyParity = previewHash === applyHash && JSON.stringify(previewDelta) === JSON.stringify(applyDelta);
  if (!previewApplyParity) {
    throw new Error('Agent retouch apply preview/apply runtime output proof diverged.');
  }

  const resolvedRemoveSource = applied.resolvedRemoveSources.find((source) => source.layerId === layer.id);
  return agentRetouchOutputProofSchema.parse({
    applyDelta,
    applyHash,
    changedOutput: applyDelta.status === 'changed',
    maskAlphaHash: applyDelta.maskAlphaHash,
    previewApplyParity,
    previewDelta,
    previewHash,
    proofSource: 'mask_aware_retouch_runtime_fixture_v1',
    ...(resolvedRemoveSource?.resolvedSourcePoint === undefined
      ? {}
      : { resolvedRemoveSourcePoint: resolvedRemoveSource.resolvedSourcePoint }),
    ...(resolvedRemoveSource?.outputSampleHash === undefined
      ? {}
      : { resolvedRemoveSourceOutputSampleHash: resolvedRemoveSource.outputSampleHash }),
    ...(resolvedRemoveSource?.sourceSampleHash === undefined
      ? {}
      : { resolvedRemoveSourceSampleHash: resolvedRemoveSource.sourceSampleHash }),
    ...(resolvedRemoveSource?.status === undefined ? {} : { resolvedRemoveSourceStatus: resolvedRemoveSource.status }),
  });
};

const buildRetouchLayerRuntimeProvenance = (
  request: AgentRetouchApplyRequest,
  layer: MaskContainer,
  outputProof: AgentRetouchOutputProof,
): RetouchLayerRuntimeProvenance => {
  const overlayMaskId = layer.subMasks[0]?.id;
  const mode = request.mode;
  return {
    algorithmId: mode === 'remove' ? 'local_patch_fill_v1' : mode === 'heal' ? 'local_heal_v1' : 'local_clone_v1',
    changedPixelCount: outputProof.applyDelta.changedPixelCount,
    editableLayer: true,
    ...(request.featherRadiusPx === undefined ? {} : { featherRadiusPx: request.featherRadiusPx }),
    maskAlphaHash: outputProof.maskAlphaHash,
    mode,
    outputHash: outputProof.applyHash,
    ...(outputProof.resolvedRemoveSourceOutputSampleHash === undefined
      ? {}
      : { outputSampleHash: outputProof.resolvedRemoveSourceOutputSampleHash }),
    proofSource: outputProof.proofSource,
    provenanceVersion: 1,
    radiusPx: request.radiusPx,
    ...(outputProof.resolvedRemoveSourcePoint === undefined
      ? {}
      : { resolvedSourcePoint: outputProof.resolvedRemoveSourcePoint }),
    ...(request.sourcePoint === undefined ? {} : { sourcePoint: request.sourcePoint }),
    ...(outputProof.resolvedRemoveSourceSampleHash === undefined
      ? {}
      : { sourceSampleHash: outputProof.resolvedRemoveSourceSampleHash }),
    ...(overlayMaskId === undefined ? {} : { targetMaskId: overlayMaskId }),
    targetPoint: request.targetPoint,
  };
};

const attachRuntimeProvenanceToRetouchLayer = (
  layer: MaskContainer,
  provenance: RetouchLayerRuntimeProvenance,
): MaskContainer => {
  if (layer.retouchCloneSource !== undefined) {
    return { ...layer, retouchCloneSource: { ...layer.retouchCloneSource, provenance } };
  }
  if (layer.retouchRemoveSource !== undefined) {
    return {
      ...layer,
      retouchRemoveSource: {
        ...layer.retouchRemoveSource,
        ...(provenance.resolvedSourcePoint === undefined
          ? {}
          : { resolvedSourcePoint: provenance.resolvedSourcePoint }),
        provenance,
        status: provenance.resolvedSourcePoint === undefined ? layer.retouchRemoveSource.status : 'ready',
      },
    };
  }
  return layer;
};

const pushMaskHistory = (masks: ReadonlyArray<MaskContainer>): void => {
  useEditorStore.setState((state) => {
    const adjustments = { ...state.adjustments, masks: [...masks] };
    const history = pushEditHistoryEntry(state.history, state.historyIndex, adjustments);
    return {
      adjustments,
      history: history.history,
      historyIndex: history.historyIndex,
      uncroppedAdjustedPreviewUrl: null,
    };
  });
};

const buildOverlayArtifact = ({
  contentSeed,
  height,
  layerId,
  operationId,
  overlayMaskId,
  width,
}: {
  contentSeed: unknown;
  height: number;
  layerId: string;
  operationId: string;
  overlayMaskId: string;
  width: number;
}): ArtifactHandleV1 => {
  const hash = stableAgentPreviewHash(JSON.stringify(contentSeed));
  return artifactHandleV1Schema.parse({
    artifactId: `artifact_agent_retouch_overlay_${operationId}_${layerId}_${overlayMaskId}_${hash}`,
    contentHash: `sha256:${hash}`,
    dimensions: { height, width },
    kind: 'preview',
    storage: 'temp_cache',
  });
};

const buildOverlayPreview = ({
  afterSnapshot,
  layer,
  mode,
  operationId,
  overlayMaskId,
}: {
  afterSnapshot: ReturnType<typeof buildAgentImageContextSnapshot>;
  layer: MaskContainer;
  mode: z.infer<typeof retouchModeSchema>;
  operationId: string;
  overlayMaskId: string;
}): AgentRetouchOverlayPreview =>
  agentRetouchOverlayPreviewSchema.parse({
    artifact: buildOverlayArtifact({
      contentSeed: {
        layerId: layer.id,
        mode,
        operationId,
        overlayMaskId,
        retouchCloneSource: layer.retouchCloneSource,
        retouchRemoveSource: layer.retouchRemoveSource,
        subMasks: layer.subMasks,
      },
      height: afterSnapshot.initialPreview.height,
      layerId: layer.id,
      operationId,
      overlayMaskId,
      width: afterSnapshot.initialPreview.width,
    }),
    layerId: layer.id,
    mode,
    opacity: layer.opacity,
    overlayMaskId,
    recipeHash: afterSnapshot.initialPreview.recipeHash,
    renderHash: afterSnapshot.initialPreview.renderHash,
    visible: layer.visible,
  });

export const applyAgentRetouch = (request: AgentRetouchApplyRequest): AgentRetouchApplyResponse => {
  const parsedRequest = agentRetouchApplyRequestSchema.parse(request);
  const beforeSnapshot = ensureFreshRecipe(parsedRequest.expectedRecipeHash);
  const state = useEditorStore.getState();
  const selectedImage = state.selectedImage;
  if (selectedImage === null) throw new Error('Agent retouch apply requires a selected image.');

  const draftLayer = buildRetouchLayer(parsedRequest, selectedImage.width, selectedImage.height);
  const outputProof = buildRetouchOutputProof(parsedRequest, draftLayer);
  if (!outputProof.changedOutput) {
    throw new Error('Agent retouch apply rejected no-op runtime output.');
  }
  const layer = attachRuntimeProvenanceToRetouchLayer(
    draftLayer,
    buildRetouchLayerRuntimeProvenance(parsedRequest, draftLayer, outputProof),
  );
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
  const overlayMaskId = layer.subMasks[0]?.id;
  if (overlayMaskId === undefined) throw new Error('Agent retouch apply did not create an overlay mask.');
  useEditorStore.setState({ activeMaskContainerId: layer.id, activeMaskId: overlayMaskId });
  const afterSnapshot = buildAgentImageContextSnapshot();

  return agentRetouchApplyResponseSchema.parse({
    afterPreviewHash: afterSnapshot.initialPreview.renderHash,
    appliedGraphRevision: afterSnapshot.graphRevision,
    beforePreviewHash: beforeSnapshot.initialPreview.renderHash,
    layerId: layer.id,
    mode: parsedRequest.mode,
    overlayPreview: buildOverlayPreview({
      afterSnapshot,
      layer,
      mode: parsedRequest.mode,
      operationId: parsedRequest.operationId,
      overlayMaskId,
    }),
    overlayMaskId,
    outputProof,
    requestId: parsedRequest.requestId,
    staleRecipeHash: false,
    toolName: AGENT_RETOUCH_APPLY_TOOL_NAME,
    undoGraphRevision: beforeSnapshot.graphRevision,
  });
};
