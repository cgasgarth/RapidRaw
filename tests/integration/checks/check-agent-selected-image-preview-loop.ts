#!/usr/bin/env bun

import { ToolType } from '../../../src/components/panel/right/Masks.tsx';
import { RawEngineAppServerHostToolName } from '../../../src/schemas/agentRuntimeSchemas.ts';
import { useEditorStore } from '../../../src/store/useEditorStore.ts';
import { ActiveChannel, INITIAL_ADJUSTMENTS } from '../../../src/utils/adjustments.ts';
import {
  applyAgentGlobalAdjustments,
  dryRunAgentGlobalAdjustments,
} from '../../../src/utils/agentAdjustmentApplyTool.ts';
import { AGENT_CURRENT_IMAGE_PREVIEW_LOOP_TOOL_NAME } from '../../../src/utils/agentCurrentImagePreviewLoop.ts';
import { buildAgentImageContextSnapshot } from '../../../src/utils/agentImageContextSnapshot.ts';
import {
  buildRawEngineAppServerRouteCatalog,
  handleRawEngineAppServerHostRequestAsync,
} from '../../../src/utils/rawEngineAppServerHost.ts';

const selectedPath = '/fixtures/public/agent-selected-image-preview-loop/DSC_3162.ARW';
const bins = Array.from({ length: 256 }, (_, index) => (index === 0 || index === 255 ? 11 : 3));

const seedEditor = () => {
  useEditorStore.getState().setEditor({
    adjustments: INITIAL_ADJUSTMENTS,
    brushSettings: { feather: 50, size: 64, tool: ToolType.Brush },
    finalPreviewUrl: 'blob:rawengine-selected-loop-before',
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
      originalUrl: 'blob:rawengine-original-selected-loop',
      path: selectedPath,
      thumbnailUrl: 'blob:rawengine-thumb-selected-loop',
      width: 6000,
    },
    uncroppedAdjustedPreviewUrl: null,
  });
};

const baseLoopRequest = {
  maxIterations: 4,
  operationId: 'agent_selected_loop_3162',
  prompt: 'Brighten the selected image, inspect the preview, then lift shadows if the foreground is still dense.',
  requestId: 'agent-selected-loop-3162',
  rollbackAfterReview: true,
  sessionId: 'agent-selected-loop-3162',
  steps: [
    { exposure: 0.26, highlights: -10 },
    {
      assistantRationale: 'After selected-image preview feedback, lift foreground shadows and inspect detail.',
      exposure: 0.32,
      preview: {
        crop: { height: 0.34, width: 0.32, x: 0.22, y: 0.21 },
        maxPixelCount: 800_000,
        purpose: 'detail_review',
        zoom: { centerX: 0.5, centerY: 0.55, scale: 2.4 },
      },
      shadows: 16,
      userFollowUp: 'The selected preview still needs foreground separation; inspect detail before review.',
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

const dispatchSelectedImageLoop = async (args: unknown, requestId: string) =>
  handleRawEngineAppServerHostRequestAsync({
    arguments: args,
    requestId,
    runtimeToolName: AGENT_CURRENT_IMAGE_PREVIEW_LOOP_TOOL_NAME,
    toolName: RawEngineAppServerHostToolName.DispatchTool,
  });

const route = buildRawEngineAppServerRouteCatalog().find(
  (entry) => entry.commandName === AGENT_CURRENT_IMAGE_PREVIEW_LOOP_TOOL_NAME,
);
if (route === undefined) throw new Error('selected-image preview loop route is not registered.');
if (
  route.toolNames[0] !== AGENT_CURRENT_IMAGE_PREVIEW_LOOP_TOOL_NAME ||
  !route.runtimeCheckScripts.includes('check:agent-selected-image-preview-loop')
) {
  throw new Error('selected-image preview loop route did not expose the command and focused check.');
}

seedEditor();
const initialSnapshot = buildAgentImageContextSnapshot();
const acceptedApprovals = await buildAcceptedDryRunApprovals();
seedEditor();

const commandRequest = {
  ...baseLoopRequest,
  dryRunApprovals: acceptedApprovals,
  expectedGraphRevision: initialSnapshot.graphRevision,
  expectedPreviewHeight: initialSnapshot.initialPreview.height,
  expectedPreviewIdentity: initialSnapshot.previewIdentity,
  expectedPreviewWidth: initialSnapshot.initialPreview.width,
  expectedRecipeHash: initialSnapshot.initialPreview.recipeHash,
  selectedImagePath: initialSnapshot.activeImagePath,
};

useEditorStore.setState({ selectedImage: null });
const noSelection = await dispatchSelectedImageLoop(commandRequest, 'agent-selected-loop-no-selection');
if (noSelection.dispatchStatus !== 'rejected' || !noSelection.message?.includes('selected image')) {
  throw new Error('selected-image preview loop did not reject missing selection.');
}

seedEditor();
const wrongImage = await dispatchSelectedImageLoop(
  { ...commandRequest, selectedImagePath: '/fixtures/public/other.ARW' },
  'agent-selected-loop-wrong-image',
);
if (wrongImage.dispatchStatus !== 'rejected' || !wrongImage.message?.includes('different selected image')) {
  throw new Error('selected-image preview loop did not reject selected-image mismatch.');
}

seedEditor();
const staleGraph = await dispatchSelectedImageLoop(
  { ...commandRequest, expectedGraphRevision: 'history_99' },
  'agent-selected-loop-stale-graph',
);
if (staleGraph.dispatchStatus !== 'rejected' || !staleGraph.message?.includes('stale graph revision')) {
  throw new Error('selected-image preview loop did not reject stale graph revision.');
}

seedEditor();
const staleRecipe = await dispatchSelectedImageLoop(
  { ...commandRequest, expectedRecipeHash: 'recipe:stale' },
  'agent-selected-loop-stale-recipe',
);
if (staleRecipe.dispatchStatus !== 'rejected' || !staleRecipe.message?.includes('stale recipe hash')) {
  throw new Error('selected-image preview loop did not reject stale recipe hash.');
}

seedEditor();
const stalePreviewIdentity = await dispatchSelectedImageLoop(
  { ...commandRequest, expectedPreviewIdentity: 'blob:stale-preview' },
  'agent-selected-loop-stale-preview-identity',
);
if (
  stalePreviewIdentity.dispatchStatus !== 'rejected' ||
  !stalePreviewIdentity.message?.includes('stale preview identity')
) {
  throw new Error('selected-image preview loop did not reject stale preview identity.');
}

seedEditor();
const staleDimensions = await dispatchSelectedImageLoop(
  { ...commandRequest, expectedPreviewWidth: initialSnapshot.initialPreview.width + 1 },
  'agent-selected-loop-stale-dimensions',
);
if (staleDimensions.dispatchStatus !== 'rejected' || !staleDimensions.message?.includes('stale selected-image')) {
  throw new Error('selected-image preview loop did not reject stale selected-image dimensions.');
}

seedEditor();
const missingApproval = await dispatchSelectedImageLoop(
  { ...commandRequest, dryRunApprovals: [acceptedApprovals[0]] },
  'agent-selected-loop-missing-approval',
);
if (missingApproval.dispatchStatus !== 'rejected' || !missingApproval.message?.includes('without accepted dry-run')) {
  throw new Error('selected-image preview loop did not reject missing dry-run approval.');
}

seedEditor();
const staleApproval = await dispatchSelectedImageLoop(
  {
    ...commandRequest,
    dryRunApprovals: [{ ...acceptedApprovals[0], expectedGraphRevision: 'history_99' }, acceptedApprovals[1]],
  },
  'agent-selected-loop-stale-approval',
);
if (staleApproval.dispatchStatus !== 'rejected' || !staleApproval.message?.includes('stale graph revision')) {
  throw new Error('selected-image preview loop did not reject stale approval graph revision.');
}

seedEditor();
const success = await dispatchSelectedImageLoop(commandRequest, 'agent-selected-loop-success');
if (success.dispatchStatus !== 'completed' || success.result === undefined) {
  throw new Error(`selected-image preview loop dispatch failed: ${success.message ?? 'missing result'}`);
}
const result = success.result as {
  acceptedDryRunPlanCount: number;
  applyReceipts: Array<{ changedPixelCount: number; changedPixelPercent: number }>;
  auditEventSummary: Array<{ toolName: string; type: string }>;
  compareArtifactIds: { beforeArtifactId: string; currentArtifactId: string };
  editCount: number;
  finalGraphRevision: string;
  finalRecipeHash: string;
  initialGraphRevision: string;
  initialRecipeHash: string;
  previewLineage: Array<{ previewArtifactId: string; sourceToolName: string }>;
  previewRefreshCount: number;
  rollbackReceipt?: { graphRevision: string; toolName: string };
  selectedImage: { height: number; path: string; previewIdentity: string | null; width: number };
  selectedImagePath: string;
  status: string;
  toolName: string;
};
const auditToolNames = result.auditEventSummary.map((entry) => entry.toolName);

if (
  result.toolName !== AGENT_CURRENT_IMAGE_PREVIEW_LOOP_TOOL_NAME ||
  result.selectedImagePath !== selectedPath ||
  result.selectedImage.path !== selectedPath ||
  result.selectedImage.previewIdentity !== initialSnapshot.previewIdentity ||
  result.selectedImage.width !== initialSnapshot.initialPreview.width ||
  result.selectedImage.height !== initialSnapshot.initialPreview.height
) {
  throw new Error('selected-image preview loop result did not preserve command identity and image path.');
}
if (
  result.initialGraphRevision !== 'history_0' ||
  result.finalGraphRevision !== 'history_2' ||
  result.initialRecipeHash !== initialSnapshot.initialPreview.recipeHash ||
  result.finalRecipeHash.length === 0
) {
  throw new Error('selected-image preview loop result did not expose graph/recipe lineage.');
}
if (
  result.acceptedDryRunPlanCount !== 2 ||
  result.editCount !== 2 ||
  result.previewRefreshCount !== 2 ||
  result.applyReceipts.length !== 2 ||
  result.applyReceipts.some((receipt) => receipt.changedPixelCount <= 0 || receipt.changedPixelPercent <= 0)
) {
  throw new Error('selected-image preview loop result did not expose edits, approvals, and changed-pixel metrics.');
}
if (
  result.previewLineage.length !== 2 ||
  result.previewLineage.some((lineage) => lineage.sourceToolName !== 'rawengine.agent.adjustments.apply') ||
  result.compareArtifactIds.beforeArtifactId.length === 0 ||
  result.compareArtifactIds.currentArtifactId.length === 0
) {
  throw new Error('selected-image preview loop did not expose preview/compare artifacts.');
}
if (
  !auditToolNames.includes('rawengine.agent.state.get') ||
  !auditToolNames.includes('rawengine.agent.adjustments.dry_run') ||
  !auditToolNames.includes('rawengine.agent.adjustments.apply') ||
  !auditToolNames.includes('rawengine.agent.preview.render') ||
  !auditToolNames.includes('rawengine.agent.preview.compare') ||
  result.rollbackReceipt?.toolName !== 'rawengine.agent.history.rollback' ||
  result.rollbackReceipt.graphRevision !== 'history_0'
) {
  throw new Error(`selected-image preview loop did not use the typed live tool path: ${auditToolNames.join(',')}`);
}
if (result.status !== 'needs_user_review') {
  throw new Error('selected-image preview loop did not return compact review status.');
}

const state = useEditorStore.getState();
if (state.historyIndex !== 0 || state.adjustments.exposure !== INITIAL_ADJUSTMENTS.exposure) {
  throw new Error('selected-image preview loop did not expose rollback evidence while restoring session state.');
}

console.log('agent selected-image preview loop ok');
