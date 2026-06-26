import { z } from 'zod';

import {
  DEFAULT_LAYER_BLEND_MODE,
  INITIAL_MASK_ADJUSTMENTS,
  type MaskContainer,
  type RetouchCloneSource,
  type RetouchRemoveSource,
} from './adjustments';
import { buildAgentImageContextSnapshot } from './agentImageContextSnapshot';
import { pushEditHistoryEntry } from './editHistory';
import { applyLayerStackCommandBridgeOperation } from './layerStackCommandBridge';
import { Mask, SubMaskMode } from '../components/panel/right/Masks';
import { useEditorStore } from '../store/useEditorStore';

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
    overlayMaskId: z.string().trim().min(1),
    requestId: z.string().trim().min(1),
    staleRecipeHash: z.literal(false),
    toolName: z.literal(AGENT_RETOUCH_APPLY_TOOL_NAME),
    undoGraphRevision: z.string().trim().min(1),
  })
  .strict();

export type AgentRetouchApplyRequest = z.infer<typeof agentRetouchApplyRequestSchema>;
export type AgentRetouchApplyResponse = z.infer<typeof agentRetouchApplyResponseSchema>;

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

export const applyAgentRetouch = (request: AgentRetouchApplyRequest): AgentRetouchApplyResponse => {
  const parsedRequest = agentRetouchApplyRequestSchema.parse(request);
  const beforeSnapshot = ensureFreshRecipe(parsedRequest.expectedRecipeHash);
  const state = useEditorStore.getState();
  const selectedImage = state.selectedImage;
  if (selectedImage === null) throw new Error('Agent retouch apply requires a selected image.');

  const layer = buildRetouchLayer(parsedRequest, selectedImage.width, selectedImage.height);
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
  useEditorStore.setState({ activeMaskContainerId: layer.id, activeMaskId: layer.subMasks[0]?.id ?? null });
  const afterSnapshot = buildAgentImageContextSnapshot();

  return agentRetouchApplyResponseSchema.parse({
    afterPreviewHash: afterSnapshot.initialPreview.renderHash,
    appliedGraphRevision: afterSnapshot.graphRevision,
    beforePreviewHash: beforeSnapshot.initialPreview.renderHash,
    layerId: layer.id,
    mode: parsedRequest.mode,
    overlayMaskId: layer.subMasks[0]?.id,
    requestId: parsedRequest.requestId,
    staleRecipeHash: false,
    toolName: AGENT_RETOUCH_APPLY_TOOL_NAME,
    undoGraphRevision: beforeSnapshot.graphRevision,
  });
};
