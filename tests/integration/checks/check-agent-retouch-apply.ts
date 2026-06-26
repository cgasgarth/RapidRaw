#!/usr/bin/env bun

import { ToolType } from '../../../src/components/panel/right/Masks.tsx';
import { RawEngineAppServerRouteMode } from '../../../src/schemas/agentRuntimeSchemas.ts';
import { useEditorStore } from '../../../src/store/useEditorStore.ts';
import { ActiveChannel, INITIAL_ADJUSTMENTS } from '../../../src/utils/adjustments.ts';
import { buildAgentImageContextSnapshot } from '../../../src/utils/agentImageContextSnapshot.ts';
import {
  AGENT_RETOUCH_APPLY_TOOL_NAME,
  agentRetouchApplyRequestSchema,
  applyAgentRetouch,
} from '../../../src/utils/agentRetouchApplyTool.ts';
import { buildRawEngineAppServerRouteCatalog } from '../../../src/utils/rawEngineAppServerHost.ts';

const selectedPath = '/Users/cgas/Pictures/Capture One/Alaska/DSC_3163.ARW';
const bins = Array.from({ length: 256 }, (_, index) => (index === 0 || index === 255 ? 12 : 4));

const resetEditor = () => {
  useEditorStore.getState().setEditor({
    adjustments: INITIAL_ADJUSTMENTS,
    brushSettings: { feather: 42, size: 64, tool: ToolType.Brush },
    finalPreviewUrl: 'blob:rawengine-agent-retouch-before',
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
    uncroppedAdjustedPreviewUrl: 'blob:rawengine-agent-retouch-stale',
  });
};

resetEditor();

if (
  agentRetouchApplyRequestSchema.safeParse({
    expectedRecipeHash: 'recipe:test',
    mode: 'heal',
    operationId: 'bad_heal',
    radiusPx: 48,
    requestId: 'bad-heal',
    sessionId: 'agent-retouch-invalid',
    targetPoint: { x: 0.4, y: 0.4 },
  }).success
) {
  throw new Error('agent.retouch.apply accepted heal without sourcePoint.');
}

if (
  agentRetouchApplyRequestSchema.safeParse({
    expectedRecipeHash: 'recipe:test',
    mode: 'remove',
    operationId: 'bad_remove',
    radiusPx: 48,
    requestId: 'bad-remove',
    sessionId: 'agent-retouch-invalid',
    targetPoint: { x: 0.4, y: 0.4 },
  }).success
) {
  throw new Error('agent.retouch.apply accepted remove without user confirmation.');
}

const initialSnapshot = buildAgentImageContextSnapshot();
let staleRejected = false;
try {
  applyAgentRetouch({
    expectedRecipeHash: 'recipe:stale',
    mode: 'clone',
    operationId: 'clone_stale',
    radiusPx: 48,
    requestId: 'clone-stale',
    sessionId: 'agent-retouch-3163',
    sourcePoint: { x: 0.22, y: 0.28 },
    targetPoint: { x: 0.55, y: 0.52 },
  });
} catch {
  staleRejected = true;
}
if (!staleRejected) throw new Error('agent.retouch.apply did not reject stale recipe hash.');

const cloneResult = applyAgentRetouch({
  expectedRecipeHash: initialSnapshot.initialPreview.recipeHash,
  layerId: 'agent_clone_spot',
  mode: 'clone',
  operationId: 'agent_clone_spot',
  radiusPx: 44,
  requestId: 'agent-retouch-clone-3163',
  sessionId: 'agent-retouch-3163',
  sourcePoint: { x: 0.24, y: 0.32 },
  targetPoint: { x: 0.54, y: 0.51 },
});
const cloneState = useEditorStore.getState();
const cloneLayer = cloneState.adjustments.masks.find((mask) => mask.id === 'agent_clone_spot');
if (cloneLayer?.retouchCloneSource?.retouchMode !== 'clone') {
  throw new Error('agent.retouch.apply did not create a clone retouch layer.');
}
if (cloneLayer.subMasks[0]?.type !== 'radial' || cloneLayer.subMasks[0].id !== cloneResult.overlayMaskId) {
  throw new Error('agent.retouch.apply did not create a target overlay mask.');
}
if (
  cloneState.historyIndex !== 1 ||
  cloneState.history.length !== 2 ||
  cloneState.uncroppedAdjustedPreviewUrl !== null
) {
  throw new Error('agent.retouch.apply did not create undoable history and invalidate preview.');
}
if (cloneResult.beforePreviewHash === cloneResult.afterPreviewHash) {
  throw new Error('agent.retouch.apply clone did not change preview identity.');
}

resetEditor();
const removeSnapshot = buildAgentImageContextSnapshot();
const removeResult = applyAgentRetouch({
  expectedRecipeHash: removeSnapshot.initialPreview.recipeHash,
  layerId: 'agent_remove_spot',
  mode: 'remove',
  operationId: 'agent_remove_spot',
  radiusPx: 36,
  requestId: 'agent-retouch-remove-3163',
  searchRadiusMultiplier: 3,
  seed: 7,
  sessionId: 'agent-retouch-3163',
  targetPoint: { x: 0.48, y: 0.47 },
  userConfirmedGenerativeRetouch: true,
});
const removeLayer = useEditorStore.getState().adjustments.masks.find((mask) => mask.id === 'agent_remove_spot');
if (
  removeLayer?.retouchRemoveSource?.generator !== 'local_patch_fill_v1' ||
  removeLayer.retouchRemoveSource.targetMaskId !== removeResult.overlayMaskId ||
  removeLayer.retouchRemoveSource.seed !== 7
) {
  throw new Error('agent.retouch.apply did not create a bounded remove retouch layer.');
}

const route = buildRawEngineAppServerRouteCatalog().find(
  (candidate) => candidate.commandName === AGENT_RETOUCH_APPLY_TOOL_NAME,
);
if (
  route === undefined ||
  route.family !== 'agent' ||
  !route.modes.includes(RawEngineAppServerRouteMode.ApplyDryRunPlan) ||
  !route.runtimeCheckScripts.includes('check:agent-retouch-apply')
) {
  throw new Error('agent.retouch.apply is missing from the mutating agent route catalog.');
}

console.log('agent retouch apply ok');
