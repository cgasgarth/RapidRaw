#!/usr/bin/env bun

import { ToolType } from '../../../src/components/panel/right/Masks.tsx';
import { RawEngineAppServerRouteMode } from '../../../src/schemas/agentRuntimeSchemas.ts';
import { useEditorStore } from '../../../src/store/useEditorStore.ts';
import { ActiveChannel, INITIAL_ADJUSTMENTS } from '../../../src/utils/adjustments.ts';
import {
  applyAgentGlobalAdjustments,
  dryRunAgentGlobalAdjustments,
} from '../../../src/utils/agentAdjustmentApplyTool.ts';
import { buildAgentImageContextSnapshot } from '../../../src/utils/agentImageContextSnapshot.ts';
import {
  AGENT_HISTORY_ROLLBACK_TOOL_NAME,
  createAgentSessionCheckpoint,
  rollbackAgentSessionHistory,
} from '../../../src/utils/agentSessionHistory.ts';
import { buildRawEngineAppServerRouteCatalog } from '../../../src/utils/rawEngineAppServerHost.ts';

const selectedPath = '/Users/cgas/Pictures/Capture One/Alaska/DSC_3163.ARW';
const bins = Array.from({ length: 256 }, (_, index) => (index === 0 || index === 255 ? 18 : 2));

useEditorStore.getState().setEditor({
  adjustments: INITIAL_ADJUSTMENTS,
  brushSettings: { feather: 50, size: 72, tool: ToolType.Brush },
  finalPreviewUrl: 'blob:rawengine-agent-history-before',
  hasRenderedFirstFrame: true,
  histogram: {
    [ActiveChannel.Blue]: { color: '#4D96FF', data: bins },
    [ActiveChannel.Green]: { color: '#6BCB77', data: bins },
    [ActiveChannel.Luma]: { color: '#FFFFFF', data: bins },
    [ActiveChannel.Red]: { color: '#FF6B6B', data: bins },
  },
  history: [INITIAL_ADJUSTMENTS],
  historyIndex: 0,
  selectedImage: {
    exif: { ISO: '640', LensModel: 'FE 24-70mm F2.8 GM II' },
    height: 4000,
    isRaw: true,
    isReady: true,
    originalUrl: 'blob:rawengine-original-3163',
    path: selectedPath,
    thumbnailUrl: 'blob:rawengine-thumb-3163',
    width: 6000,
  },
  uncroppedAdjustedPreviewUrl: null,
});

const checkpoint = createAgentSessionCheckpoint('agent-history-3163');
const beforeRecipeHash = checkpoint.previewRecipeHash;
const beforePreviewRef = checkpoint.previewRef;
const dryRun = await dryRunAgentGlobalAdjustments({
  adjustments: { exposure: 0.35, shadows: 20 },
  expectedGraphRevision: checkpoint.graphRevision,
  expectedRecipeHash: beforeRecipeHash,
  operationId: 'agent_history_apply_3163',
  requestId: 'agent-history-dry-run-3163',
  sessionId: 'agent-history-3163',
});

await applyAgentGlobalAdjustments({
  acceptedPlanHash: dryRun.dryRunPlanHash,
  acceptedPlanId: dryRun.dryRunPlanId,
  adjustments: { exposure: 0.35, shadows: 20 },
  expectedGraphRevision: dryRun.sourceGraphRevision,
  expectedRecipeHash: beforeRecipeHash,
  operationId: 'agent_history_apply_3163',
  requestId: 'agent-history-apply-3163',
  sessionId: 'agent-history-3163',
});

const editedState = useEditorStore.getState();
const editedRecipeHash = buildAgentImageContextSnapshot().initialPreview.recipeHash;
if (editedState.historyIndex !== 1 || editedState.adjustments.exposure !== 0.35) {
  throw new Error('Agent history rollback test did not apply the edit before rollback.');
}
if (editedRecipeHash === beforeRecipeHash) {
  throw new Error('Agent edit did not change recipe hash before rollback.');
}

const rollback = rollbackAgentSessionHistory({
  checkpoint,
  requestId: 'agent-history-rollback-3163',
  scope: 'session_start',
  sessionId: 'agent-history-3163',
});
const restoredState = useEditorStore.getState();
if (
  rollback.graphRevision !== 'history_0' ||
  rollback.restoredHistoryIndex !== 0 ||
  rollback.sessionId !== checkpoint.sessionId
) {
  throw new Error('Agent history rollback did not report the session-start graph revision.');
}
if (restoredState.historyIndex !== 0 || restoredState.history.length !== 1) {
  throw new Error('Agent history rollback did not restore session-start history.');
}
if (restoredState.adjustments.exposure !== INITIAL_ADJUSTMENTS.exposure || restoredState.adjustments.shadows !== 0) {
  throw new Error('Agent history rollback did not restore session-start adjustments.');
}
if (restoredState.finalPreviewUrl !== beforePreviewRef || restoredState.uncroppedAdjustedPreviewUrl !== null) {
  throw new Error('Agent history rollback did not restore preview identity and invalidate stale output.');
}
if (rollback.previewRecipeHash !== beforeRecipeHash) {
  throw new Error('Agent history rollback did not restore the original recipe hash.');
}
expectRejects(() =>
  rollbackAgentSessionHistory({
    checkpoint,
    requestId: 'agent-history-rollback-wrong-session',
    scope: 'session_start',
    sessionId: 'agent-history-other',
  }),
);

const route = buildRawEngineAppServerRouteCatalog().find(
  (candidate) => candidate.commandName === AGENT_HISTORY_ROLLBACK_TOOL_NAME,
);
if (
  route === undefined ||
  route.family !== 'agent' ||
  !route.modes.includes(RawEngineAppServerRouteMode.ApplyDryRunPlan)
) {
  throw new Error('agent.history.rollback is missing from the mutating agent route catalog.');
}

console.log('agent session history rollback ok');

function expectRejects(action: () => unknown) {
  try {
    action();
  } catch {
    return;
  }
  throw new Error('Expected cross-session rollback rejection.');
}
