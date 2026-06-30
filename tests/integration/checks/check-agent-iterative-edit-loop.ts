#!/usr/bin/env bun

import { mkdir } from 'node:fs/promises';

import { ToolType } from '../../../src/components/panel/right/layers/Masks.tsx';
import { useEditorStore } from '../../../src/store/useEditorStore.ts';
import { ActiveChannel, INITIAL_ADJUSTMENTS } from '../../../src/utils/adjustments.ts';
import {
  applyAgentGlobalAdjustments,
  dryRunAgentGlobalAdjustments,
} from '../../../src/utils/agentAdjustmentApplyTool.ts';
import { buildAgentEditQualityReview } from '../../../src/utils/agentEditQualityReview.ts';
import { buildAgentImageContextSnapshot } from '../../../src/utils/agentImageContextSnapshot.ts';
import {
  agentIterativeEditLoopRequestSchema,
  runAgentIterativeEditLoop,
} from '../../../src/utils/agentIterativeEditLoop.ts';

const selectedPath = '/Users/cgas/Pictures/Capture One/Alaska/DSC_3162.ARW';
const bins = Array.from({ length: 256 }, (_, index) => (index === 0 || index === 255 ? 14 : 2));

const seedEditor = () => {
  useEditorStore.getState().setEditor({
    adjustments: INITIAL_ADJUSTMENTS,
    brushSettings: { feather: 50, size: 72, tool: ToolType.Brush },
    finalPreviewUrl: 'blob:rawengine-agent-loop-before',
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
      originalUrl: 'blob:rawengine-original-3162',
      path: selectedPath,
      thumbnailUrl: 'blob:rawengine-thumb-3162',
      width: 6000,
    },
    uncroppedAdjustedPreviewUrl: null,
  });
};

const baseLoopRequest = {
  maxIterations: 4,
  operationId: 'agent_loop_3162',
  prompt: 'Brighten the exposure, inspect the preview, then lift shadows if the foreground still feels dense.',
  requestId: 'agent-loop-3162',
  rollbackAfterReview: true,
  sessionId: 'agent-loop-3162',
  steps: [
    { exposure: 0.28, highlights: -12 },
    {
      assistantRationale: 'After preview feedback, lift shadows and inspect a cropped detail preview.',
      exposure: 0.34,
      preview: {
        crop: { height: 0.35, width: 0.3, x: 0.25, y: 0.2 },
        maxPixelCount: 800_000,
        purpose: 'detail_review',
        zoom: { centerX: 0.5, centerY: 0.55, scale: 2.5 },
      },
      shadows: 18,
      userFollowUp: 'Foreground still feels dense; inspect the detail area before final review.',
    },
  ],
} as const;

const buildAcceptedDryRunApprovals = async () => {
  const approvals: Array<{
    acceptedPlanHash: string;
    acceptedPlanId: string;
    approvalState: 'approved';
    expectedGraphRevision: string;
    turn: number;
  }> = [];

  for (const [index, step] of baseLoopRequest.steps.entries()) {
    const {
      assistantRationale: _assistantRationale,
      preview: _preview,
      userFollowUp: _userFollowUp,
      ...adjustments
    } = step;
    const snapshot = buildAgentImageContextSnapshot();
    const operationId = `${baseLoopRequest.operationId}-${index + 1}`;
    const dryRun = await dryRunAgentGlobalAdjustments({
      adjustments,
      expectedGraphRevision: snapshot.graphRevision,
      expectedRecipeHash: snapshot.initialPreview.recipeHash,
      operationId,
      requestId: `${baseLoopRequest.requestId}-approval-dry-run-${index + 1}`,
      sessionId: baseLoopRequest.sessionId,
    });
    approvals.push({
      acceptedPlanHash: dryRun.dryRunPlanHash,
      acceptedPlanId: dryRun.dryRunPlanId,
      approvalState: 'approved',
      expectedGraphRevision: dryRun.sourceGraphRevision,
      turn: index + 2,
    });
    await applyAgentGlobalAdjustments({
      acceptedPlanHash: dryRun.dryRunPlanHash,
      acceptedPlanId: dryRun.dryRunPlanId,
      adjustments,
      expectedGraphRevision: dryRun.sourceGraphRevision,
      expectedRecipeHash: snapshot.initialPreview.recipeHash,
      operationId,
      requestId: `${baseLoopRequest.requestId}-approval-apply-${index + 1}`,
      sessionId: baseLoopRequest.sessionId,
    });
  }

  return approvals;
};

seedEditor();
const acceptedApprovals = await buildAcceptedDryRunApprovals();
seedEditor();

if (
  agentIterativeEditLoopRequestSchema.safeParse({
    dryRunApprovals: [{ ...acceptedApprovals[0], acceptedPlanHash: '' }],
    maxIterations: 1,
    operationId: 'invalid',
    prompt: 'too short',
    requestId: 'invalid',
    rollbackAfterReview: true,
    sessionId: 'invalid',
    steps: [{ exposure: 0.2 }],
  }).success
) {
  throw new Error('agent iterative loop accepted too few iterations and steps.');
}

await expectRejectsAsync(
  () =>
    runAgentIterativeEditLoop({
      ...baseLoopRequest,
      dryRunApprovals: [],
      requestId: 'agent-loop-missing-approval',
    }),
  'missing dry-run approval',
);
seedEditor();
await expectRejectsAsync(
  () =>
    runAgentIterativeEditLoop({
      ...baseLoopRequest,
      dryRunApprovals: [{ ...acceptedApprovals[0], acceptedPlanHash: 'dryrun_stale' }],
      requestId: 'agent-loop-stale-approval',
    }),
  'stale plan hash',
);
seedEditor();
await expectRejectsAsync(
  () =>
    runAgentIterativeEditLoop({
      ...baseLoopRequest,
      dryRunApprovals: [{ ...acceptedApprovals[0], expectedGraphRevision: 'history_99' }],
      requestId: 'agent-loop-revision-mismatch',
    }),
  'stale graph revision',
);
seedEditor();

const result = await runAgentIterativeEditLoop({
  ...baseLoopRequest,
  dryRunApprovals: acceptedApprovals,
});

const state = useEditorStore.getState();
const toolNames = result.transcript.map((entry) => entry.toolName);

if (result.stopReason !== 'completed' || result.editCount !== 2 || result.previewRefreshCount !== 2) {
  throw new Error('agent iterative loop did not complete two edit/preview iterations.');
}
if (result.reviewStatus !== 'needs_user_review') {
  throw new Error('agent iterative loop did not stop at a bounded user-review status.');
}
if (
  result.userFeedbackTurns.length !== 1 ||
  result.userFeedbackTurns[0]?.turn !== 3 ||
  result.userFeedbackTurns[0]?.previewArtifactId !== result.previewRefreshes[1]?.artifactId
) {
  throw new Error('agent iterative loop did not bind user feedback to the next preview artifact.');
}
if (
  result.previewRefreshes.length !== 2 ||
  result.previewRefreshes[0]?.purpose !== 'refresh' ||
  result.previewRefreshes[0]?.longEdgePx !== 1024 ||
  result.previewRefreshes[0]?.cacheKey === result.previewRefreshes[1]?.cacheKey
) {
  throw new Error('agent iterative loop did not preserve distinct preview envelopes.');
}
const detailPreview = result.previewRefreshes[1];
if (
  detailPreview?.purpose !== 'detail_review' ||
  detailPreview.crop?.unit !== 'normalized' ||
  detailPreview.crop.width !== 0.3 ||
  detailPreview.zoom?.scale !== 2.5 ||
  detailPreview.width * detailPreview.height > 800_000
) {
  throw new Error('agent iterative loop did not honor the second-turn detail preview request.');
}
if (
  result.previewLineage.length !== 2 ||
  result.previewLineage[0]?.appliedGraphRevision !== 'history_1' ||
  result.previewLineage[1]?.appliedGraphRevision !== 'history_2' ||
  result.previewLineage[1]?.previewArtifactId !== detailPreview.artifactId ||
  result.previewLineage.some((lineage) => lineage.sourceToolName !== 'rawengine.agent.adjustments.apply')
) {
  throw new Error('agent iterative loop did not bind preview refreshes to apply receipt lineage.');
}
if (result.acceptedDryRunPlanCount !== 2) {
  throw new Error('agent iterative loop did not require accepted dry-run plans before apply.');
}
if (
  result.rollbackCheckpoint.graphRevision !== 'history_0' ||
  result.rollbackCheckpoint.previewRecipeHash.length === 0 ||
  result.rollbackReceipt?.toolName !== 'rawengine.agent.history.rollback' ||
  result.rollbackReceipt.graphRevision !== 'history_0'
) {
  throw new Error('agent iterative loop did not preserve and expose rollback checkpoint/receipt.');
}
if (state.adjustments.exposure !== INITIAL_ADJUSTMENTS.exposure || state.historyIndex !== 0) {
  throw new Error('agent iterative loop did not rollback to the session checkpoint after review.');
}
if (state.history.length !== 1 || state.uncroppedAdjustedPreviewUrl !== null) {
  throw new Error('agent iterative loop rollback did not maintain history and preview invalidation.');
}
if (
  toolNames.filter((name) => name === 'rawengine.agent.adjustments.apply').length !== 2 ||
  toolNames.filter((name) => name === 'rawengine.agent.preview.render').length !== 2 ||
  toolNames.filter((name) => name === 'rawengine.agent.adjustments.dry_run').length !== 2 ||
  toolNames[0] !== 'rawengine.agent.state.get'
) {
  throw new Error(`agent iterative loop transcript has wrong tool order: ${toolNames.join(',')}`);
}
if (result.appliedGraphRevision !== 'history_2' || result.finalRecipeHash.length === 0) {
  throw new Error('agent iterative loop did not report final graph and recipe hash.');
}
if (
  result.editReview.stopReason !== 'finish' ||
  result.editReview.preview.id !== result.previewRefreshes.at(-1)?.id ||
  result.editReview.beforePreview.id !== result.previewRefreshes[0]?.id ||
  result.editReview.afterPreview.id !== result.previewRefreshes[1]?.id ||
  result.editReview.preview.recipeHash !== result.finalRecipeHash ||
  result.editReview.toolReceiptCount !== 2 ||
  result.editReview.toolReceipts.length !== 2 ||
  result.editReview.followUpRequests.length !== 0
) {
  throw new Error('agent iterative loop did not bind review to before/after previews and receipts.');
}
if (
  !result.editReview.rubric.some((entry) => entry.area === 'exposure_tone' && entry.status === 'pass') ||
  !result.editReview.rubric.some((entry) => entry.area === 'crop_detail')
) {
  throw new Error('agent iterative loop edit review is missing required rubric areas.');
}
if (!result.transcript.some((entry) => entry.toolName === 'rawengine.agent.edit_review')) {
  throw new Error('agent iterative loop transcript did not persist the edit review decision.');
}
if (
  result.compareReview.toolName !== 'rawengine.agent.preview.compare' ||
  result.compareReview.beforeArtifactId.length === 0 ||
  result.compareReview.currentArtifactId.length === 0 ||
  result.compareReview.currentRecipeHash !== result.finalRecipeHash
) {
  throw new Error('agent iterative loop did not create final before/current compare artifacts.');
}
if (
  !result.transcript.some((entry) => entry.toolName === 'rawengine.agent.user_feedback') ||
  !result.transcript.some((entry) => entry.toolName === 'rawengine.agent.plan.refine') ||
  !result.transcript.some((entry) => entry.toolName === 'rawengine.agent.preview.compare')
) {
  throw new Error('agent iterative loop transcript did not preserve feedback, plan, and compare tool calls.');
}
const auditTypes = result.auditEvents.map((event) => event.type);
if (
  auditTypes.filter((type) => type === 'dry_run').length !== 2 ||
  auditTypes.filter((type) => type === 'apply').length !== 2 ||
  auditTypes.filter((type) => type === 'preview_render').length !== 2 ||
  auditTypes.at(-1) !== 'rollback'
) {
  throw new Error(
    `agent iterative loop audit did not preserve dry-run/apply/preview/rollback order: ${auditTypes.join(',')}`,
  );
}
if (
  result.auditEvents.some(
    (event) =>
      event.type === 'apply' &&
      (event.dryRunPlanHash === undefined ||
        (event.rollbackGraphRevision !== 'history_0' && event.rollbackGraphRevision !== 'history_1')),
  )
) {
  throw new Error('agent iterative loop apply audit did not link accepted dry-run plan and rollback lineage.');
}

const artifactDir = 'artifacts/validation/agent';
const artifactPath = `${artifactDir}/agent-feedback-preview-loop.html`;
await mkdir(artifactDir, { recursive: true });
await Bun.write(
  artifactPath,
  `<!doctype html><meta charset="utf-8"><title>Agent feedback preview loop</title>
<h1>Agent feedback preview loop</h1>
<dl>
<dt>Prompt</dt><dd>${result.transcript[0]?.detail ?? ''}</dd>
<dt>Status</dt><dd>${result.reviewStatus}</dd>
<dt>Tool calls</dt><dd>${toolNames.join(', ')}, ${result.compareReview.toolName}</dd>
<dt>Before artifact</dt><dd>${result.compareReview.beforeArtifactId}</dd>
<dt>Current artifact</dt><dd>${result.compareReview.currentArtifactId}</dd>
<dt>Final graph</dt><dd>${result.appliedGraphRevision}</dd>
<dt>Final recipe</dt><dd>${result.finalRecipeHash}</dd>
<dt>Accepted dry-run plans</dt><dd>${result.acceptedDryRunPlanCount}</dd>
<dt>Audit events</dt><dd>${auditTypes.join(' -> ')}</dd>
<dt>Rollback</dt><dd>${result.rollbackReceipt?.toolName ?? 'not-run'} ${result.rollbackReceipt?.graphRevision ?? ''}</dd>
<dt>Feedback</dt><dd>${result.userFeedbackTurns.map((turn) => turn.userFollowUp).join(' | ')}</dd>
</dl>`,
);

const detailReview = buildAgentEditQualityReview({
  beforePreview: result.previewRefreshes[0],
  maxIterationsReached: false,
  preview: result.previewRefreshes[0],
  prompt: 'Retouch the distracting object and inspect detail artifacts.',
  toolReceiptCount: 1,
  toolReceipts: [{ graphRevision: 'history_1', summary: 'exposure', toolName: 'rawengine.agent.adjustments.apply' }],
});
if (
  detailReview.stopReason !== 'request_detail_preview' ||
  detailReview.followUpRequests[0]?.toolName !== 'rawengine.agent.preview.render' ||
  !detailReview.rubric.some((entry) => entry.area === 'retouch_artifacts' && entry.status === 'attention')
) {
  throw new Error('agent edit review did not request a detail preview for retouch/detail prompts.');
}

console.log(`agent iterative edit loop ok (${artifactPath})`);

async function expectRejectsAsync(action: () => Promise<unknown>, label: string) {
  try {
    await action();
  } catch {
    return;
  }
  throw new Error(`Expected rejection for ${label}.`);
}
