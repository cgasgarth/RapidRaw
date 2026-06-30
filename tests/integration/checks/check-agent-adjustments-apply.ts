#!/usr/bin/env bun

import { ToolType } from '../../../src/components/panel/right/layers/Masks.tsx';
import { RawEngineAppServerRouteMode } from '../../../src/schemas/agentRuntimeSchemas.ts';
import { useEditorStore } from '../../../src/store/useEditorStore.ts';
import { ActiveChannel, INITIAL_ADJUSTMENTS } from '../../../src/utils/adjustments.ts';
import {
  AGENT_ADJUSTMENTS_APPLY_TOOL_NAME,
  AGENT_ADJUSTMENTS_DRY_RUN_TOOL_NAME,
  agentAdjustmentsApplyRequestSchema,
  applyAgentGlobalAdjustments,
  dryRunAgentGlobalAdjustments,
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
    acceptedPlanHash: 'sha256:invalid',
    acceptedPlanId: 'dryrun_invalid',
    expectedGraphRevision: 'history_0',
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
    acceptedPlanHash: 'sha256:invalid',
    acceptedPlanId: 'dryrun_invalid',
    expectedGraphRevision: 'history_0',
    expectedRecipeHash: 'recipe:test',
    operationId: 'invalid-field',
    requestId: 'invalid-field',
    sessionId: 'agent-adjustments-apply-invalid',
  }).success
) {
  throw new Error('agent.adjustments.apply accepted an unknown adjustment field.');
}

const initialSnapshot = buildAgentImageContextSnapshot();
if (
  agentAdjustmentsApplyRequestSchema.safeParse({
    adjustments: { exposure: 0.25 },
    expectedGraphRevision: initialSnapshot.graphRevision,
    expectedRecipeHash: initialSnapshot.initialPreview.recipeHash,
    operationId: 'missing-approval',
    requestId: 'missing-approval',
    sessionId: 'agent-adjustments-apply-invalid',
  }).success
) {
  throw new Error('agent.adjustments.apply accepted a request without accepted dry-run identity.');
}
let staleRejected = false;
try {
  await dryRunAgentGlobalAdjustments({
    adjustments: { exposure: 0.25 },
    expectedGraphRevision: initialSnapshot.graphRevision,
    expectedRecipeHash: 'recipe:stale',
    operationId: 'agent_adjustments_apply_stale',
    requestId: 'agent-adjustments-apply-stale',
    sessionId: 'agent-adjustments-apply-3161',
  });
} catch {
  staleRejected = true;
}
if (!staleRejected) {
  throw new Error('agent.adjustments.dry_run did not reject a stale recipe hash.');
}

const adjustments = {
  clarity: 18,
  contrast: 24,
  exposure: 0.42,
  highlights: -22,
  saturation: 8,
  shadows: 16,
  temperature: 12,
  tint: -4,
  vibrance: 10,
};
const dryRun = await dryRunAgentGlobalAdjustments({
  adjustments,
  expectedGraphRevision: initialSnapshot.graphRevision,
  expectedRecipeHash: initialSnapshot.initialPreview.recipeHash,
  operationId: 'agent_adjustments_apply_3161',
  requestId: 'agent-adjustments-dry-run-3161',
  sessionId: 'agent-adjustments-apply-3161',
});
if (
  dryRun.toolName !== AGENT_ADJUSTMENTS_DRY_RUN_TOOL_NAME ||
  dryRun.sourceGraphRevision !== initialSnapshot.graphRevision ||
  dryRun.receipt.dryRunPlanHash !== dryRun.dryRunPlanHash ||
  dryRun.receipt.expectedGraphRevision !== initialSnapshot.graphRevision
) {
  throw new Error('agent.adjustments.dry_run did not produce a bound receipt.');
}

const result = await applyAgentGlobalAdjustments({
  acceptedPlanHash: dryRun.dryRunPlanHash,
  acceptedPlanId: dryRun.dryRunPlanId,
  adjustments,
  expectedGraphRevision: dryRun.sourceGraphRevision,
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
if (
  result.receipt.sessionId !== 'agent-adjustments-apply-3161' ||
  result.receipt.operationId !== 'agent_adjustments_apply_3161' ||
  result.receipt.acceptedPlanHash !== dryRun.dryRunPlanHash ||
  result.receipt.expectedGraphRevision !== dryRun.sourceGraphRevision ||
  result.receipt.undoGraphRevision !== result.undoGraphRevision ||
  result.receipt.appliedGraphRevision !== result.appliedGraphRevision ||
  result.receipt.beforePreviewHash !== result.beforePreviewHash ||
  result.receipt.afterPreviewHash !== result.afterPreviewHash
) {
  throw new Error('agent.adjustments.apply did not return a complete mutation receipt.');
}
for (const field of ['exposure', 'contrast', 'temperature', 'tint', 'vibrance']) {
  if (!result.adjustedFields.includes(field)) {
    throw new Error(`agent.adjustments.apply response missing adjusted field: ${field}`);
  }
  if (!result.receipt.adjustedFields.includes(field)) {
    throw new Error(`agent.adjustments.apply receipt missing adjusted field: ${field}`);
  }
}

const route = buildRawEngineAppServerRouteCatalog().find(
  (candidate) => candidate.commandName === AGENT_ADJUSTMENTS_APPLY_TOOL_NAME,
);
const dryRunRoute = buildRawEngineAppServerRouteCatalog().find(
  (candidate) => candidate.commandName === AGENT_ADJUSTMENTS_DRY_RUN_TOOL_NAME,
);
if (
  route === undefined ||
  route.family !== 'agent' ||
  !route.modes.includes(RawEngineAppServerRouteMode.ApplyDryRunPlan)
) {
  throw new Error('agent.adjustments.apply is missing from the mutating agent route catalog.');
}
if (
  dryRunRoute === undefined ||
  dryRunRoute.family !== 'agent' ||
  !dryRunRoute.modes.includes(RawEngineAppServerRouteMode.DryRunCommand)
) {
  throw new Error('agent.adjustments.dry_run is missing from the agent route catalog.');
}

console.log('agent adjustments apply ok');
