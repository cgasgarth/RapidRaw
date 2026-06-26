#!/usr/bin/env bun

import { ToolType } from '../../../src/components/panel/right/Masks.tsx';
import { RawEngineAppServerRouteMode } from '../../../src/schemas/agentRuntimeSchemas.ts';
import { useEditorStore } from '../../../src/store/useEditorStore.ts';
import { ActiveChannel, INITIAL_ADJUSTMENTS } from '../../../src/utils/adjustments.ts';
import { buildAgentImageContextSnapshot } from '../../../src/utils/agentImageContextSnapshot.ts';
import {
  AGENT_LAYER_CREATE_TOOL_NAME,
  AGENT_MASK_CREATE_OR_UPDATE_TOOL_NAME,
  agentLayerCreateRequestSchema,
  agentMaskCreateOrUpdateRequestSchema,
  applyAgentBrushMaskCreateOrUpdate,
  applyAgentLayerCreate,
} from '../../../src/utils/agentLayerMaskTools.ts';
import { buildRawEngineAppServerRouteCatalog } from '../../../src/utils/rawEngineAppServerHost.ts';

const selectedPath = '/Users/cgas/Pictures/Capture One/Alaska/DSC_3163.ARW';
const bins = Array.from({ length: 256 }, (_, index) => (index === 0 || index === 255 ? 18 : 3));

useEditorStore.getState().setEditor({
  adjustments: INITIAL_ADJUSTMENTS,
  brushSettings: { feather: 48, size: 96, tool: ToolType.Brush },
  finalPreviewUrl: 'blob:rawengine-agent-layer-before',
  hasRenderedFirstFrame: true,
  histogram: {
    [ActiveChannel.Blue]: { color: '#4D96FF', data: bins },
    [ActiveChannel.Green]: { color: '#6BCB77', data: bins },
    [ActiveChannel.Luma]: { color: '#FFFFFF', data: bins },
    [ActiveChannel.Red]: { color: '#FF6B6B', data: bins },
  },
  history: [INITIAL_ADJUSTMENTS],
  historyIndex: 0,
  lastBasicToneCommand: null,
  selectedImage: {
    exif: { ISO: '200', LensModel: 'FE 24-70mm F2.8 GM II' },
    height: 4000,
    isRaw: true,
    isReady: true,
    originalUrl: 'blob:rawengine-original-3163',
    path: selectedPath,
    thumbnailUrl: 'blob:rawengine-thumb-3163',
    width: 6000,
  },
  uncroppedAdjustedPreviewUrl: 'blob:rawengine-agent-layer-stale',
});

if (
  agentLayerCreateRequestSchema.safeParse({
    expectedRecipeHash: 'recipe:test',
    name: 'Bad layer',
    opacity: 120,
    operationId: 'bad_layer',
    requestId: 'bad-layer',
    sessionId: 'agent-layer-mask-invalid',
  }).success
) {
  throw new Error('agent.layer.create accepted out-of-bounds opacity.');
}

if (
  agentMaskCreateOrUpdateRequestSchema.safeParse({
    expectedRecipeHash: 'recipe:test',
    layerId: 'layer',
    maskName: 'Bad mask',
    operationId: 'bad_mask',
    requestId: 'bad-mask',
    sessionId: 'agent-layer-mask-invalid',
    strokes: [
      {
        flow: 1.2,
        hardness: 0.5,
        mode: 'paint',
        points: [
          { x: 0.25, y: 0.25 },
          { x: 0.75, y: 0.75 },
        ],
        radiusPx: 80,
        strokeId: 'invalid-flow',
      },
    ],
  }).success
) {
  throw new Error('agent.mask.create_or_update accepted out-of-bounds stroke flow.');
}

const initialSnapshot = buildAgentImageContextSnapshot();
let staleRejected = false;
try {
  await applyAgentLayerCreate({
    expectedRecipeHash: 'recipe:stale',
    name: 'Subject lift',
    operationId: 'agent_subject_lift_stale',
    requestId: 'agent-layer-stale',
    sessionId: 'agent-layer-mask-3163',
  });
} catch {
  staleRejected = true;
}
if (!staleRejected) throw new Error('agent.layer.create did not reject a stale recipe hash.');

const layerResult = await applyAgentLayerCreate({
  adjustments: {
    blackPoint: -8,
    clarity: 12,
    contrast: 18,
    exposureEv: 0.45,
    highlights: -18,
    saturation: 10,
    shadows: 24,
    whitePoint: 6,
  },
  blendMode: 'normal',
  expectedRecipeHash: initialSnapshot.initialPreview.recipeHash,
  layerId: 'agent_subject_lift',
  name: 'Agent subject lift',
  opacity: 72,
  operationId: 'agent_subject_lift',
  requestId: 'agent-layer-create-3163',
  sessionId: 'agent-layer-mask-3163',
});

const afterLayerState = useEditorStore.getState();
const createdLayer = afterLayerState.adjustments.masks.find((mask) => mask.id === 'agent_subject_lift');
if (createdLayer === undefined) throw new Error('agent.layer.create did not add a local adjustment layer.');
if (createdLayer.adjustments.exposure !== 0.45 || createdLayer.adjustments.shadows !== 24) {
  throw new Error('agent.layer.create did not persist local tone adjustments.');
}
if (afterLayerState.historyIndex !== 1 || afterLayerState.history.length !== 2) {
  throw new Error('agent.layer.create must create one undoable history entry.');
}
if (afterLayerState.uncroppedAdjustedPreviewUrl !== null) {
  throw new Error('agent.layer.create must invalidate stale preview output.');
}
if (layerResult.beforePreviewHash === layerResult.afterPreviewHash) {
  throw new Error('agent.layer.create did not change preview identity.');
}

const afterLayerSnapshot = buildAgentImageContextSnapshot();
const maskResult = await applyAgentBrushMaskCreateOrUpdate({
  expectedRecipeHash: afterLayerSnapshot.initialPreview.recipeHash,
  layerId: 'agent_subject_lift',
  maskId: 'agent_subject_brush',
  maskName: 'Subject brush',
  operationId: 'agent_subject_brush',
  requestId: 'agent-mask-create-3163',
  sessionId: 'agent-layer-mask-3163',
  strokes: [
    {
      flow: 0.88,
      hardness: 0.52,
      mode: 'paint',
      points: [
        { pressure: 0.8, x: 0.34, y: 0.28 },
        { pressure: 0.9, x: 0.45, y: 0.42 },
        { pressure: 0.75, x: 0.58, y: 0.54 },
      ],
      radiusPx: 92,
      strokeId: 'subject-lift-stroke',
    },
  ],
});

const afterMaskState = useEditorStore.getState();
const maskedLayer = afterMaskState.adjustments.masks.find((mask) => mask.id === 'agent_subject_lift');
const brushMask = maskedLayer?.subMasks.find((mask) => mask.id === 'agent_subject_brush');
if (brushMask === undefined) throw new Error('agent.mask.create_or_update did not attach a brush sub-mask.');
if (
  afterMaskState.activeMaskContainerId !== 'agent_subject_lift' ||
  afterMaskState.activeMaskId !== 'agent_subject_brush'
) {
  throw new Error('agent.mask.create_or_update did not activate the edited layer/mask.');
}
if (afterMaskState.historyIndex !== 2 || afterMaskState.history.length !== 3) {
  throw new Error('agent.mask.create_or_update must create one undoable history entry.');
}
if (maskResult.beforePreviewHash === maskResult.afterPreviewHash) {
  throw new Error('agent.mask.create_or_update did not change preview identity.');
}
if (!maskResult.maskContentHash.startsWith('fnv1a32:')) {
  throw new Error('agent.mask.create_or_update did not return brush mask proof metadata.');
}

const routes = buildRawEngineAppServerRouteCatalog();
for (const toolName of [AGENT_LAYER_CREATE_TOOL_NAME, AGENT_MASK_CREATE_OR_UPDATE_TOOL_NAME]) {
  const route = routes.find((candidate) => candidate.commandName === toolName);
  if (
    route === undefined ||
    route.family !== 'agent' ||
    !route.modes.includes(RawEngineAppServerRouteMode.ApplyDryRunPlan) ||
    !route.runtimeCheckScripts.includes('check:agent-layer-mask-tools')
  ) {
    throw new Error(`${toolName} is missing from the mutating agent route catalog.`);
  }
}

console.log('agent layer mask tools ok');
