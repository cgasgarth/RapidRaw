#!/usr/bin/env bun

import {
  buildPanoramaRuntimeDryRunV1,
  type PanoramaRuntimeDryRunV1,
} from '../../../../packages/rawengine-schema/src/panorama/panoramaRuntimePlan.ts';
import {
  ApprovalClass,
  RAW_ENGINE_SCHEMA_VERSION,
} from '../../../../packages/rawengine-schema/src/rawEngineSchemas.ts';
import { COMPUTATIONAL_PROOF_MEMORY_BUDGET_BYTES } from '../../../../scripts/lib/computational/proof-budgets.ts';

const failures: string[] = [];

const singleRowFrames = [
  { expectedOffsetX: 0, expectedOffsetY: 0, sourceIndex: 0 },
  { expectedOffsetX: 48, expectedOffsetY: 2, sourceIndex: 1 },
  { expectedOffsetX: 96, expectedOffsetY: -1, sourceIndex: 2 },
].map((frame) => buildSourceFrame(frame.sourceIndex, frame.expectedOffsetX, frame.expectedOffsetY, 72, 48));

const gridLikeFrames = [
  { expectedOffsetX: 0, expectedOffsetY: 0, sourceIndex: 0 },
  { expectedOffsetX: 48, expectedOffsetY: 0, sourceIndex: 1 },
  { expectedOffsetX: 0, expectedOffsetY: 40, sourceIndex: 2 },
  { expectedOffsetX: 48, expectedOffsetY: 40, sourceIndex: 3 },
].map((frame) => buildSourceFrame(frame.sourceIndex, frame.expectedOffsetX, frame.expectedOffsetY, 72, 48));

const multiRowFrames = [
  { expectedOffsetX: 0, expectedOffsetY: 0, sourceIndex: 0 },
  { expectedOffsetX: 0, expectedOffsetY: 2, sourceIndex: 1 },
  { expectedOffsetX: 0, expectedOffsetY: 40, sourceIndex: 2 },
  { expectedOffsetX: 0, expectedOffsetY: 42, sourceIndex: 3 },
].map((frame) => buildSourceFrame(frame.sourceIndex, frame.expectedOffsetX, frame.expectedOffsetY, 72, 48));

assertSingleRowSummary(
  'single-row-supported',
  buildPanoramaRuntimeDryRunV1({
    command: buildCommand('command_panorama_multi_row_dry_run_single_row', singleRowFrames.length),
    connectedSourceIndices: [0, 1, 2],
    outputArtifactId: 'artifact_panorama_multi_row_single_row_output',
    previewArtifactId: 'artifact_panorama_multi_row_single_row_preview',
    seed: 'rawengine-panorama-multi-row-dry-run-single-row-v1',
    sourceFrames: singleRowFrames,
  }),
);

assertDisconnectedSummary(
  'disconnected-overclaim-guardrail',
  buildPanoramaRuntimeDryRunV1({
    command: buildCommand('command_panorama_multi_row_dry_run_disconnected', singleRowFrames.length),
    connectedSourceIndices: [0, 1],
    outputArtifactId: 'artifact_panorama_multi_row_disconnected_output',
    previewArtifactId: 'artifact_panorama_multi_row_disconnected_preview',
    seed: 'rawengine-panorama-multi-row-dry-run-disconnected-v1',
    sourceFrames: singleRowFrames,
  }),
);

assertGridLikeSummary(
  'grid-like-guardrail',
  buildPanoramaRuntimeDryRunV1({
    command: buildCommand('command_panorama_multi_row_dry_run_grid_like', gridLikeFrames.length),
    connectedSourceIndices: [0, 1, 2, 3],
    outputArtifactId: 'artifact_panorama_multi_row_grid_like_output',
    previewArtifactId: 'artifact_panorama_multi_row_grid_like_preview',
    seed: 'rawengine-panorama-multi-row-dry-run-grid-like-v1',
    sourceFrames: gridLikeFrames,
  }),
);

assertMultiRowSummary(
  'multi-row-blocked',
  buildPanoramaRuntimeDryRunV1({
    command: buildCommand('command_panorama_multi_row_dry_run_multi_row', multiRowFrames.length),
    connectedSourceIndices: [0, 1, 2, 3],
    outputArtifactId: 'artifact_panorama_multi_row_multi_row_output',
    previewArtifactId: 'artifact_panorama_multi_row_multi_row_preview',
    seed: 'rawengine-panorama-multi-row-dry-run-multi-row-v1',
    sourceFrames: multiRowFrames,
  }),
);

if (failures.length > 0) {
  console.error(`panorama multi-row dry-run diagnostics failed (${failures.length})`);
  for (const failure of failures.slice(0, 10)) console.error(`- ${failure}`);
  process.exit(1);
}

console.log('panorama multi-row dry-run diagnostics ok (4 scenarios)');

function buildCommand(commandId: string, sourceCount: number) {
  return {
    actor: { id: 'agent_rawengine', kind: 'agent' },
    approval: {
      approvalClass: ApprovalClass.PreviewOnly,
      reason: 'Panorama dry-run diagnostics validate source geometry guardrails.',
      state: 'not_required',
    },
    commandId,
    commandType: 'computationalMerge.createPanorama',
    correlationId: `${commandId}-corr`,
    dryRun: true,
    expectedGraphRevision: `${commandId}-graph-revision`,
    parameters: {
      boundaryMode: 'auto_crop',
      exposureNormalization: 'auto',
      lensCorrectionPolicy: 'required_before_stitch',
      maxPreviewDimensionPx: 1200,
      memoryBudgetBytes: COMPUTATIONAL_PROOF_MEMORY_BUDGET_BYTES,
      outputName: 'Panorama multi-row dry-run diagnostics',
      projection: 'rectilinear',
      qualityPreference: 'balanced',
      sources: Array.from({ length: sourceCount }, (_, sourceIndex) => ({
        colorSpaceHint: 'camera_rgb',
        exposureEv: 0,
        imageId: `${commandId}-image-${sourceIndex}`,
        imagePath: `/synthetic/panorama/${commandId}-${sourceIndex}.dng`,
        rawDefaultsApplied: true,
        role: 'panorama_tile',
        sourceIndex,
      })),
    },
    schemaVersion: RAW_ENGINE_SCHEMA_VERSION,
    target: { id: `${commandId}-project`, kind: 'project' },
  } as const;
}

function buildSourceFrame(
  sourceIndex: number,
  expectedOffsetX: number,
  expectedOffsetY: number,
  width: number,
  height: number,
) {
  return {
    contentHash: `sha256:panorama-multi-row-${sourceIndex}`,
    expectedOffsetX,
    expectedOffsetY,
    graphRevision: 'graph_rev_panorama_multi_row_source',
    height,
    sourceIndex,
    width,
  } as const;
}

function assertSingleRowSummary(label: string, dryRun: PanoramaRuntimeDryRunV1) {
  const sourceGeometry = dryRun.provenance.sourceGeometry;
  assertEqual(sourceGeometry.layout, 'single_row', `${label}: layout`);
  assertEqual(sourceGeometry.support, 'implemented_current_engine', `${label}: support`);
  assertEqual(sourceGeometry.graphConnectivity.isConnected, true, `${label}: connectivity`);
  assertEqual(sourceGeometry.selectedComponent.sourceCount, 3, `${label}: selected source count`);
  assertEqual(sourceGeometry.selectedComponent.sourceIndices.join(','), '0,1,2', `${label}: selected indices`);
  assertEqual(sourceGeometry.warningCodes.length, 0, `${label}: warning codes`);
  assertEqual(dryRun.dryRunResult.mergePlan.preflight.status, 'accepted', `${label}: preflight status`);
}

function assertDisconnectedSummary(label: string, dryRun: PanoramaRuntimeDryRunV1) {
  const sourceGeometry = dryRun.provenance.sourceGeometry;
  assertEqual(sourceGeometry.graphConnectivity.isConnected, false, `${label}: connectivity`);
  assertEqual(sourceGeometry.graphConnectivity.connectedSourceCount, 2, `${label}: connected source count`);
  assertEqual(sourceGeometry.graphConnectivity.disconnectedSourceCount, 1, `${label}: disconnected source count`);
  assertEqual(sourceGeometry.selectedComponent.sourceIndices.join(','), '0,1', `${label}: selected indices`);
  assertIncludes(sourceGeometry.warningCodes, 'graph_disconnected', `${label}: graph disconnected warning`);
  assertIncludes(sourceGeometry.warningCodes, 'geometry_overclaim_guardrail', `${label}: guardrail warning`);
  assertEqual(sourceGeometry.support, 'unverified', `${label}: support`);
  assertEqual(dryRun.dryRunResult.mergePlan.preflight.status, 'warning', `${label}: preflight status`);
}

function assertGridLikeSummary(label: string, dryRun: PanoramaRuntimeDryRunV1) {
  const sourceGeometry = dryRun.provenance.sourceGeometry;
  assertEqual(sourceGeometry.layout, 'grid_like', `${label}: layout`);
  assertEqual(sourceGeometry.support, 'unverified', `${label}: support`);
  assertEqual(sourceGeometry.graphConnectivity.isConnected, true, `${label}: connectivity`);
  assertEqual(sourceGeometry.selectedComponent.sourceCount, 4, `${label}: selected source count`);
  assertIncludes(sourceGeometry.warningCodes, 'grid_like_geometry_unverified', `${label}: grid warning`);
  assertIncludes(sourceGeometry.warningCodes, 'geometry_overclaim_guardrail', `${label}: guardrail warning`);
  assertEqual(dryRun.dryRunResult.mergePlan.preflight.status, 'warning', `${label}: preflight status`);
}

function assertMultiRowSummary(label: string, dryRun: PanoramaRuntimeDryRunV1) {
  const sourceGeometry = dryRun.provenance.sourceGeometry;
  assertEqual(sourceGeometry.layout, 'multi_row_candidate', `${label}: layout`);
  assertEqual(sourceGeometry.support, 'blocked_requires_multi_row_solver', `${label}: support`);
  assertEqual(sourceGeometry.graphConnectivity.isConnected, true, `${label}: connectivity`);
  assertEqual(sourceGeometry.selectedComponent.sourceCount, 4, `${label}: selected source count`);
  assertIncludes(sourceGeometry.warningCodes, 'multi_row_runtime_deferred', `${label}: multi-row warning`);
  assertIncludes(sourceGeometry.warningCodes, 'geometry_overclaim_guardrail', `${label}: guardrail warning`);
  assertIncludes(
    dryRun.dryRunResult.mergePlan.preflight.blockedReasons,
    'multi_row_panorama_not_supported',
    `${label}: blocked reason`,
  );
  assertEqual(dryRun.dryRunResult.mergePlan.preflight.status, 'blocked_plan_only', `${label}: preflight status`);
}

function assertEqual<T>(actual: T, expected: T, label: string) {
  if (actual !== expected) failures.push(`${label}: expected ${expected}, got ${actual}`);
}

function assertIncludes(values: string[], expected: string, label: string) {
  if (!values.includes(expected)) failures.push(`${label}: expected ${expected} in [${values.join(', ')}]`);
}
