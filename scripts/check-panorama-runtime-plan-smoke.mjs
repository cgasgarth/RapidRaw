#!/usr/bin/env bun

import {
  applyPanoramaRuntimePlanV1,
  buildPanoramaRuntimeDryRunV1,
} from '../packages/rawengine-schema/src/panoramaRuntimePlan.ts';
import { ApprovalClass, RAW_ENGINE_SCHEMA_VERSION } from '../packages/rawengine-schema/src/rawEngineSchemas.ts';

const sourceFrames = [
  {
    contentHash: 'sha256:panorama-runtime-source-0',
    expectedOffsetX: 0,
    expectedOffsetY: 0,
    graphRevision: 'graph_rev_panorama_runtime_source',
    height: 48,
    sourceIndex: 0,
    width: 72,
  },
  {
    contentHash: 'sha256:panorama-runtime-source-1',
    expectedOffsetX: 48,
    expectedOffsetY: 2,
    graphRevision: 'graph_rev_panorama_runtime_source',
    height: 48,
    sourceIndex: 1,
    width: 72,
  },
  {
    contentHash: 'sha256:panorama-runtime-source-2',
    expectedOffsetX: 96,
    expectedOffsetY: -1,
    graphRevision: 'graph_rev_panorama_runtime_source',
    height: 48,
    sourceIndex: 2,
    width: 72,
  },
];

const dryRunCommand = {
  actor: { id: 'agent_rawengine', kind: 'agent' },
  approval: {
    approvalClass: ApprovalClass.PreviewOnly,
    reason: 'Panorama runtime smoke validates non-mutating dry-run rendering.',
    state: 'not_required',
  },
  commandId: 'command_panorama_runtime_plan_smoke',
  commandType: 'computationalMerge.createPanorama',
  correlationId: 'corr_panorama_runtime_plan_smoke',
  dryRun: true,
  expectedGraphRevision: 'graph_rev_panorama_runtime',
  parameters: {
    boundaryMode: 'auto_crop',
    exposureNormalization: 'auto',
    lensCorrectionPolicy: 'required_before_stitch',
    maxPreviewDimensionPx: 1200,
    memoryBudgetBytes: 64_000_000,
    outputName: 'Synthetic Runtime Panorama',
    projection: 'cylindrical',
    qualityPreference: 'balanced',
    sources: sourceFrames.map((frame) => ({
      colorSpaceHint: 'camera_rgb',
      exposureEv: 0,
      imageId: `img_panorama_runtime_${frame.sourceIndex}`,
      imagePath: `/synthetic/panorama/runtime-${frame.sourceIndex}.dng`,
      rawDefaultsApplied: true,
      role: 'panorama_tile',
      sourceIndex: frame.sourceIndex,
    })),
  },
  schemaVersion: RAW_ENGINE_SCHEMA_VERSION,
  target: { id: 'project_panorama_runtime', kind: 'project' },
};

const dryRun = buildPanoramaRuntimeDryRunV1({
  command: dryRunCommand,
  connectedSourceIndices: [0, 1, 2],
  outputArtifactId: 'artifact_panorama_runtime_output',
  previewArtifactId: 'artifact_panorama_runtime_preview',
  seed: 'rawengine-panorama-runtime-smoke-v1',
  sourceFrames,
});

const applyCommand = {
  ...dryRunCommand,
  approval: {
    approvalClass: ApprovalClass.EditApply,
    reason: 'Panorama runtime smoke applies accepted dry-run plan.',
    state: 'approved',
  },
  commandId: 'command_panorama_runtime_apply_smoke',
  correlationId: 'corr_panorama_runtime_apply_smoke',
  dryRun: false,
  parameters: {
    ...dryRunCommand.parameters,
    acceptedDryRunPlanHash: `sha256:${dryRun.dryRunResult.mergePlan.planId}`,
    acceptedDryRunPlanId: dryRun.dryRunResult.mergePlan.planId,
  },
};

const applied = applyPanoramaRuntimePlanV1({
  command: applyCommand,
  connectedSourceIndices: [0, 1, 2],
  outputArtifactId: 'artifact_panorama_runtime_output',
  previewArtifactId: 'artifact_panorama_runtime_preview',
  seed: 'rawengine-panorama-runtime-smoke-v1',
  sourceFrames,
});

assertEqual(dryRun.provenance.projection, 'cylindrical', 'requested projection');
assertEqual(dryRun.provenance.resolvedProjection, 'rectilinear', 'resolved projection');
assertEqual(applied.provenance.runtimeStatus, 'apply_rendered', 'apply runtime status');
assertEqual(applied.provenance.acceptedDryRunPlanId, dryRun.dryRunResult.mergePlan.planId, 'accepted plan id');

if (applied.outputPixels.length <= sourceFrames[0].width * sourceFrames[0].height * 3) {
  throw new Error('Expected panorama output to be wider than one source frame.');
}

console.log(
  JSON.stringify(
    {
      acceptedDryRunPlanId: applied.provenance.acceptedDryRunPlanId,
      fixture: 'synthetic_panorama_runtime_plan_v1',
      output: dryRun.dryRunResult.mergePlan.outputDimensions,
      outputSha256: new Bun.CryptoHasher('sha256').update(applied.outputPixels).digest('hex'),
      warnings: dryRun.dryRunResult.warnings,
    },
    null,
    2,
  ),
);

function assertEqual(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${expected}, got ${actual}.`);
  }
}
