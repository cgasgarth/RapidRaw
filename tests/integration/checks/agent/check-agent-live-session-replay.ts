#!/usr/bin/env bun

import { ToolType } from '../../../../src/components/panel/right/layers/Masks.tsx';
import { useEditorStore } from '../../../../src/store/useEditorStore.ts';
import { ActiveChannel, INITIAL_ADJUSTMENTS } from '../../../../src/utils/adjustments.ts';
import { buildAgentImageContextSnapshot } from '../../../../src/utils/agent/context/agentImageContextSnapshot.ts';
import {
  applyAgentSelectedImageLiveSession,
  approveAgentSelectedImageLiveSession,
  cancelAgentSelectedImageLiveSession,
  getAgentSelectedImageLiveSessionStaleReason,
  recordAgentSelectedImageLiveSessionLateResult,
  rejectAgentSelectedImageLiveSession,
  replayAgentSelectedImageLiveSessionAudit,
  rollbackAgentSelectedImageLiveSession,
  startAgentSelectedImageLiveSessionDryRun,
} from '../../../../src/utils/agent/session/agentSelectedImageLiveSession.ts';
import { agentAdjustmentsApplyResponseSchema } from '../../../../src/utils/agent/tools/agentAdjustmentApplyTool.ts';

const selectedPath = '/fixtures/public/agent-live-session-replay/DSC_3165.ARW';
const bins = Array.from({ length: 256 }, (_, index) => (index === 0 || index === 255 ? 9 : 3));

const seedEditor = () => {
  useEditorStore.getState().setEditor({
    adjustments: INITIAL_ADJUSTMENTS,
    brushSettings: { feather: 50, size: 64, tool: ToolType.Brush },
    finalPreviewUrl: 'blob:rawengine-agent-live-session-before',
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
      exif: { ISO: '250', LensModel: 'FE 24-70mm F2.8 GM II' },
      height: 4000,
      isRaw: true,
      isReady: true,
      originalUrl: 'blob:rawengine-original-live-session',
      path: selectedPath,
      thumbnailUrl: 'blob:rawengine-thumb-live-session',
      width: 6000,
    },
    uncroppedAdjustedPreviewUrl: null,
  });
};

const startDraft = async (requestId: string) =>
  startAgentSelectedImageLiveSessionDryRun({
    adjustments: { exposure: 0.22, highlights: -8, shadows: 14 },
    operationId: `${requestId}-operation`,
    prompt: 'Brighten the selected RAW, protect highlights, and lift foreground shadows.',
    requestId,
    sessionId: 'agent-live-session-replay',
  });

seedEditor();
const cancelDraft = await startDraft('agent-live-session-cancel');
if (cancelDraft.state !== 'approval_required') throw new Error('live session dry-run did not require approval.');
approveAgentSelectedImageLiveSession(cancelDraft);
if (cancelDraft.state !== 'dry_run_ready') throw new Error('live session approval did not unlock apply.');
const cancelAudit = cancelAgentSelectedImageLiveSession(cancelDraft);
const cancelReplay = replayAgentSelectedImageLiveSessionAudit(cancelAudit);
if (
  cancelReplay.approvalDecision !== 'cancelled' ||
  cancelReplay.cancellationOutcome !== 'cancelled_before_apply' ||
  cancelReplay.state !== 'cancelling'
) {
  throw new Error('live session cancel audit did not replay cancellation boundary.');
}

seedEditor();
const rejectedDraft = await startDraft('agent-live-session-rejected');
const rejectedAudit = rejectAgentSelectedImageLiveSession(rejectedDraft);
const rejectedReplay = replayAgentSelectedImageLiveSessionAudit(rejectedAudit);
if (
  rejectedReplay.approvalDecision !== 'rejected' ||
  rejectedReplay.state !== 'failed' ||
  rejectedReplay.toolCalls.at(-1)?.status !== 'blocked'
) {
  throw new Error('live session rejected approval audit did not replay blocked apply state.');
}
await expectRejects(() => applyAgentSelectedImageLiveSession(rejectedDraft), 'requires approval');

const fakeLateApply = agentAdjustmentsApplyResponseSchema.parse({
  adjustedFields: ['exposure'],
  afterPreviewHash: 'preview:late-after',
  appliedGraphRevision: 'history_99',
  beforePreviewHash: cancelDraft.snapshot.previewRenderHash,
  changedPixelCount: 100,
  changedPixelPercent: 10,
  maxChannelDelta: 0.2,
  meanLuminanceDelta: 0.1,
  receipt: {
    acceptedPlanHash: cancelDraft.dryRun.dryRunPlanHash,
    acceptedPlanId: cancelDraft.dryRun.dryRunPlanId,
    adjustedFields: ['exposure'],
    afterPreviewHash: 'preview:late-after',
    appliedGraphRevision: 'history_99',
    approvalId: 'approval-late-cancelled',
    approvalState: 'approved',
    beforePreviewHash: cancelDraft.snapshot.previewRenderHash,
    expectedGraphRevision: cancelDraft.dryRun.sourceGraphRevision,
    operationId: cancelDraft.operationId,
    sessionId: cancelDraft.sessionId,
    undoGraphRevision: cancelDraft.snapshot.graphRevision,
  },
  requestId: 'agent-live-session-late-apply',
  sampledPixelCount: 1000,
  staleRecipeHash: false,
  toolName: 'rawengine.agent.adjustments.apply',
  undoGraphRevision: cancelDraft.snapshot.graphRevision,
});
const lateAudit = recordAgentSelectedImageLiveSessionLateResult(cancelDraft, fakeLateApply);
if (replayAgentSelectedImageLiveSessionAudit(lateAudit).cancellationOutcome !== 'late_result_blocked') {
  throw new Error('live session audit did not preserve late-result cancellation outcome.');
}

seedEditor();
const staleDraft = approveAgentSelectedImageLiveSession(await startDraft('agent-live-session-stale'));
useEditorStore.setState((state) => ({
  selectedImage: state.selectedImage === null ? null : { ...state.selectedImage, path: '/fixtures/public/other.ARW' },
}));
if (getAgentSelectedImageLiveSessionStaleReason(staleDraft) !== 'image_changed') {
  throw new Error('live session stale guard did not detect selected-image change.');
}
await expectRejects(() => applyAgentSelectedImageLiveSession(staleDraft), 'image_changed');

seedEditor();
const stalePreviewDraft = approveAgentSelectedImageLiveSession(await startDraft('agent-live-session-stale-preview'));
useEditorStore.setState({ finalPreviewUrl: 'blob:rawengine-agent-live-session-refreshed-preview' });
if (getAgentSelectedImageLiveSessionStaleReason(stalePreviewDraft) !== 'preview_artifact_changed') {
  throw new Error('live session stale guard did not detect selected preview artifact change.');
}
await expectRejects(() => applyAgentSelectedImageLiveSession(stalePreviewDraft), 'preview_artifact_changed');

seedEditor();
const applyDraft = approveAgentSelectedImageLiveSession(await startDraft('agent-live-session-apply'));
const applyResult = await applyAgentSelectedImageLiveSession(applyDraft);
const appliedReceipt = replayAgentSelectedImageLiveSessionAudit(applyResult.audit);
if (
  appliedReceipt.approvalDecision !== 'approved' ||
  appliedReceipt.approvalId !== applyDraft.approvalId ||
  appliedReceipt.acceptedPreviewArtifactId !== applyDraft.snapshot.previewArtifactId ||
  appliedReceipt.applyGuard?.status !== 'passed' ||
  appliedReceipt.state !== 'applied' ||
  appliedReceipt.finalGraphRevision !== applyResult.apply.appliedGraphRevision ||
  appliedReceipt.afterPreviewHash !== applyResult.previewAfterHash
) {
  throw new Error('live session apply audit did not replay apply receipt.');
}
const transcriptKinds = applyResult.audit.transcript.map((entry) => entry.kind);
if (
  transcriptKinds.join(',') !==
  'preview,tool_call,tool_result,tool_call,tool_result,tool_call,tool_result,approval,apply_decision'
) {
  throw new Error(`live session transcript did not persist replayable tool order: ${transcriptKinds.join(',')}`);
}
if (
  !applyResult.audit.transcript.some(
    (entry) =>
      entry.kind === 'apply_decision' &&
      entry.acceptedPreviewArtifactId === applyDraft.snapshot.previewArtifactId &&
      entry.status === 'succeeded',
  )
) {
  throw new Error('live session transcript did not persist accepted apply decision metadata.');
}

await expectReplayRejects(
  {
    ...applyResult.audit,
    receipt: {
      ...applyResult.audit.receipt,
      approvalId: undefined,
    },
  },
  'approval id',
);
await expectReplayRejects(
  {
    ...applyResult.audit,
    transcript: applyResult.audit.transcript.map((entry) =>
      entry.kind === 'apply_decision' ? { ...entry, approvalId: 'approval-stale' } : entry,
    ),
  },
  'apply approval id',
);
await expectReplayRejects(
  {
    ...applyResult.audit,
    transcript: applyResult.audit.transcript.map((entry) =>
      entry.kind === 'apply_decision' ? { ...entry, acceptedPreviewArtifactId: 'artifact_stale_preview' } : entry,
    ),
  },
  'stale apply decision preview artifact',
);
await expectReplayRejects(
  {
    ...applyResult.audit,
    receipt: {
      ...applyResult.audit.receipt,
      applyGuard:
        applyResult.audit.receipt.applyGuard === undefined
          ? undefined
          : { ...applyResult.audit.receipt.applyGuard, status: 'rejected', staleReason: 'preview_artifact_changed' },
    },
  },
  'failed apply guard',
);

const postApplySnapshot = buildAgentImageContextSnapshot();
if (postApplySnapshot.graphRevision !== applyResult.apply.appliedGraphRevision) {
  throw new Error('live session apply did not mutate the expected graph revision.');
}
const rollbackAudit = await rollbackAgentSelectedImageLiveSession({
  audit: applyResult.audit,
  checkpoint: applyDraft.checkpoint,
});
const rollbackReceipt = replayAgentSelectedImageLiveSessionAudit(rollbackAudit);
if (rollbackReceipt.state !== 'rolled_back' || rollbackReceipt.rollbackReceiptGraphRevision !== 'history_0') {
  throw new Error('live session rollback audit did not replay rollback receipt.');
}
const finalState = useEditorStore.getState();
if (finalState.historyIndex !== 0 || finalState.adjustments.exposure !== INITIAL_ADJUSTMENTS.exposure) {
  throw new Error('live session rollback did not restore the original editor state.');
}

console.log('agent live session replay ok');

async function expectRejects(action: () => Promise<unknown>, expectedMessage: string) {
  try {
    await action();
  } catch (error) {
    if (error instanceof Error && error.message.includes(expectedMessage)) return;
    throw error;
  }
  throw new Error(`expected rejection containing ${expectedMessage}.`);
}

async function expectReplayRejects(
  audit: Parameters<typeof replayAgentSelectedImageLiveSessionAudit>[0],
  expectedMessage: string,
) {
  try {
    replayAgentSelectedImageLiveSessionAudit(audit);
  } catch (error) {
    if (error instanceof Error && error.message.includes(expectedMessage)) return;
    throw error;
  }
  throw new Error(`expected replay rejection containing ${expectedMessage}.`);
}
