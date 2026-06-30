#!/usr/bin/env bun

import { deriveArtifactInvalidationReasons } from '../../../packages/rawengine-schema/src/derivedArtifactInvalidation.ts';
import {
  applyPanoramaRuntimePlanV1,
  buildPanoramaRuntimeArtifactV1,
  buildPanoramaRuntimeDryRunV1,
} from '../../../packages/rawengine-schema/src/panoramaRuntimePlan.ts';
import { ApprovalClass, RAW_ENGINE_SCHEMA_VERSION } from '../../../packages/rawengine-schema/src/rawEngineSchemas.ts';
import { COMPUTATIONAL_PROOF_MEMORY_BUDGET_BYTES } from '../../../scripts/lib/computational-proof-budgets.ts';

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
    memoryBudgetBytes: COMPUTATIONAL_PROOF_MEMORY_BUDGET_BYTES,
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
  artifactCreatedAt: '2026-06-17T19:25:00.000Z',
  command: applyCommand,
  connectedSourceIndices: [0, 1, 2],
  outputArtifactId: 'artifact_panorama_runtime_output',
  previewArtifactId: 'artifact_panorama_runtime_preview',
  seed: 'rawengine-panorama-runtime-smoke-v1',
  sourceFrames,
});
const derivedArtifact = buildPanoramaRuntimeArtifactV1({
  applyResult: applied,
  command: applyCommand,
  createdAt: '2026-06-17T19:25:00.000Z',
  previewArtifacts: dryRun.dryRunResult.previewArtifacts,
});

assertEqual(dryRun.provenance.projection, 'cylindrical', 'requested projection');
assertEqual(dryRun.provenance.resolvedProjection, 'cylindrical', 'resolved projection');
assertEqual(dryRun.provenance.projectionSettings.support, 'implemented_current_engine', 'projection support');
assertEqual(dryRun.provenance.projectionSettings.requestedProjection, 'cylindrical', 'requested projection setting');
assertEqual(dryRun.provenance.projectionSettings.effectiveProjection, 'cylindrical', 'effective projection setting');
assertEqual(dryRun.provenance.exposureNormalization, 'auto', 'exposure normalization');
assertEqual(dryRun.provenance.lensCorrectionPolicy, 'required_before_stitch', 'lens correction policy');
assertEqual(dryRun.provenance.alignment.algorithmId, 'synthetic_offset_translation_v1', 'alignment algorithm');
assertEqual(dryRun.provenance.alignment.pairwiseMatches.length, 2, 'pairwise match count');
assertEqual(dryRun.provenance.alignment.pairwiseMatches[0]?.translationPx.x, 48, 'first match x');
assertEqual(dryRun.provenance.alignment.pairwiseMatches[0]?.translationPx.y, 2, 'first match y');
assertEqual(dryRun.provenance.crop.mode, 'auto', 'crop mode');
assertEqual(dryRun.provenance.crop.width, dryRun.dryRunResult.mergePlan.outputDimensions.width, 'crop width');
assertEqual(dryRun.provenance.qualityMetrics.cropCoverageRatio, 1, 'crop coverage');
assertEqual(dryRun.provenance.qualityMetrics.outputPixelCount, 158 * 51, 'output pixels');
assertEqual(dryRun.provenance.qualityMetrics.sourcePixelCount, 72 * 48 * 3, 'source pixels');
assertEqual(dryRun.provenance.qualityMetrics.stitchedSourceRatio, 1, 'stitched source ratio');
assertEqual(dryRun.provenance.seamBlend.blendMode, 'feather', 'blend mode');
assertEqual(dryRun.provenance.seamBlend.seamMethod, 'adaptive_feather', 'seam method');
assertEqual(applied.provenance.runtimeStatus, 'apply_rendered', 'apply runtime status');
assertEqual(applied.provenance.acceptedDryRunPlanId, dryRun.dryRunResult.mergePlan.planId, 'accepted plan id');
const [outputArtifact] = applied.mutationResult.outputArtifacts;
if (outputArtifact === undefined) {
  throw new Error('Expected panorama apply to emit a durable output artifact.');
}
assertEqual(outputArtifact.artifactId, 'artifact_panorama_runtime_output', 'output artifact id');
assertEqual(outputArtifact.kind, 'merge_output', 'output artifact kind');
assertEqual(outputArtifact.storage, 'sidecar_artifact', 'output artifact storage');
assertEqual(applied.sidecarArtifact.provenance.runtimeStatus, 'rendered', 'apply sidecar runtime status');
assertEqual(
  applied.sidecarArtifact.provenance.graphRevision,
  applied.mutationResult.appliedGraphRevision,
  'apply sidecar graph revision',
);
assertEqual(applied.sidecarArtifact.outputArtifacts[0]?.artifactId, outputArtifact.artifactId, 'apply sidecar output');
assertEqual(applied.sidecarArtifact.sourceImageRefs.length, sourceFrames.length, 'apply sidecar source refs');
assertEqual(applied.sidecarArtifact.sourceState.length, sourceFrames.length, 'apply sidecar source state');
assertEqual(applied.sidecarArtifact.projection, 'cylindrical', 'apply sidecar effective projection');
assertEqual(
  applied.sidecarArtifact.projectionSettings.requestedProjection,
  'cylindrical',
  'apply sidecar requested projection',
);
assertEqual(applied.sidecarArtifact.boundaryMode, 'auto_crop', 'apply sidecar boundary mode');
assertEqual(applied.sidecarArtifact.createdAt, '2026-06-17T19:25:00.000Z', 'apply sidecar created at');
assertEqual(applied.sidecarArtifact.seamPolicy.mode, 'adaptive_dp_feather_v1', 'apply sidecar seam policy');
assertEqual(applied.sidecarArtifact.staleState.state, 'current', 'apply sidecar stale state');
assertEqual(derivedArtifact.provenance.runtimeStatus, 'rendered', 'derived artifact runtime status');
assertEqual(
  derivedArtifact.provenance.graphRevision,
  applied.mutationResult.appliedGraphRevision,
  'derived graph revision',
);
assertEqual(derivedArtifact.outputArtifacts[0]?.artifactId, outputArtifact.artifactId, 'derived output artifact id');
assertEqual(derivedArtifact.sourceImageRefs.length, sourceFrames.length, 'derived source refs');
assertEqual(derivedArtifact.sourceState.length, sourceFrames.length, 'derived source state');
assertEqual(derivedArtifact.projection, 'cylindrical', 'derived effective projection');
assertEqual(derivedArtifact.projectionSettings.requestedProjection, 'cylindrical', 'derived requested projection');
assertEqual(derivedArtifact.staleState.state, 'current', 'derived stale state');

const currentArtifactState = {
  outputContentHash: outputArtifact.contentHash,
  sourceState: applied.sidecarArtifact.sourceState,
};
const unchangedReasons = deriveArtifactInvalidationReasons(
  { outputArtifact: { contentHash: outputArtifact.contentHash }, sourceState: applied.sidecarArtifact.sourceState },
  currentArtifactState,
);
assertEqual(unchangedReasons.length, 0, 'apply sidecar unchanged invalidation reasons');
const sourceHashReasons = deriveArtifactInvalidationReasons(
  { outputArtifact: { contentHash: outputArtifact.contentHash }, sourceState: applied.sidecarArtifact.sourceState },
  {
    ...currentArtifactState,
    sourceState: applied.sidecarArtifact.sourceState.map((sourceState, index) =>
      index === 0 ? { ...sourceState, contentHash: 'sha256:changed-panorama-source' } : sourceState,
    ),
  },
);
if (!sourceHashReasons.includes('source_content_hash_changed')) {
  throw new Error('Expected panorama apply sidecar to invalidate when source content changes.');
}
const outputArtifactReasons = deriveArtifactInvalidationReasons(
  { outputArtifact: { contentHash: outputArtifact.contentHash }, sourceState: applied.sidecarArtifact.sourceState },
  {
    ...currentArtifactState,
    outputContentHash: 'sha256:changed-panorama-output',
  },
);
if (!outputArtifactReasons.includes('output_artifact_changed')) {
  throw new Error('Expected panorama apply sidecar to invalidate when output artifact changes.');
}

if (applied.outputPixels.length <= sourceFrames[0].width * sourceFrames[0].height * 3) {
  throw new Error('Expected panorama output to be wider than one source frame.');
}

console.log(
  JSON.stringify(
    {
      acceptedDryRunPlanId: applied.provenance.acceptedDryRunPlanId,
      fixture: 'synthetic_panorama_runtime_plan_v1',
      outputArtifactContentHash: outputArtifact.contentHash,
      panoramaArtifactId: derivedArtifact.artifactId,
      output: dryRun.dryRunResult.mergePlan.outputDimensions,
      outputSha256: new Bun.CryptoHasher('sha256').update(applied.outputPixels).digest('hex'),
      provenance: {
        exposureNormalization: applied.provenance.exposureNormalization,
        lensCorrectionPolicy: applied.provenance.lensCorrectionPolicy,
        qualityMetrics: applied.provenance.qualityMetrics,
        seamBlend: applied.provenance.seamBlend,
      },
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
