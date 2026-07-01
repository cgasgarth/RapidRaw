#!/usr/bin/env bun

import { ToolType } from '../../../../src/components/panel/right/layers/Masks.tsx';
import { RawEngineAppServerHostToolName } from '../../../../src/schemas/agent/agentRuntimeSchemas.ts';
import { useEditorStore } from '../../../../src/store/useEditorStore.ts';
import { ActiveChannel, INITIAL_ADJUSTMENTS } from '../../../../src/utils/adjustments.ts';
import { AGENT_CURRENT_IMAGE_PREVIEW_LOOP_TOOL_NAME } from '../../../../src/utils/agent/context/agentCurrentImagePreviewLoop.ts';
import { buildAgentImageContextSnapshot } from '../../../../src/utils/agent/context/agentImageContextSnapshot.ts';
import { AGENT_FINAL_EXPORT_TOOL_NAME } from '../../../../src/utils/agent/safety/agentExportProofTool.ts';
import {
  type AgentSessionAuditStorageAdapter,
  agentSelectedImageExportReceiptSchema,
  appendAgentSelectedImageExportReceipt,
} from '../../../../src/utils/agent/session/agentSessionAuditStore.ts';
import {
  applyAgentGlobalAdjustments,
  dryRunAgentGlobalAdjustments,
} from '../../../../src/utils/agent/tools/agentAdjustmentApplyTool.ts';
import {
  buildRawEngineAppServerRouteCatalog,
  handleRawEngineAppServerHostRequestAsync,
} from '../../../../src/utils/rawEngineAppServerHost.ts';

const selectedPath = '/fixtures/public/agent-selected-image-preview-loop/DSC_3162.ARW';
const bins = Array.from({ length: 256 }, (_, index) => (index === 0 || index === 255 ? 11 : 3));

const seedEditor = () => {
  useEditorStore.getState().setEditor({
    adjustments: INITIAL_ADJUSTMENTS,
    brushSettings: { feather: 50, size: 64, tool: ToolType.Brush },
    finalPreviewUrl: 'blob:rawengine-selected-export-before',
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
      originalUrl: 'blob:rawengine-original-selected-export',
      path: selectedPath,
      thumbnailUrl: 'blob:rawengine-thumb-selected-export',
      width: 6000,
    },
    uncroppedAdjustedPreviewUrl: null,
  });
};

const baseLoopRequest = {
  maxIterations: 4,
  operationId: 'agent_selected_export_loop_3162',
  prompt: 'Brighten the selected image, inspect the preview, then export the reviewed result.',
  requestId: 'agent-selected-export-loop-3162',
  rollbackAfterReview: false,
  sessionId: 'agent-selected-export-loop-3162',
  steps: [
    { exposure: 0.24, highlights: -8 },
    {
      assistantRationale: 'After selected-image preview feedback, lift foreground shadows and inspect detail.',
      exposure: 0.3,
      preview: {
        longEdgePx: 1536,
        purpose: 'detail_review',
        quality: 0.86,
        zoom: { centerX: 0.5, centerY: 0.55, scale: 2.2 },
      },
      shadows: 14,
      userFollowUp: 'The selected preview still needs foreground separation; inspect detail before export.',
    },
  ],
} as const;

const dispatchTool = async (runtimeToolName: string, args: unknown, requestId: string) =>
  handleRawEngineAppServerHostRequestAsync({
    arguments: args,
    requestId,
    runtimeToolName,
    toolName: RawEngineAppServerHostToolName.DispatchTool,
  });

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

const route = buildRawEngineAppServerRouteCatalog().find((entry) => entry.commandName === AGENT_FINAL_EXPORT_TOOL_NAME);
if (route === undefined || !route.runtimeCheckScripts.includes('check:agent-selected-image-export-output')) {
  throw new Error('agent final export route must expose the selected-image export output check.');
}

seedEditor();
const initialSnapshot = buildAgentImageContextSnapshot();
const acceptedApprovals = await buildAcceptedDryRunApprovals();
seedEditor();

const loopRequest = {
  ...baseLoopRequest,
  dryRunApprovals: acceptedApprovals,
  expectedGraphRevision: initialSnapshot.graphRevision,
  expectedPreviewHeight: initialSnapshot.initialPreview.height,
  expectedPreviewIdentity: initialSnapshot.previewIdentity,
  expectedPreviewWidth: initialSnapshot.initialPreview.width,
  expectedRecipeHash: initialSnapshot.initialPreview.recipeHash,
  selectedImagePath: initialSnapshot.activeImagePath,
};

const loopDispatch = await dispatchTool(AGENT_CURRENT_IMAGE_PREVIEW_LOOP_TOOL_NAME, loopRequest, loopRequest.requestId);
if (loopDispatch.dispatchStatus !== 'completed' || loopDispatch.result === undefined) {
  throw new Error(`selected-image loop dispatch failed: ${loopDispatch.message ?? 'missing result'}`);
}

const loopResult = loopDispatch.result as {
  compareArtifactIds: {
    beforeArtifactId: string;
    beforeEvidence?: {
      contentHash: string;
      graphRevision: string;
      previewRef: string;
      recipeHash: string;
      renderHash: string;
    };
    currentArtifactId: string;
    currentEvidence?: {
      contentHash: string;
      graphRevision: string;
      previewRef: string;
      recipeHash: string;
      renderHash: string;
    };
  };
  finalGraphRevision: string;
  finalRecipeHash: string;
  initialGraphRevision: string;
  initialRecipeHash: string;
  reviewStatus: string;
  rollbackCheckpoint: { graphRevision: string };
  rollbackReceipt?: { graphRevision: string };
  selectedImagePath: string;
};

if (loopResult.reviewStatus !== 'needs_user_review') {
  throw new Error('selected-image export must wait for a reviewable loop result.');
}
if (
  loopResult.compareArtifactIds.beforeEvidence === undefined ||
  loopResult.compareArtifactIds.currentEvidence === undefined
) {
  throw new Error('selected-image export requires before/current preview artifact evidence.');
}

const exportSnapshot = buildAgentImageContextSnapshot();
const finalExportRequest = {
  approval: {
    approvalId: 'approval_selected_image_export_3162',
    approvedGraphRevision: exportSnapshot.graphRevision,
    approvedRecipeHash: exportSnapshot.initialPreview.recipeHash,
    approvedSelectedImagePath: exportSnapshot.activeImagePath,
    approvedSessionId: baseLoopRequest.sessionId,
    status: 'approved',
  },
  colorProfile: 'srgb',
  destinationPolicy: 'local_private_artifact',
  dryRun: false,
  expectedRecipeHash: exportSnapshot.initialPreview.recipeHash,
  fileFormat: 'jpeg',
  jpegQuality: 90,
  longEdgePx: 4096,
  operationId: 'agent_selected_image_export_3162',
  renderingIntent: 'relativeColorimetric',
  requestId: 'agent-selected-image-export-3162',
  sessionId: baseLoopRequest.sessionId,
} as const;

const pendingExport = await dispatchTool(
  AGENT_FINAL_EXPORT_TOOL_NAME,
  {
    ...finalExportRequest,
    approval: { ...finalExportRequest.approval, approvalId: 'approval_pending_export_3162', status: 'pending' },
  },
  'agent-selected-image-export-pending',
);
if (pendingExport.dispatchStatus !== 'rejected' || !pendingExport.message?.includes('requires approved')) {
  throw new Error(
    `selected-image final export did not reject pending approval: ${pendingExport.dispatchStatus} ${pendingExport.message ?? ''}`,
  );
}

const finalExportDispatch = await dispatchTool(
  AGENT_FINAL_EXPORT_TOOL_NAME,
  finalExportRequest,
  finalExportRequest.requestId,
);
if (finalExportDispatch.dispatchStatus !== 'completed' || finalExportDispatch.result === undefined) {
  throw new Error(`selected-image final export failed: ${finalExportDispatch.message ?? 'missing result'}`);
}

const finalExport = finalExportDispatch.result as {
  exportHash: string;
  output: { artifactId: string; destinationPolicy: string; height: number; storage: string; width: number };
  receipt: {
    approvalId: string;
    exportSettings: {
      colorProfile: string;
      fileFormat: 'jpeg' | 'png';
      jpegQuality: number;
      longEdgePx: number;
      renderingIntent: string;
    };
    graphRevision: string;
    noOverwritePolicy: 'never_overwrite_original';
    outputHash: string;
    outputPath: string;
    recipeHash: string;
  };
  requestId: string;
  toolName: typeof AGENT_FINAL_EXPORT_TOOL_NAME;
};

if (
  finalExport.toolName !== AGENT_FINAL_EXPORT_TOOL_NAME ||
  finalExport.output.storage !== 'ephemeral_editor_cache' ||
  finalExport.output.destinationPolicy !== 'local_private_artifact' ||
  finalExport.receipt.noOverwritePolicy !== 'never_overwrite_original' ||
  finalExport.receipt.outputHash !== finalExport.exportHash ||
  finalExport.receipt.graphRevision !== loopResult.finalGraphRevision ||
  finalExport.receipt.recipeHash !== loopResult.finalRecipeHash ||
  !finalExport.receipt.outputPath.includes('DSC_3162')
) {
  throw new Error('selected-image final export did not bind output, graph, recipe, and no-overwrite metadata.');
}

let storedText: string | null = null;
const adapter: AgentSessionAuditStorageAdapter = {
  readText: () => storedText,
  writeText: (value) => {
    storedText = value;
  },
};

const receipt = appendAgentSelectedImageExportReceipt(adapter, {
  approvalId: finalExport.receipt.approvalId,
  beforePreviewArtifact: {
    artifactId: loopResult.compareArtifactIds.beforeArtifactId,
    ...loopResult.compareArtifactIds.beforeEvidence,
  },
  currentPreviewArtifact: {
    artifactId: loopResult.compareArtifactIds.currentArtifactId,
    ...loopResult.compareArtifactIds.currentEvidence,
  },
  exportSettings: finalExport.receipt.exportSettings,
  finalGraphRevision: loopResult.finalGraphRevision,
  finalRecipeHash: loopResult.finalRecipeHash,
  initialGraphRevision: loopResult.initialGraphRevision,
  initialRecipeHash: loopResult.initialRecipeHash,
  noOverwritePolicy: finalExport.receipt.noOverwritePolicy,
  outputHash: finalExport.receipt.outputHash,
  outputPath: finalExport.receipt.outputPath,
  prompt: baseLoopRequest.prompt,
  requestId: finalExport.requestId,
  rollback: {
    checkpointGraphRevision: loopResult.rollbackCheckpoint.graphRevision,
    receiptGraphRevision: loopResult.rollbackReceipt?.graphRevision,
    status: loopResult.rollbackReceipt === undefined ? 'available' : 'restored',
  },
  selectedRawPath: loopResult.selectedImagePath,
  sessionId: baseLoopRequest.sessionId,
  toolName: finalExport.toolName,
});

agentSelectedImageExportReceiptSchema.parse(receipt);
if (
  receipt.selectedRawPath !== selectedPath ||
  receipt.beforePreviewArtifact.artifactId.length === 0 ||
  receipt.currentPreviewArtifact.artifactId.length === 0 ||
  receipt.rollback.status !== 'available' ||
  storedText === null ||
  JSON.parse(storedText).length !== 1
) {
  throw new Error('selected-image reviewed export audit receipt was not persisted with required lineage.');
}

console.log('agent selected-image export output ok');
