#!/usr/bin/env bun

import { ToolType } from '../../../src/components/panel/right/Masks.tsx';
import { RawEngineAppServerRouteMode } from '../../../src/schemas/agentRuntimeSchemas.ts';
import { useEditorStore } from '../../../src/store/useEditorStore.ts';
import { ActiveChannel, INITIAL_ADJUSTMENTS } from '../../../src/utils/adjustments.ts';
import { buildAgentImageContextSnapshot } from '../../../src/utils/agentImageContextSnapshot.ts';
import {
  AGENT_EXPORT_PROOF_TOOL_NAME,
  agentExportProofRequestSchema,
  buildAgentExportProof,
} from '../../../src/utils/agentExportProofTool.ts';
import { buildRawEngineAppServerRouteCatalog } from '../../../src/utils/rawEngineAppServerHost.ts';

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

if (
  agentExportProofRequestSchema.safeParse({
    dryRun: false,
    expectedRecipeHash: 'recipe:test',
    operationId: 'bad_export',
    requestId: 'bad-export',
    sessionId: 'agent-export-proof-invalid',
  }).success
) {
  throw new Error('agent.export.proof accepted a mutating export request.');
}

const snapshot = buildAgentImageContextSnapshot();
let staleRejected = false;
try {
  buildAgentExportProof({
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

const proof = buildAgentExportProof({
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
if (proof.output.width !== 1536 || proof.output.height !== 1024 || proof.output.mediaType !== 'image/jpeg') {
  throw new Error('agent.export.proof did not return bounded JPEG output metadata.');
}
if (!proof.output.previewRef.includes(snapshot.initialPreview.renderHash)) {
  throw new Error('agent.export.proof output preview ref must include current preview identity.');
}

const pngProof = buildAgentExportProof({
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

console.log('agent export proof ok');
