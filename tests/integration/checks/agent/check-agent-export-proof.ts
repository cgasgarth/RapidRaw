#!/usr/bin/env bun

import { ToolType } from '../../../../src/components/panel/right/layers/Masks.tsx';
import { RawEngineAppServerRouteMode } from '../../../../src/schemas/agent/agentRuntimeSchemas.ts';
import { useEditorStore } from '../../../../src/store/useEditorStore.ts';
import { ActiveChannel, INITIAL_ADJUSTMENTS } from '../../../../src/utils/adjustments.ts';
import { buildAgentImageContextSnapshot } from '../../../../src/utils/agent/context/agentImageContextSnapshot.ts';
import type { AgentApprovalState } from '../../../../src/utils/agent/safety/agentApprovalGate.ts';
import {
  AGENT_EXPORT_PROOF_TOOL_NAME,
  AGENT_FINAL_EXPORT_TOOL_NAME,
  agentExportProofRequestSchema,
  agentFinalExportRequestSchema,
  buildAgentExportProof,
  buildAgentFinalExport,
} from '../../../../src/utils/agent/safety/agentExportProofTool.ts';
import { buildRawEngineAppServerRouteCatalog } from '../../../../src/utils/rawEngineAppServerHost.ts';

const selectedPath = '/Users/cgas/Pictures/Capture One/Alaska/DSC_3163.ARW';
const bins = Array.from({ length: 256 }, (_, index) => (index === 0 || index === 255 ? 14 : 5));

useEditorStore.getState().setEditor({
  adjustments: {
    ...INITIAL_ADJUSTMENTS,
    contrast: 18,
    exposure: 0.35,
    highlights: -20,
    shadows: 22,
  },
  brushSettings: { feather: 42, size: 64, tool: ToolType.Brush },
  finalPreviewUrl: 'blob:rawengine-agent-export-proof-preview',
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
    exif: { ISO: '200', LensModel: 'FE 24-70mm F2.8 GM II' },
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

const snapshot = buildAgentImageContextSnapshot();
const buildApproval = (status: AgentApprovalState['status'], overrides: Partial<AgentApprovalState> = {}) => ({
  approvalId: `approval_export_${status}_3163`,
  approvedGraphRevision: snapshot.graphRevision,
  approvedRecipeHash: snapshot.initialPreview.recipeHash,
  approvedSelectedImagePath: snapshot.activeImagePath,
  approvedSessionId: 'agent-export-proof-3163',
  status,
  ...overrides,
});

if (
  agentExportProofRequestSchema.safeParse({
    approval: buildApproval('approved'),
    dryRun: false,
    expectedRecipeHash: 'recipe:test',
    operationId: 'bad_export',
    requestId: 'bad-export',
    sessionId: 'agent-export-proof-invalid',
  }).success
) {
  throw new Error('agent.export.proof accepted a mutating export request.');
}

let staleRejected = false;
try {
  buildAgentExportProof({
    approval: buildApproval('approved'),
    dryRun: true,
    expectedRecipeHash: 'recipe:stale',
    operationId: 'stale_export',
    requestId: 'stale-export',
    sessionId: 'agent-export-proof-3163',
  });
} catch {
  staleRejected = true;
}
if (!staleRejected) throw new Error('agent.export.proof did not reject stale recipe hash.');

expectRejects(() =>
  buildAgentExportProof({
    approval: buildApproval('pending'),
    dryRun: true,
    expectedRecipeHash: snapshot.initialPreview.recipeHash,
    operationId: 'pending_export',
    requestId: 'pending-export',
    sessionId: 'agent-export-proof-3163',
  }),
);

expectRejects(() =>
  buildAgentExportProof({
    approval: buildApproval('approved', { approvedSessionId: 'agent-export-proof-other' }),
    dryRun: true,
    expectedRecipeHash: snapshot.initialPreview.recipeHash,
    operationId: 'wrong_session_export',
    requestId: 'wrong-session-export',
    sessionId: 'agent-export-proof-3163',
  }),
);

const proof = buildAgentExportProof({
  approval: buildApproval('approved', { approvalId: 'approval_export_accepted_3163' }),
  colorProfile: 'srgb',
  dryRun: true,
  expectedRecipeHash: snapshot.initialPreview.recipeHash,
  fileFormat: 'jpeg',
  jpegQuality: 88,
  longEdgePx: 1536,
  operationId: 'agent_export_proof_3163',
  renderingIntent: 'relativeColorimetric',
  requestId: 'agent-export-proof-3163',
  sessionId: 'agent-export-proof-3163',
});

if (proof.fileWritten !== false || proof.dryRun !== true) {
  throw new Error('agent.export.proof must be dry-run only.');
}
if (proof.receipt.recipeHash !== snapshot.initialPreview.recipeHash) {
  throw new Error('agent.export.proof receipt recipe hash does not match current edit recipe.');
}
if (proof.receipt.previewRenderHash !== snapshot.initialPreview.renderHash) {
  throw new Error('agent.export.proof receipt must bind to the current preview render hash.');
}
if (proof.receipt.approvalId !== 'approval_export_accepted_3163') {
  throw new Error('agent.export.proof receipt must bind to the backend approval id.');
}
if (
  proof.receipt.noOverwritePolicy !== 'never_overwrite_original' ||
  proof.receipt.outputHash !== proof.exportHash ||
  !proof.receipt.outputPath.includes('DSC_3163') ||
  proof.receipt.exportSettings.longEdgePx !== 1536
) {
  throw new Error('agent.export.proof receipt did not bind no-overwrite output metadata and export settings.');
}
if (proof.output.width !== 1536 || proof.output.height !== 1024 || proof.output.mediaType !== 'image/jpeg') {
  throw new Error('agent.export.proof did not return bounded JPEG output metadata.');
}
if (!proof.output.previewRef.includes(snapshot.initialPreview.renderHash)) {
  throw new Error('agent.export.proof output preview ref must include current preview identity.');
}

const pngProof = buildAgentExportProof({
  approval: buildApproval('approved', { approvalId: 'approval_export_png_3163' }),
  colorProfile: 'displayP3',
  dryRun: true,
  expectedRecipeHash: snapshot.initialPreview.recipeHash,
  fileFormat: 'png',
  longEdgePx: 1024,
  operationId: 'agent_export_png_proof_3163',
  requestId: 'agent-export-png-proof-3163',
  sessionId: 'agent-export-proof-3163',
});
if (pngProof.output.mediaType !== 'image/png' || pngProof.output.width !== 1024 || pngProof.output.height !== 683) {
  throw new Error('agent.export.proof did not return bounded PNG output metadata.');
}
if (pngProof.exportHash === proof.exportHash) {
  throw new Error('agent.export.proof export hash must change when output transform changes.');
}

if (
  agentFinalExportRequestSchema.safeParse({
    approval: buildApproval('approved'),
    destinationPolicy: 'local_private_artifact',
    dryRun: true,
    expectedRecipeHash: snapshot.initialPreview.recipeHash,
    operationId: 'bad_final_export',
    requestId: 'bad-final-export',
    sessionId: 'agent-export-proof-3163',
  }).success
) {
  throw new Error('agent.export.final accepted a dry-run request.');
}
expectRejects(() =>
  buildAgentFinalExport({
    approval: buildApproval('pending'),
    destinationPolicy: 'local_private_artifact',
    dryRun: false,
    expectedRecipeHash: snapshot.initialPreview.recipeHash,
    operationId: 'pending_final_export',
    requestId: 'pending-final-export',
    sessionId: 'agent-export-proof-3163',
  }),
);

const finalExport = buildAgentFinalExport({
  approval: buildApproval('approved', { approvalId: 'approval_export_final_3163' }),
  colorProfile: 'displayP3',
  destinationPolicy: 'local_private_artifact',
  dryRun: false,
  expectedRecipeHash: snapshot.initialPreview.recipeHash,
  fileFormat: 'png',
  longEdgePx: 2048,
  operationId: 'agent_final_export_3163',
  requestId: 'agent-final-export-3163',
  sessionId: 'agent-export-proof-3163',
});
if (
  finalExport.dryRun ||
  !finalExport.fileWritten ||
  finalExport.toolName !== AGENT_FINAL_EXPORT_TOOL_NAME ||
  finalExport.output.storage !== 'ephemeral_editor_cache' ||
  finalExport.output.destinationPolicy !== 'local_private_artifact' ||
  finalExport.output.artifactId.length === 0
) {
  throw new Error('agent.export.final did not return bounded final artifact metadata.');
}
if (
  finalExport.receipt.approvalId !== 'approval_export_final_3163' ||
  finalExport.receipt.recipeHash !== snapshot.initialPreview.recipeHash ||
  finalExport.receipt.outputHash !== finalExport.exportHash ||
  finalExport.receipt.noOverwritePolicy !== 'never_overwrite_original' ||
  !finalExport.receipt.outputPath.endsWith('.png') ||
  finalExport.receipt.exportSettings.fileFormat !== 'png' ||
  finalExport.output.width !== 2048 ||
  finalExport.output.height !== 1365
) {
  throw new Error('agent.export.final did not bind approval, recipe, and output transform metadata.');
}

const route = buildRawEngineAppServerRouteCatalog().find(
  (candidate) => candidate.commandName === AGENT_EXPORT_PROOF_TOOL_NAME,
);
if (
  route === undefined ||
  route.family !== 'agent' ||
  !route.modes.includes(RawEngineAppServerRouteMode.Read) ||
  !route.runtimeCheckScripts.includes('check:agent-export-proof')
) {
  throw new Error('agent.export.proof is missing from the agent route catalog.');
}
const finalRoute = buildRawEngineAppServerRouteCatalog().find(
  (candidate) => candidate.commandName === AGENT_FINAL_EXPORT_TOOL_NAME,
);
if (
  finalRoute === undefined ||
  finalRoute.family !== 'agent' ||
  !finalRoute.modes.includes(RawEngineAppServerRouteMode.ApplyDryRunPlan) ||
  !finalRoute.runtimeCheckScripts.includes('check:agent-export-proof')
) {
  throw new Error('agent.export.final is missing from the mutating agent route catalog.');
}

console.log('agent export proof ok');

function expectRejects(action: () => unknown) {
  try {
    action();
  } catch {
    return;
  }
  throw new Error('Expected agent export proof rejection.');
}
