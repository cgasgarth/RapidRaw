#!/usr/bin/env bun

import { ToolType } from '../../../src/components/panel/right/Masks.tsx';
import { RawEngineAppServerRouteMode } from '../../../src/schemas/agentRuntimeSchemas.ts';
import { useEditorStore } from '../../../src/store/useEditorStore.ts';
import { ActiveChannel, INITIAL_ADJUSTMENTS } from '../../../src/utils/adjustments.ts';
import { buildAgentImageContextSnapshot } from '../../../src/utils/agentImageContextSnapshot.ts';
import {
  AGENT_OBJECT_SELECTION_APPLY_TOOL_NAME,
  agentObjectSelectionApplyRequestSchema,
  applyAgentObjectSelection,
} from '../../../src/utils/agentLayerMaskTools.ts';
import {
  buildRawEngineAppServerToolDispatchResponse,
  buildRawEngineAppServerRouteCatalog,
} from '../../../src/utils/rawEngineAppServerHost.ts';

const selectedPath = '/Users/cgas/Pictures/Capture One/Alaska/DSC_3163.ARW';
const bins = Array.from({ length: 256 }, (_, index) => (index === 0 || index === 255 ? 18 : 3));

const resetEditor = () => {
  useEditorStore.getState().setEditor({
    adjustments: INITIAL_ADJUSTMENTS,
    brushSettings: { feather: 48, size: 96, tool: ToolType.Brush },
    finalPreviewUrl: 'blob:rawengine-agent-object-before',
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
    uncroppedAdjustedPreviewUrl: 'blob:rawengine-agent-object-stale',
  });
};

resetEditor();

if (
  agentObjectSelectionApplyRequestSchema.safeParse({
    expectedRecipeHash: 'recipe:test',
    operationId: 'bad_object',
    requestId: 'bad-object',
    sessionId: 'agent-object-invalid',
  }).success
) {
  throw new Error('agent.object_selection.apply accepted an empty prompt.');
}

if (
  agentObjectSelectionApplyRequestSchema.safeParse({
    boxPrompt: { height: 0.3, width: 0.3, x: 0.8, y: 0.4 },
    expectedRecipeHash: 'recipe:test',
    operationId: 'bad_box',
    requestId: 'bad-box',
    sessionId: 'agent-object-invalid',
  }).success
) {
  throw new Error('agent.object_selection.apply accepted an out-of-frame box prompt.');
}

const initialSnapshot = buildAgentImageContextSnapshot();
let staleRejected = false;
try {
  applyAgentObjectSelection({
    expectedRecipeHash: 'recipe:stale',
    operationId: 'object_stale',
    pointPrompts: [{ label: 'foreground', x: 0.5, y: 0.5 }],
    requestId: 'object-stale',
    sessionId: 'agent-object-3163',
  });
} catch {
  staleRejected = true;
}
if (!staleRejected) throw new Error('agent.object_selection.apply did not reject a stale recipe hash.');

const result = applyAgentObjectSelection({
  adjustments: {
    blackPoint: -4,
    clarity: 8,
    contrast: 12,
    exposureEv: 0.25,
    highlights: -8,
    saturation: 6,
    shadows: 14,
    whitePoint: 3,
  },
  boxPrompt: { height: 0.34, width: 0.28, x: 0.33, y: 0.22 },
  expectedRecipeHash: initialSnapshot.initialPreview.recipeHash,
  layerId: 'agent_object_product',
  layerName: 'Agent object product',
  maskId: 'agent_object_prompt_mask',
  operationId: 'agent_object_product',
  pointPrompts: [
    { label: 'foreground', x: 0.46, y: 0.36 },
    { label: 'foreground', x: 0.5, y: 0.44 },
    { label: 'background', x: 0.18, y: 0.72 },
  ],
  requestId: 'agent-object-apply-3163',
  sessionId: 'agent-object-3163',
});

const state = useEditorStore.getState();
const layer = state.adjustments.masks.find((mask) => mask.id === 'agent_object_product');
const subMask = layer?.subMasks.find((mask) => mask.id === 'agent_object_prompt_mask');
if (layer === undefined || subMask === undefined) {
  throw new Error('agent.object_selection.apply did not create an editable object mask layer.');
}
if (layer.adjustments.exposure !== 0.25 || layer.adjustments.shadows !== 14) {
  throw new Error('agent.object_selection.apply did not preserve layer adjustment payload.');
}
if (subMask.type !== 'ai-object' || subMask.parameters?.providerStatus !== 'prompt_proxy_mask_v1') {
  throw new Error('agent.object_selection.apply did not create prompt-provenance object mask parameters.');
}
if (
  !Array.isArray(subMask.parameters?.generatedPreviewStrokes) ||
  subMask.parameters.generatedPreviewStrokes.length < 2
) {
  throw new Error('agent.object_selection.apply did not store point/box preview geometry.');
}
if (state.activeMaskContainerId !== 'agent_object_product' || state.activeMaskId !== 'agent_object_prompt_mask') {
  throw new Error('agent.object_selection.apply did not activate the created object mask.');
}
if (state.historyIndex !== 1 || state.history.length !== 2 || state.uncroppedAdjustedPreviewUrl !== null) {
  throw new Error('agent.object_selection.apply did not create undoable history and invalidate preview.');
}
if (
  result.beforePreviewHash === result.afterPreviewHash ||
  result.providerStatus !== 'prompt_proxy_mask_v1' ||
  !result.objectPromptHash.startsWith('sha256:') ||
  result.overlayPreview.layerId !== result.layerId ||
  result.overlayPreview.maskId !== result.maskId ||
  result.overlayPreview.artifact.kind !== 'preview' ||
  result.overlayPreview.artifact.storage !== 'temp_cache'
) {
  throw new Error('agent.object_selection.apply did not return complete preview/provenance receipt.');
}

const route = buildRawEngineAppServerRouteCatalog().find(
  (candidate) => candidate.commandName === AGENT_OBJECT_SELECTION_APPLY_TOOL_NAME,
);
if (
  route === undefined ||
  route.family !== 'agent' ||
  !route.modes.includes(RawEngineAppServerRouteMode.ApplyDryRunPlan) ||
  !route.runtimeCheckScripts.includes('check:agent-object-selection-apply')
) {
  throw new Error('agent.object_selection.apply is missing from the mutating agent route catalog.');
}

resetEditor();
const dispatchSnapshot = buildAgentImageContextSnapshot();
const dispatchResult = await buildRawEngineAppServerToolDispatchResponse({
  arguments: {
    expectedRecipeHash: dispatchSnapshot.initialPreview.recipeHash,
    operationId: 'agent_object_dispatch',
    pointPrompts: [{ label: 'foreground', x: 0.48, y: 0.42 }],
    requestId: 'agent-object-dispatch-3163',
    sessionId: 'agent-object-3163',
  },
  requestId: 'dispatch-agent-object-3163',
  runtimeToolName: AGENT_OBJECT_SELECTION_APPLY_TOOL_NAME,
});
if (
  dispatchResult?.dispatchStatus !== 'completed' ||
  dispatchResult.commandType !== AGENT_OBJECT_SELECTION_APPLY_TOOL_NAME
) {
  throw new Error('agent.object_selection.apply did not dispatch through the local app-server host.');
}

console.log('agent object selection apply ok');
