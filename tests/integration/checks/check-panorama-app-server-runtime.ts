#!/usr/bin/env bun

import { PanoramaAppServerRuntimeToolBusV1 } from '../../../packages/rawengine-schema/src/panoramaAppServerRuntime.ts';
import { ApprovalClass, RAW_ENGINE_SCHEMA_VERSION } from '../../../packages/rawengine-schema/src/rawEngineSchemas.ts';
import { sampleComputationalMergeAppServerToolManifestV1 } from '../../../packages/rawengine-schema/src/samplePayloads.ts';
import { getComputationalMergeAppServerRoutePairSummary } from '../../../src/utils/computationalMergeAppServerRoutePairs.ts';
import { COMPUTATIONAL_PROOF_MEMORY_BUDGET_BYTES } from '../../../scripts/lib/computational-proof-budgets.ts';

const panoramaRoutePair = getComputationalMergeAppServerRoutePairSummary('panorama');
const sourceFrames = [
  { expectedOffsetX: 0, expectedOffsetY: 0, sourceIndex: 0 },
  { expectedOffsetX: 48, expectedOffsetY: 2, sourceIndex: 1 },
  { expectedOffsetX: 96, expectedOffsetY: -1, sourceIndex: 2 },
].map((frame) => ({
  ...frame,
  contentHash: `sha256:panorama-app-server-runtime-${frame.sourceIndex}`,
  graphRevision: 'graph_rev_panorama_app_server_runtime_source',
  height: 48,
  width: 72,
}));

const dryRunCommand = {
  actor: { id: 'agent_rawengine', kind: 'agent' },
  approval: {
    approvalClass: ApprovalClass.PreviewOnly,
    reason: 'Panorama app-server runtime smoke validates dry-run dispatch.',
    state: 'not_required',
  },
  commandId: 'command_panorama_app_server_runtime',
  commandType: 'computationalMerge.createPanorama',
  correlationId: 'corr_panorama_app_server_runtime',
  dryRun: true,
  expectedGraphRevision: 'graph_rev_panorama_app_server_runtime',
  parameters: {
    boundaryMode: 'auto_crop',
    exposureNormalization: 'auto',
    lensCorrectionPolicy: 'required_before_stitch',
    maxPreviewDimensionPx: 1200,
    memoryBudgetBytes: COMPUTATIONAL_PROOF_MEMORY_BUDGET_BYTES,
    outputName: 'Synthetic App Server Runtime Panorama',
    projection: 'rectilinear',
    qualityPreference: 'balanced',
    sources: sourceFrames.map((frame) => ({
      colorSpaceHint: 'camera_rgb',
      exposureEv: 0,
      imageId: `img_panorama_app_server_runtime_${frame.sourceIndex}`,
      imagePath: `/synthetic/panorama/app-server-runtime-${frame.sourceIndex}.dng`,
      rawDefaultsApplied: true,
      role: 'panorama_tile',
      sourceIndex: frame.sourceIndex,
    })),
  },
  schemaVersion: RAW_ENGINE_SCHEMA_VERSION,
  target: { id: 'project_panorama_app_server_runtime', kind: 'project' },
};

const bus = new PanoramaAppServerRuntimeToolBusV1(sampleComputationalMergeAppServerToolManifestV1);
const dryRun = bus.execute({
  request: buildRequest(dryRunCommand),
  toolName: panoramaRoutePair.dryRunToolName,
});
if (dryRun.kind !== 'dry_run') throw new Error('Expected panorama dry-run dispatch result.');

const applyCommand = {
  ...dryRunCommand,
  approval: {
    approvalClass: ApprovalClass.EditApply,
    reason: 'Panorama app-server runtime smoke applies accepted plan.',
    state: 'approved',
  },
  commandId: 'command_panorama_app_server_runtime_apply',
  correlationId: 'corr_panorama_app_server_runtime_apply',
  dryRun: false,
  parameters: {
    ...dryRunCommand.parameters,
    acceptedDryRunPlanHash: dryRun.acceptedDryRunPlanHash,
    acceptedDryRunPlanId: dryRun.dryRun.dryRunResult.mergePlan.planId,
  },
};
const applied = bus.execute({
  request: buildRequest(applyCommand),
  toolName: panoramaRoutePair.applyToolName,
});
if (applied.kind !== 'apply') throw new Error('Expected panorama apply dispatch result.');
if (applied.apply.outputPixels.length <= sourceFrames[0].width * sourceFrames[0].height * 3) {
  throw new Error('Expected panorama runtime output to be wider than one source frame.');
}
if (applied.apply.provenance.projectionSettings.effectiveProjection !== 'rectilinear') {
  throw new Error('Expected panorama runtime to report rectilinear effective projection.');
}
if (applied.apply.provenance.boundaryMode !== 'auto_crop') {
  throw new Error('Expected panorama runtime to preserve auto-crop boundary mode.');
}
if (applied.apply.sidecarArtifact.sourceImageRefs.length !== sourceFrames.length) {
  throw new Error('Expected panorama app-server apply to return editable sidecar source refs.');
}
if (applied.apply.sidecarArtifact.outputArtifacts[0]?.artifactId !== 'artifact_panorama_app_server_runtime_output') {
  throw new Error('Expected panorama app-server apply to return sidecar output artifact.');
}
if (applied.apply.sidecarArtifact.createdAt !== '2026-06-17T19:30:00.000Z') {
  throw new Error('Expected panorama app-server apply to preserve sidecar artifact timestamp.');
}

expectThrows('unaccepted panorama apply plan', () =>
  new PanoramaAppServerRuntimeToolBusV1(sampleComputationalMergeAppServerToolManifestV1).execute({
    request: buildRequest(applyCommand),
    toolName: panoramaRoutePair.applyToolName,
  }),
);

console.log(
  JSON.stringify({
    fixture: 'synthetic_panorama_app_server_runtime_v1',
    editableArtifactId: applied.apply.sidecarArtifact.artifactId,
    output: dryRun.dryRun.dryRunResult.mergePlan.outputDimensions,
    outputSha256: new Bun.CryptoHasher('sha256').update(applied.apply.outputPixels).digest('hex'),
    planId: dryRun.dryRun.dryRunResult.mergePlan.planId,
  }),
);

function buildRequest(command) {
  return {
    artifactCreatedAt: '2026-06-17T19:30:00.000Z',
    command,
    connectedSourceIndices: [0, 1, 2],
    outputArtifactId: 'artifact_panorama_app_server_runtime_output',
    previewArtifactId: 'artifact_panorama_app_server_runtime_preview',
    seed: 'rawengine-panorama-app-server-runtime-v1',
    sourceFrames,
  };
}

function expectThrows(label, callback) {
  try {
    callback();
  } catch {
    return;
  }
  throw new Error(`Expected ${label} to throw.`);
}
