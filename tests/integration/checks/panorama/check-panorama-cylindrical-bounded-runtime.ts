#!/usr/bin/env bun

import { PanoramaAppServerRuntimeToolBusV1 } from '../../../../packages/rawengine-schema/src/panorama/panoramaAppServerRuntime.ts';
import {
  ApprovalClass,
  RAW_ENGINE_SCHEMA_VERSION,
} from '../../../../packages/rawengine-schema/src/rawEngineSchemas.ts';
import { sampleComputationalMergeAppServerToolManifestV1 } from '../../../../packages/rawengine-schema/src/samplePayloads.ts';
import { COMPUTATIONAL_PROOF_MEMORY_BUDGET_BYTES } from '../../../../scripts/lib/computational/proof-budgets.ts';
import { getComputationalMergeAppServerRoutePairSummary } from '../../../../src/utils/computational-merge/computationalMergeAppServerRoutePairs.ts';

const sourceFrames = [
  { expectedOffsetX: 0, expectedOffsetY: 0, sourceIndex: 0 },
  { expectedOffsetX: 48, expectedOffsetY: 2, sourceIndex: 1 },
  { expectedOffsetX: 96, expectedOffsetY: -1, sourceIndex: 2 },
].map((frame) => ({
  ...frame,
  contentHash: `sha256:panorama-cylindrical-bounded-runtime-${frame.sourceIndex}`,
  graphRevision: 'graph_rev_panorama_cylindrical_bounded_runtime_source',
  height: 48,
  width: 72,
}));

const panoramaRoutePair = getComputationalMergeAppServerRoutePairSummary('panorama');
const bus = new PanoramaAppServerRuntimeToolBusV1(sampleComputationalMergeAppServerToolManifestV1);

const rectilinearDryRun = runDryRun('rectilinear');
const cylindricalDryRun = runDryRun('cylindrical');
if (rectilinearDryRun.kind !== 'dry_run' || cylindricalDryRun.kind !== 'dry_run') {
  throw new Error('Expected bounded panorama projection controls to return dry-run results.');
}

const rectilinearOutput = rectilinearDryRun.dryRun.dryRunResult.mergePlan.outputDimensions;
const cylindricalOutput = cylindricalDryRun.dryRun.dryRunResult.mergePlan.outputDimensions;
const rectilinearHash = hashPixels(rectilinearDryRun.dryRun.outputPixels);
const cylindricalHash = hashPixels(cylindricalDryRun.dryRun.outputPixels);

assertEqual(rectilinearOutput.width, 168, 'rectilinear output width');
assertEqual(rectilinearOutput.height, 51, 'rectilinear output height');
assertEqual(cylindricalOutput.width, 158, 'cylindrical output width');
assertEqual(cylindricalOutput.height, 51, 'cylindrical output height');
if (cylindricalOutput.width >= rectilinearOutput.width) {
  throw new Error(
    `Expected cylindrical bounded projection to contract horizontal bounds: ${JSON.stringify({
      cylindricalOutput,
      rectilinearOutput,
    })}.`,
  );
}
if (cylindricalHash === rectilinearHash) {
  throw new Error('Expected cylindrical bounded projection to render different pixels than rectilinear control.');
}

const projectionSettings = cylindricalDryRun.dryRun.provenance.projectionSettings;
assertEqual(projectionSettings.requestedProjection, 'cylindrical', 'requested projection');
assertEqual(projectionSettings.effectiveProjection, 'cylindrical', 'effective projection');
assertEqual(projectionSettings.support, 'implemented_current_engine', 'projection support');
assertEqual(projectionSettings.horizontalFovDegrees, 86, 'cylindrical horizontal FOV');
assertEqual(cylindricalDryRun.dryRun.provenance.resolvedProjection, 'cylindrical', 'resolved projection');
assertEqual(cylindricalDryRun.dryRun.provenance.projectedBounds.width, cylindricalOutput.width, 'projected width');
assertEqual(cylindricalDryRun.dryRun.provenance.projectedBounds.height, cylindricalOutput.height, 'projected height');
assertEqual(
  cylindricalDryRun.dryRun.dryRunResult.mergePlan.preflight.geometryEstimate.projectedBounds.width,
  cylindricalOutput.width,
  'preflight projected width',
);
assertEqual(
  cylindricalDryRun.dryRun.dryRunResult.mergePlan.preflight.executionMode,
  'tile_backed_render',
  'preflight execution mode',
);
if (cylindricalDryRun.dryRun.dryRunResult.warnings.includes('projection_runtime_deferred')) {
  throw new Error('Cylindrical bounded projection must not surface a deferred-projection warning.');
}
if (cylindricalDryRun.dryRun.dryRunResult.warnings.includes('legacy_full_frame_render')) {
  throw new Error('Cylindrical bounded projection must use the tile-backed runtime path.');
}

const previewArtifact = cylindricalDryRun.dryRun.dryRunResult.previewArtifacts.find(
  (artifact) => artifact.artifactId === 'artifact_panorama_cylindrical_bounded_runtime_preview',
);
if (previewArtifact === undefined || previewArtifact.contentHash === undefined) {
  throw new Error('Expected cylindrical bounded dry-run to emit a hashed preview receipt.');
}
assertEqual(previewArtifact.dimensions.width, cylindricalOutput.width, 'preview artifact width');
assertEqual(previewArtifact.dimensions.height, cylindricalOutput.height, 'preview artifact height');

const applied = bus.execute({
  request: buildRequest(buildCommand('cylindrical', false, cylindricalDryRun.acceptedDryRunPlanHash)),
  toolName: panoramaRoutePair.applyToolName,
});
if (applied.kind !== 'apply') throw new Error('Expected cylindrical bounded panorama apply result.');
assertEqual(applied.apply.provenance.runtimeStatus, 'apply_rendered', 'apply runtime status');
assertEqual(applied.apply.provenance.resolvedProjection, 'cylindrical', 'apply resolved projection');
assertEqual(applied.apply.sidecarArtifact.projection, 'cylindrical', 'sidecar projection');
assertEqual(
  applied.apply.sidecarArtifact.projectionSettings.support,
  'implemented_current_engine',
  'sidecar projection support',
);
assertEqual(
  applied.apply.sidecarArtifact.validationMetrics.outputWidth,
  cylindricalOutput.width,
  'sidecar validation width',
);

console.log(
  JSON.stringify({
    applyOutputSha256: hashPixels(applied.apply.outputPixels),
    fixture: 'synthetic_panorama_cylindrical_bounded_runtime_v1',
    projection: {
      effective: projectionSettings.effectiveProjection,
      horizontalFovDegrees: projectionSettings.horizontalFovDegrees,
      requested: projectionSettings.requestedProjection,
      support: projectionSettings.support,
    },
    receipts: {
      acceptedDryRunPlanHash: cylindricalDryRun.acceptedDryRunPlanHash,
      acceptedDryRunPlanId: cylindricalDryRun.dryRun.dryRunResult.mergePlan.planId,
      previewContentHash: previewArtifact.contentHash,
    },
    renderComparison: {
      cylindricalHash,
      cylindricalOutput,
      rectilinearHash,
      rectilinearOutput,
    },
    tileRender: applied.apply.provenance.tileRender,
  }),
);

function runDryRun(projection: 'rectilinear' | 'cylindrical') {
  return bus.execute({
    request: buildRequest(buildCommand(projection, true)),
    toolName: panoramaRoutePair.dryRunToolName,
  });
}

function buildCommand(projection: 'rectilinear' | 'cylindrical', dryRun: boolean, acceptedDryRunPlanHash?: string) {
  return {
    actor: { id: 'agent_rawengine', kind: 'agent' },
    approval: {
      approvalClass: dryRun ? ApprovalClass.PreviewOnly : ApprovalClass.EditApply,
      reason: 'Panorama bounded cylindrical fixture validates runtime projection output.',
      state: dryRun ? 'not_required' : 'approved',
    },
    commandId: dryRun
      ? `command_panorama_${projection}_bounded_runtime_dry_run`
      : 'command_panorama_cylindrical_bounded_runtime_apply',
    commandType: 'computationalMerge.createPanorama',
    correlationId: dryRun
      ? `corr_panorama_${projection}_bounded_runtime_dry_run`
      : 'corr_panorama_cylindrical_bounded_runtime_apply',
    dryRun,
    expectedGraphRevision: 'graph_rev_panorama_cylindrical_bounded_runtime',
    parameters: {
      ...(acceptedDryRunPlanHash === undefined
        ? {}
        : {
            acceptedDryRunPlanHash,
            acceptedDryRunPlanId: 'panorama_plan_command_panorama_cylindrical_bounded_runtime_dry_run',
          }),
      boundaryMode: 'auto_crop',
      exposureNormalization: 'none',
      lensCorrectionPolicy: 'required_before_stitch',
      maxPreviewDimensionPx: 1200,
      memoryBudgetBytes: COMPUTATIONAL_PROOF_MEMORY_BUDGET_BYTES,
      outputName: 'Synthetic Bounded Cylindrical Panorama',
      projection,
      qualityPreference: 'balanced',
      sources: sourceFrames.map((frame) => ({
        colorSpaceHint: 'camera_rgb',
        exposureEv: 0,
        imageId: `img_panorama_cylindrical_bounded_runtime_${frame.sourceIndex}`,
        imagePath: `/synthetic/panorama/cylindrical-bounded-runtime-${frame.sourceIndex}.dng`,
        rawDefaultsApplied: true,
        role: 'panorama_tile',
        sourceIndex: frame.sourceIndex,
      })),
    },
    schemaVersion: RAW_ENGINE_SCHEMA_VERSION,
    target: { id: 'project_panorama_cylindrical_bounded_runtime', kind: 'project' },
  };
}

function buildRequest(command: ReturnType<typeof buildCommand>) {
  return {
    artifactCreatedAt: '2026-07-02T12:00:00.000Z',
    command,
    connectedSourceIndices: [0, 1, 2],
    outputArtifactId: 'artifact_panorama_cylindrical_bounded_runtime_output',
    previewArtifactId: 'artifact_panorama_cylindrical_bounded_runtime_preview',
    seed: 'rawengine-panorama-cylindrical-bounded-runtime-v1',
    sourceFrames,
  };
}

function hashPixels(pixels: Uint8Array) {
  return new Bun.CryptoHasher('sha256').update(pixels).digest('hex');
}

function assertEqual(actual: unknown, expected: unknown, label: string) {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${String(expected)}, got ${String(actual)}.`);
  }
}
