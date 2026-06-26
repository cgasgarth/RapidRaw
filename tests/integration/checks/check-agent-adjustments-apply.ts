#!/usr/bin/env bun

import { ToolType } from '../../../src/components/panel/right/Masks.tsx';
import { RawEngineAppServerRouteMode } from '../../../src/schemas/agentRuntimeSchemas.ts';
import { useEditorStore } from '../../../src/store/useEditorStore.ts';
import { ActiveChannel, INITIAL_ADJUSTMENTS } from '../../../src/utils/adjustments.ts';
import {
  AGENT_ADJUSTMENTS_APPLY_TOOL_NAME,
  agentAdjustmentsApplyRequestSchema,
  applyAgentGlobalAdjustments,
} from '../../../src/utils/agentAdjustmentApplyTool.ts';
import { buildAgentImageContextSnapshot } from '../../../src/utils/agentImageContextSnapshot.ts';
import { buildRawEngineAppServerRouteCatalog } from '../../../src/utils/rawEngineAppServerHost.ts';

const selectedPath = '/Users/cgas/Pictures/Capture One/Alaska/DSC_3161.ARW';
const bins = Array.from({ length: 256 }, (_, index) => (index === 0 || index === 255 ? 16 : 2));

useEditorStore.getState().setEditor({
  adjustments: INITIAL_ADJUSTMENTS,
  brushSettings: { feather: 50, size: 72, tool: ToolType.Brush },
  finalPreviewUrl: 'blob:rawengine-agent-adjustments-before',
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
    exif: { ISO: '320', LensModel: 'FE 24-70mm F2.8 GM II' },
    height: 4000,
    isRaw: true,
    isReady: true,
    originalUrl: 'blob:rawengine-original-3161',
    path: selectedPath,
    thumbnailUrl: 'blob:rawengine-thumb-3161',
    width: 6000,
  },
  uncroppedAdjustedPreviewUrl: 'blob:rawengine-stale-uncropped',
});

if (
  agentAdjustmentsApplyRequestSchema.safeParse({
    adjustments: { exposure: 4 },
    expectedRecipeHash: 'recipe:test',
    operationId: 'invalid-exposure',
    requestId: 'invalid-exposure',
    sessionId: 'agent-adjustments-apply-invalid',
  }).success
) {
  throw new Error('agent.adjustments.apply accepted an out-of-bounds exposure.');
}
if (
  agentAdjustmentsApplyRequestSchema.safeParse({
    adjustments: { unsupportedField: 1 },
    expectedRecipeHash: 'recipe:test',
    operationId: 'invalid-field',
    requestId: 'invalid-field',
    sessionId: 'agent-adjustments-apply-invalid',
  }).success
) {
  throw new Error('agent.adjustments.apply accepted an unknown adjustment field.');
}

const initialSnapshot = buildAgentImageContextSnapshot();
let staleRejected = false;
try {
  await applyAgentGlobalAdjustments({
    adjustments: { exposure: 0.25 },
    expectedRecipeHash: 'recipe:stale',
    operationId: 'agent_adjustments_apply_stale',
    requestId: 'agent-adjustments-apply-stale',
    sessionId: 'agent-adjustments-apply-3161',
  });
} catch {
  staleRejected = true;
}
if (!staleRejected) {
  throw new Error('agent.adjustments.apply did not reject a stale recipe hash.');
}

const result = await applyAgentGlobalAdjustments({
  adjustments: {
    clarity: 18,
    contrast: 24,
    exposure: 0.42,
    highlights: -22,
    saturation: 8,
    shadows: 16,
    temperature: 12,
    tint: -4,
    vibrance: 10,
  },
  expectedRecipeHash: initialSnapshot.initialPreview.recipeHash,
  operationId: 'agent_adjustments_apply_3161',
  requestId: 'agent-adjustments-apply-3161',
  sessionId: 'agent-adjustments-apply-3161',
});

const state = useEditorStore.getState();
if (state.adjustments.exposure !== 0.42 || state.adjustments.contrast !== 24 || state.adjustments.temperature !== 12) {
  throw new Error('agent.adjustments.apply did not mutate bounded global adjustments.');
}
if (state.adjustments.tint !== -4 || state.adjustments.vibrance !== 10) {
  throw new Error('agent.adjustments.apply did not persist color temperature/tint/vibrance adjustments.');
}
if (state.historyIndex !== 1 || state.history.length !== 2) {
  throw new Error('agent.adjustments.apply must create one undoable history entry.');
}
if (state.uncroppedAdjustedPreviewUrl !== null) {
  throw new Error('agent.adjustments.apply must invalidate stale preview output.');
}
if (result.undoGraphRevision !== 'history_0' || result.appliedGraphRevision !== 'history_1') {
  throw new Error('agent.adjustments.apply did not return undo/apply graph revisions.');
}
if (result.beforePreviewHash === result.afterPreviewHash || result.changedPixelCount < 64) {
  throw new Error('agent.adjustments.apply did not prove changed preview output.');
}
for (const field of ['exposure', 'contrast', 'temperature', 'tint', 'vibrance']) {
  if (!result.adjustedFields.includes(field)) {
    throw new Error(`agent.adjustments.apply response missing adjusted field: ${field}`);
  }
}

const route = buildRawEngineAppServerRouteCatalog().find(
  (candidate) => candidate.commandName === AGENT_ADJUSTMENTS_APPLY_TOOL_NAME,
);
if (
  route === undefined ||
  route.family !== 'agent' ||
  !route.modes.includes(RawEngineAppServerRouteMode.ApplyDryRunPlan)
) {
  throw new Error('agent.adjustments.apply is missing from the mutating agent route catalog.');
}

console.log('agent adjustments apply ok');
