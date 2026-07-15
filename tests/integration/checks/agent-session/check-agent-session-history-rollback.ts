#!/usr/bin/env bun

import { ToolType } from '../../../../src/components/panel/right/layers/Masks.tsx';
import { RawEngineAppServerRouteMode } from '../../../../src/schemas/agent/agentRuntimeSchemas.ts';
import { useEditorStore } from '../../../../src/store/useEditorStore.ts';
import { ActiveChannel, INITIAL_ADJUSTMENTS } from '../../../../src/utils/adjustments.ts';
import { buildAgentImageContextSnapshot } from '../../../../src/utils/agent/context/agentImageContextSnapshot.ts';
import {
  AGENT_HISTORY_ROLLBACK_TOOL_NAME,
  createAgentSessionCheckpoint,
  rollbackAgentSessionHistory,
} from '../../../../src/utils/agent/session/agentSessionHistory.ts';
import {
  applyAgentGlobalAdjustments,
  buildAgentAdjustmentsApplyApproval,
  dryRunAgentGlobalAdjustments,
} from '../../../../src/utils/agent/tools/agentAdjustmentApplyTool.ts';
import { buildRawEngineAppServerRouteCatalog } from '../../../../src/utils/rawEngineAppServerHost.ts';

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

const applyReceipt = await applyAgentGlobalAdjustments({
  acceptedPlanHash: dryRun.dryRunPlanHash,
  acceptedPlanId: dryRun.dryRunPlanId,
  adjustments: { exposure: 0.35, shadows: 20 },
  approval: buildAgentAdjustmentsApplyApproval({
    approvalId: 'approval-agent-history-apply-3163',
    dryRun,
    expectedRecipeHash: beforeRecipeHash,
    sessionId: 'agent-history-3163',
  }),
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
if (editedState.lastBasicToneCommand === null) {
  throw new Error('Agent edit did not retain runtime basic-tone provenance before rollback.');
}

if (editedState.imageSession === null) throw new Error('Expected active image session before rollback stale check.');
editedState.applyEditTransaction({
  baseAdjustmentRevision: editedState.adjustmentRevision,
  history: 'single-entry',
  imageSessionId: editedState.imageSession.id,
  operations: [{ patch: { contrast: 7 }, type: 'patch-adjustments' }],
  persistence: 'commit',
  source: 'agent-command',
  transactionId: 'agent-history-intervening-edit',
});
expectRejects(() =>
  rollbackAgentSessionHistory({
    checkpoint,
    expectedCurrentGraphRevision: applyReceipt.appliedGraphRevision,
    expectedCurrentPreviewRecipeHash: editedRecipeHash,
    expectedSelectedImagePath: selectedPath,
    requestId: 'agent-history-rollback-stale-graph',
    scope: 'session_start',
    sessionId: 'agent-history-3163',
  }),
);
if (useEditorStore.getState().historyIndex !== 2) {
  throw new Error('Rejected stale rollback mutated the current edit graph.');
}
useEditorStore.getState().goToHistoryIndex(1);
for (const [label, invalidCheckpoint] of [
  ['index', { ...checkpoint, graphRevision: 'history_99', historyIndex: 99 }],
  ['image', { ...checkpoint, activeImagePath: '/fixtures/other.ARW' }],
  ['graph', { ...checkpoint, graphRevision: 'history_99' }],
] as const) {
  const beforeInvalid = useEditorStore.getState();
  expectRejects(() =>
    rollbackAgentSessionHistory({
      checkpoint: invalidCheckpoint,
      requestId: `agent-history-rollback-invalid-${label}`,
      scope: 'session_start',
      sessionId: 'agent-history-3163',
    }),
  );
  const afterInvalid = useEditorStore.getState();
  if (
    afterInvalid.adjustmentRevision !== beforeInvalid.adjustmentRevision ||
    afterInvalid.historyIndex !== beforeInvalid.historyIndex ||
    JSON.stringify(afterInvalid.history) !== JSON.stringify(beforeInvalid.history) ||
    JSON.stringify(afterInvalid.adjustments) !== JSON.stringify(beforeInvalid.adjustments) ||
    afterInvalid.lastEditApplicationReceipt !== beforeInvalid.lastEditApplicationReceipt
  ) {
    throw new Error(`Invalid ${label} checkpoint mutated editor authority before rejection.`);
  }
}
const beforeRollbackRevision = useEditorStore.getState().adjustmentRevision;

const rollback = rollbackAgentSessionHistory({
  checkpoint,
  expectedCurrentGraphRevision: applyReceipt.appliedGraphRevision,
  expectedCurrentPreviewRecipeHash: editedRecipeHash,
  expectedSelectedImagePath: selectedPath,
  requestId: 'agent-history-rollback-3163',
  scope: 'session_start',
  sessionId: 'agent-history-3163',
});
const restoredState = useEditorStore.getState();
if (
  rollback.graphRevision !== 'history_0' ||
  rollback.currentGraphRevision !== applyReceipt.appliedGraphRevision ||
  rollback.currentPreviewRecipeHash !== editedRecipeHash ||
  !rollback.previewProvenanceRestored ||
  rollback.restoredHistoryIndex !== 0 ||
  rollback.sessionId !== checkpoint.sessionId
) {
  throw new Error('Agent history rollback did not report the applied-to-restored graph revisions.');
}
if (restoredState.historyIndex !== 0 || restoredState.history.length !== 1) {
  throw new Error('Agent history rollback did not restore session-start history.');
}
if (
  restoredState.adjustmentRevision !== beforeRollbackRevision + 1 ||
  restoredState.lastEditApplicationReceipt?.source !== 'history' ||
  restoredState.lastEditApplicationReceipt.transactionId !==
    'agent-history:agent-history-3163:session_start:agent-history-rollback-3163'
) {
  throw new Error('Agent history rollback did not publish one history-navigation transaction receipt.');
}
if (restoredState.adjustments.exposure !== INITIAL_ADJUSTMENTS.exposure || restoredState.adjustments.shadows !== 0) {
  throw new Error('Agent history rollback did not restore session-start adjustments.');
}
if (restoredState.finalPreviewUrl !== beforePreviewRef || restoredState.uncroppedAdjustedPreviewUrl !== null) {
  throw new Error('Agent history rollback did not restore preview identity and invalidate stale output.');
}
if (restoredState.lastBasicToneCommand !== null) {
  throw new Error('Agent history rollback did not restore pre-agent runtime provenance.');
}
if (rollback.previewRecipeHash !== beforeRecipeHash) {
  throw new Error('Agent history rollback did not restore the original recipe hash.');
}

const firstCheckpointEditState = useEditorStore.getState();
if (firstCheckpointEditState.imageSession === null)
  throw new Error('Expected image session for branch rollback proof.');
firstCheckpointEditState.applyEditTransaction({
  baseAdjustmentRevision: firstCheckpointEditState.adjustmentRevision,
  history: 'single-entry',
  imageSessionId: firstCheckpointEditState.imageSession.id,
  operations: [{ patch: { exposure: 0.6 }, type: 'patch-adjustments' }],
  persistence: 'commit',
  source: 'agent-command',
  transactionId: 'agent-history-checkpoint-first-edit',
});
const secondCheckpointEditState = useEditorStore.getState();
if (secondCheckpointEditState.imageSession === null)
  throw new Error('Expected image session for branch rollback proof.');
secondCheckpointEditState.applyEditTransaction({
  baseAdjustmentRevision: secondCheckpointEditState.adjustmentRevision,
  history: 'single-entry',
  imageSessionId: secondCheckpointEditState.imageSession.id,
  operations: [{ patch: { contrast: 18 }, type: 'patch-adjustments' }],
  persistence: 'commit',
  source: 'agent-command',
  transactionId: 'agent-history-checkpoint-second-edit',
});
const fullHistoryCheckpoint = createAgentSessionCheckpoint('agent-history-branch-3163');
if (fullHistoryCheckpoint.historyIndex !== 2 || fullHistoryCheckpoint.history.length !== 3) {
  throw new Error('Branch rollback proof did not capture the expected full checkpoint history.');
}

useEditorStore.getState().goToHistoryIndex(0);
const divergentEditState = useEditorStore.getState();
if (divergentEditState.imageSession === null) throw new Error('Expected image session for divergent branch proof.');
divergentEditState.applyEditTransaction({
  baseAdjustmentRevision: divergentEditState.adjustmentRevision,
  history: 'single-entry',
  imageSessionId: divergentEditState.imageSession.id,
  operations: [{ patch: { saturation: -12 }, type: 'patch-adjustments' }],
  persistence: 'commit',
  source: 'agent-command',
  transactionId: 'agent-history-divergent-edit',
});
const truncatedState = useEditorStore.getState();
if (truncatedState.history.length !== 2 || fullHistoryCheckpoint.historyIndex < truncatedState.history.length) {
  throw new Error('Branch rollback proof did not truncate current history below the valid checkpoint target.');
}

rollbackAgentSessionHistory({
  checkpoint: fullHistoryCheckpoint,
  requestId: 'agent-history-rollback-full-checkpoint',
  scope: 'session_start',
  sessionId: fullHistoryCheckpoint.sessionId,
});
const restoredFullHistoryState = useEditorStore.getState();
if (
  restoredFullHistoryState.historyIndex !== fullHistoryCheckpoint.historyIndex ||
  restoredFullHistoryState.history.length !== fullHistoryCheckpoint.history.length ||
  restoredFullHistoryState.adjustments.exposure !== 0.6 ||
  restoredFullHistoryState.adjustments.contrast !== 18
) {
  throw new Error('Agent history rollback did not restore a valid target beyond truncated current history.');
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
