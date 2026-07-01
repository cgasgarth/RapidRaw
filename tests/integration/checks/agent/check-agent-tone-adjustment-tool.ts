#!/usr/bin/env bun

import { ToolType } from '../../../../src/components/panel/right/layers/Masks.tsx';
import {
  RawEngineAppServerResponseStatus,
  RawEngineAppServerRouteMode,
} from '../../../../src/schemas/agent/agentRuntimeSchemas.ts';
import { useEditorStore } from '../../../../src/store/useEditorStore.ts';
import { ActiveChannel, INITIAL_ADJUSTMENTS } from '../../../../src/utils/adjustments.ts';
import { buildAgentImageContextSnapshot } from '../../../../src/utils/agent/context/agentImageContextSnapshot.ts';
import {
  AGENT_TONE_ADJUSTMENT_APPLY_TOOL_NAME,
  AGENT_TONE_ADJUSTMENT_DRY_RUN_TOOL_NAME,
  agentToneAdjustmentApplyRequestSchema,
  agentToneAdjustmentDryRunRequestSchema,
  applyAgentToneAdjustment,
  dryRunAgentToneAdjustment,
} from '../../../../src/utils/agent/tools/agentToneAdjustmentTool.ts';
import {
  buildRawEngineAppServerRouteCatalog,
  buildRawEngineAppServerToolDispatchResponse,
} from '../../../../src/utils/rawEngineAppServerHost.ts';

const selectedPath = '/Users/cgas/Pictures/Capture One/Alaska/DSC_3161.ARW';
const bins = Array.from({ length: 256 }, (_, index) => (index === 0 || index === 255 ? 16 : 2));

useEditorStore.getState().setEditor({
  adjustments: INITIAL_ADJUSTMENTS,
  brushSettings: { feather: 50, size: 72, tool: ToolType.Brush },
  finalPreviewUrl: 'blob:rawengine-agent-tone-before',
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

const failures: string[] = [];

if (
  agentToneAdjustmentDryRunRequestSchema.safeParse({
    adjustments: { exposure: 4 },
    expectedGraphRevision: 'history_0',
    expectedRecipeHash: 'recipe:test',
    operationId: 'invalid-exposure',
    requestId: 'invalid-exposure',
    sessionId: 'agent-tone-adjustment-invalid',
  }).success
) {
  failures.push('agent tone dry-run accepted out-of-bounds exposure.');
}

if (
  agentToneAdjustmentDryRunRequestSchema.safeParse({
    adjustments: { temperature: 12 },
    expectedGraphRevision: 'history_0',
    expectedRecipeHash: 'recipe:test',
    operationId: 'invalid-field',
    requestId: 'invalid-field',
    sessionId: 'agent-tone-adjustment-invalid',
  }).success
) {
  failures.push('agent tone dry-run accepted non-basic-tone adjustment field.');
}

if (
  agentToneAdjustmentApplyRequestSchema.safeParse({
    adjustments: { exposure: 0.25 },
    expectedGraphRevision: 'history_0',
    expectedRecipeHash: 'recipe:test',
    operationId: 'missing-plan',
    requestId: 'missing-plan',
    sessionId: 'agent-tone-adjustment-invalid',
  }).success
) {
  failures.push('agent tone apply accepted a request without accepted dry-run identity.');
}

const initialSnapshot = buildAgentImageContextSnapshot();

let staleRejected = false;
try {
  await dryRunAgentToneAdjustment({
    adjustments: { exposure: 0.25 },
    expectedGraphRevision: initialSnapshot.graphRevision,
    expectedRecipeHash: 'recipe:stale',
    operationId: 'agent_tone_stale',
    requestId: 'agent-tone-stale',
    sessionId: 'agent-tone-adjustment-3161',
  });
} catch (error) {
  staleRejected = error instanceof Error && error.message.includes('expected=');
}
if (!staleRejected) failures.push('agent tone dry-run did not reject stale expected recipe hash.');

const adjustments = {
  clarity: 18,
  contrast: 24,
  exposure: 0.42,
  highlights: -22,
  saturation: 8,
  shadows: 16,
};
const dryRun = await dryRunAgentToneAdjustment({
  adjustments,
  expectedGraphRevision: initialSnapshot.graphRevision,
  expectedRecipeHash: initialSnapshot.initialPreview.recipeHash,
  operationId: 'agent_tone_adjustment_3161',
  requestId: 'agent-tone-dry-run-3161',
  sessionId: 'agent-tone-adjustment-3161',
});

if (
  dryRun.toolName !== AGENT_TONE_ADJUSTMENT_DRY_RUN_TOOL_NAME ||
  dryRun.sourceGraphRevision !== initialSnapshot.graphRevision ||
  dryRun.receipt.dryRunPlanHash !== dryRun.dryRunPlanHash ||
  dryRun.receipt.previewAfter.renderHash !== dryRun.previewAfter.renderHash ||
  dryRun.auditEventIds.length !== 1 ||
  !dryRun.auditEventIds[0]?.includes(dryRun.commandId) ||
  dryRun.stale.staleGraphRevision ||
  dryRun.stale.staleRecipeHash
) {
  failures.push('agent tone dry-run did not produce a bound preview-after receipt with audit metadata.');
}

const result = await applyAgentToneAdjustment({
  acceptedPlanHash: dryRun.dryRunPlanHash,
  acceptedPlanId: dryRun.dryRunPlanId,
  adjustments,
  expectedGraphRevision: dryRun.sourceGraphRevision,
  expectedRecipeHash: initialSnapshot.initialPreview.recipeHash,
  operationId: 'agent_tone_adjustment_3161',
  requestId: 'agent-tone-apply-3161',
  sessionId: 'agent-tone-adjustment-3161',
});

const state = useEditorStore.getState();
if (state.adjustments.exposure !== 0.42 || state.adjustments.contrast !== 24 || state.adjustments.clarity !== 18) {
  failures.push('agent tone apply did not mutate bounded basic tone adjustments.');
}
if (
  state.adjustments.temperature !== INITIAL_ADJUSTMENTS.temperature ||
  state.adjustments.tint !== INITIAL_ADJUSTMENTS.tint
) {
  failures.push('agent tone apply mutated non-basic-tone color adjustments.');
}
if (state.historyIndex !== 1 || state.history.length !== 2) {
  failures.push('agent tone apply must create one undoable history entry.');
}
if (state.lastBasicToneCommand?.commandType !== 'toneColor.setBasicTone' || state.lastBasicToneCommand.dryRun) {
  failures.push('agent tone apply did not retain the typed applied basic-tone command.');
}
if (state.uncroppedAdjustedPreviewUrl !== null) {
  failures.push('agent tone apply must invalidate stale preview output.');
}
if (
  result.toolName !== AGENT_TONE_ADJUSTMENT_APPLY_TOOL_NAME ||
  result.undoGraphRevision !== 'history_0' ||
  result.appliedGraphRevision !== 'history_1' ||
  result.receipt.previewAfter.previewRef !== result.previewAfter.previewRef ||
  result.receipt.afterPreviewHash !== result.afterPreviewHash ||
  result.beforePreviewHash === result.afterPreviewHash ||
  result.auditEventIds.length !== 2 ||
  !result.auditEventIds.every((eventId) => eventId.includes('basic_tone_agent_tone_adjustment_3161'))
) {
  failures.push('agent tone apply did not return edit revision, audit event ids, and preview-after receipt.');
}
for (const field of ['exposure', 'contrast', 'clarity', 'highlights', 'saturation', 'shadows']) {
  if (!result.adjustedFields.includes(field)) failures.push(`agent tone apply response missing field ${field}.`);
}

let mismatchRejected = false;
try {
  await applyAgentToneAdjustment({
    acceptedPlanHash: dryRun.dryRunPlanHash,
    acceptedPlanId: dryRun.dryRunPlanId,
    adjustments: { ...adjustments, exposure: 0.5 },
    expectedGraphRevision: dryRun.sourceGraphRevision,
    expectedRecipeHash: initialSnapshot.initialPreview.recipeHash,
    operationId: 'agent_tone_adjustment_3161',
    requestId: 'agent-tone-apply-mismatch-3161',
    sessionId: 'agent-tone-adjustment-3161',
  });
} catch (error) {
  mismatchRejected = error instanceof Error && error.message.includes('stale expected revision');
}
if (!mismatchRejected) failures.push('agent tone apply did not reject stale or mismatched receipt replay.');

const routeCatalog = buildRawEngineAppServerRouteCatalog();
const dryRunRoute = routeCatalog.find((candidate) => candidate.commandName === AGENT_TONE_ADJUSTMENT_DRY_RUN_TOOL_NAME);
const applyRoute = routeCatalog.find((candidate) => candidate.commandName === AGENT_TONE_ADJUSTMENT_APPLY_TOOL_NAME);
if (
  dryRunRoute === undefined ||
  dryRunRoute.family !== 'agent' ||
  !dryRunRoute.modes.includes(RawEngineAppServerRouteMode.DryRunCommand) ||
  !dryRunRoute.runtimeCheckScripts.includes('check:agent-tone-adjustment-tool')
) {
  failures.push('agent tone dry-run is missing from the agent route catalog.');
}
if (
  applyRoute === undefined ||
  applyRoute.family !== 'agent' ||
  !applyRoute.modes.includes(RawEngineAppServerRouteMode.ApplyDryRunPlan) ||
  !applyRoute.runtimeCheckScripts.includes('check:agent-tone-adjustment-tool')
) {
  failures.push('agent tone apply is missing from the agent route catalog.');
}

useEditorStore.setState({
  adjustments: INITIAL_ADJUSTMENTS,
  history: [INITIAL_ADJUSTMENTS],
  historyIndex: 0,
  lastBasicToneCommand: null,
  uncroppedAdjustedPreviewUrl: 'blob:rawengine-stale-uncropped',
});
const dispatchSnapshot = buildAgentImageContextSnapshot();
const dispatchDryRun = await buildRawEngineAppServerToolDispatchResponse({
  arguments: {
    adjustments: { exposure: 0.3, contrast: 12 },
    expectedGraphRevision: dispatchSnapshot.graphRevision,
    expectedRecipeHash: dispatchSnapshot.initialPreview.recipeHash,
    operationId: 'agent_tone_dispatch_3161',
    requestId: 'agent-tone-dispatch-dry-run-3161',
    sessionId: 'agent-tone-dispatch-3161',
  },
  requestId: 'agent-tone-dispatch-dry-run-3161',
  runtimeToolName: AGENT_TONE_ADJUSTMENT_DRY_RUN_TOOL_NAME,
  toolName: 'rawengine.app_server.dispatch_tool',
});
if (
  dispatchDryRun.status !== RawEngineAppServerResponseStatus.Ok ||
  !('dispatchStatus' in dispatchDryRun) ||
  dispatchDryRun.dispatchStatus !== 'completed' ||
  dispatchDryRun.runtimeToolName !== AGENT_TONE_ADJUSTMENT_DRY_RUN_TOOL_NAME
) {
  failures.push('agent tone dry-run did not dispatch through the app-server host.');
}

if (failures.length > 0) {
  console.error(`Agent tone adjustment tool failed (${failures.length})`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log('agent tone adjustment tool ok');
