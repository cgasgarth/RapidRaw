#!/usr/bin/env bun

import { mkdir } from 'node:fs/promises';

import { ToolType } from '../../../src/components/panel/right/Masks.tsx';
import { useEditorStore } from '../../../src/store/useEditorStore.ts';
import { ActiveChannel, INITIAL_ADJUSTMENTS } from '../../../src/utils/adjustments.ts';
import { buildAgentEditQualityReview } from '../../../src/utils/agentEditQualityReview.ts';
import {
  agentIterativeEditLoopRequestSchema,
  runAgentIterativeEditLoop,
} from '../../../src/utils/agentIterativeEditLoop.ts';

const selectedPath = '/Users/cgas/Pictures/Capture One/Alaska/DSC_3162.ARW';
const bins = Array.from({ length: 256 }, (_, index) => (index === 0 || index === 255 ? 14 : 2));

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

if (
  agentIterativeEditLoopRequestSchema.safeParse({
    maxIterations: 1,
    operationId: 'invalid',
    prompt: 'too short',
    requestId: 'invalid',
    sessionId: 'invalid',
    steps: [{ exposure: 0.2 }],
  }).success
) {
  throw new Error('agent iterative loop accepted too few iterations and steps.');
}

const result = await runAgentIterativeEditLoop({
  maxIterations: 4,
  operationId: 'agent_loop_3162',
  prompt: 'Brighten the exposure, inspect the preview, then lift shadows if the foreground still feels dense.',
  requestId: 'agent-loop-3162',
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
if (state.adjustments.exposure !== 0.34 || state.adjustments.shadows !== 18 || state.historyIndex !== 2) {
  throw new Error('agent iterative loop did not apply both editing turns into history.');
}
if (state.history.length !== 3 || state.uncroppedAdjustedPreviewUrl !== null) {
  throw new Error('agent iterative loop did not maintain undo history and preview invalidation.');
}
if (
  toolNames.filter((name) => name === 'rawengine.agent.adjustments.apply').length !== 2 ||
  toolNames.filter((name) => name === 'rawengine.agent.preview.render').length !== 2 ||
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
