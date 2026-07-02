#!/usr/bin/env bun

import { z } from 'zod';

import { PanoramaAppServerRuntimeToolBusV1 } from '../../../../packages/rawengine-schema/src/panorama/panoramaAppServerRuntime.ts';
import {
  ApprovalClass,
  RAW_ENGINE_SCHEMA_VERSION,
} from '../../../../packages/rawengine-schema/src/rawEngineSchemas.ts';
import { sampleComputationalMergeAppServerToolManifestV1 } from '../../../../packages/rawengine-schema/src/samplePayloads.ts';
import { COMPUTATIONAL_PROOF_MEMORY_BUDGET_BYTES } from '../../../../scripts/lib/computational/proof-budgets.ts';
import { getComputationalMergeAppServerRoutePairSummary } from '../../../../src/utils/computational-merge/computationalMergeAppServerRoutePairs.ts';

const panoramaRoutePair = getComputationalMergeAppServerRoutePairSummary('panorama');
const panoramaSeamReviewTranscriptSchema = z
  .object({
    blockedReasons: z.array(z.string().trim().min(1)),
    contributionMapArtifactId: z.string().trim().min(1),
    disconnectedSourceIndices: z.array(z.number().int().nonnegative()),
    mutates: z.literal(false),
    overlapConfidenceLevel: z.enum(['high', 'medium', 'low', 'blocked']),
    overlapConfidencePercent: z.number().int().min(0).max(100),
    overlapMinimumRatio: z.number().min(0).max(1),
    parallaxRisk: z.enum(['low', 'medium', 'high']),
    reviewStatus: z.enum(['apply_ready', 'blocked', 'review_required']),
    scenario: z.enum([
      'blocked_apply',
      'grid_like_warning',
      'multi_row_blocked',
      'multi_row_blocked_apply',
      'source_mismatch_blocked',
      'supported',
      'weak_overlap_warning',
    ]),
    seamMaskArtifactId: z.string().trim().min(1),
    seamRisk: z.enum(['low', 'medium', 'high']),
    seamWarningState: z.enum(['clear', 'warning', 'blocked']),
    sourceGeometryColumnCountEstimate: z.number().int().positive(),
    sourceGeometryConnectedComponentCount: z.number().int().positive(),
    sourceGeometryGraphConnected: z.boolean(),
    sourceGeometryHorizontalSpanPx: z.number().int().nonnegative(),
    sourceGeometryLayout: z.enum(['grid_like', 'multi_row_candidate', 'single_row', 'unknown']),
    sourceGeometryLayoutConfidence: z.object({
      columnConfidence: z.number().min(0).max(1),
      overallConfidence: z.number().min(0).max(1),
      rowConfidence: z.number().min(0).max(1),
    }),
    sourceGeometrySupport: z.enum(['blocked_requires_multi_row_solver', 'implemented_current_engine', 'unverified']),
    sourceGeometrySelectedComponentCount: z.number().int().positive(),
    sourceGeometrySelectedComponentIndices: z.array(z.number().int().nonnegative()),
    sourceRowCountEstimate: z.number().int().positive(),
    sourceGeometryWarningCodes: z.array(z.string().trim().min(1)),
    warnings: z.array(z.string().trim().min(1)),
    weakOverlapEdgeCount: z.number().int().nonnegative(),
  })
  .strict();
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
    backendPreference: 'opencv_stitching_spike',
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
      exposureEv: frame.sourceIndex === 1 ? 0.4 : frame.sourceIndex === 2 ? -0.25 : 0,
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
assertBackendSelectionReceipt(dryRun.dryRun.provenance.backendSelection, {
  fallbackReason: 'requested_backend_unavailable',
  requestedBackendId: 'opencv_stitching_spike',
  selectedBackendId: 'rapidraw_homography_seam_v0',
  selectionStatus: 'fallback',
});
const supportedTranscript = buildSeamReviewTranscript('supported', dryRun);
if (
  supportedTranscript.reviewStatus !== 'apply_ready' ||
  supportedTranscript.seamRisk !== 'low' ||
  supportedTranscript.sourceGeometryLayout !== 'single_row' ||
  supportedTranscript.sourceGeometrySupport !== 'implemented_current_engine' ||
  supportedTranscript.sourceGeometryGraphConnected !== true ||
  supportedTranscript.overlapConfidenceLevel !== 'high' ||
  supportedTranscript.seamWarningState !== 'clear' ||
  supportedTranscript.parallaxRisk !== 'low' ||
  supportedTranscript.blockedReasons.length !== 0
) {
  throw new Error(`Unexpected supported panorama seam-review transcript: ${JSON.stringify(supportedTranscript)}.`);
}
assertPreviewArtifactHandle(dryRun, supportedTranscript.contributionMapArtifactId);
assertPreviewArtifactHandle(dryRun, supportedTranscript.seamMaskArtifactId);

const weakOverlapFrames = sourceFrames.map((frame) =>
  frame.sourceIndex === 1
    ? { ...frame, expectedOffsetX: 70, expectedOffsetY: 1 }
    : frame.sourceIndex === 2
      ? { ...frame, expectedOffsetX: 140, expectedOffsetY: 2 }
      : frame,
);
const weakOverlapCommand = {
  ...dryRunCommand,
  commandId: 'command_panorama_app_server_runtime_weak_overlap',
  correlationId: 'corr_panorama_app_server_runtime_weak_overlap',
};
const weakOverlapDryRun = bus.execute({
  request: buildRequest(weakOverlapCommand, weakOverlapFrames),
  toolName: panoramaRoutePair.dryRunToolName,
});
if (weakOverlapDryRun.kind !== 'dry_run') throw new Error('Expected weak-overlap panorama dry-run.');
const weakOverlapTranscript = buildSeamReviewTranscript('weak_overlap_warning', weakOverlapDryRun);
if (
  weakOverlapTranscript.reviewStatus !== 'review_required' ||
  weakOverlapTranscript.seamRisk !== 'medium' ||
  weakOverlapTranscript.overlapConfidenceLevel !== 'low' ||
  weakOverlapTranscript.overlapConfidencePercent >= supportedTranscript.overlapConfidencePercent ||
  weakOverlapTranscript.seamWarningState !== 'warning' ||
  weakOverlapTranscript.parallaxRisk !== 'low' ||
  !weakOverlapTranscript.warnings.includes('low_overlap_confidence') ||
  !weakOverlapTranscript.warnings.includes('weak_alignment') ||
  weakOverlapTranscript.weakOverlapEdgeCount < 1
) {
  throw new Error(`Unexpected weak-overlap panorama seam-review transcript: ${JSON.stringify(weakOverlapTranscript)}.`);
}

const blockedBus = new PanoramaAppServerRuntimeToolBusV1(sampleComputationalMergeAppServerToolManifestV1);
const sourceMismatchCommand = {
  ...dryRunCommand,
  commandId: 'command_panorama_app_server_runtime_source_mismatch',
  correlationId: 'corr_panorama_app_server_runtime_source_mismatch',
};
const sourceMismatchDryRun = blockedBus.execute({
  request: buildRequest(sourceMismatchCommand, sourceFrames, [0, 1]),
  toolName: panoramaRoutePair.dryRunToolName,
});
if (sourceMismatchDryRun.kind !== 'dry_run') throw new Error('Expected source-mismatch panorama dry-run.');
const sourceMismatchTranscript = buildSeamReviewTranscript('source_mismatch_blocked', sourceMismatchDryRun);
if (
  sourceMismatchTranscript.reviewStatus !== 'blocked' ||
  !sourceMismatchTranscript.blockedReasons.includes('source_selection_incomplete') ||
  sourceMismatchTranscript.overlapConfidenceLevel !== 'blocked' ||
  sourceMismatchTranscript.seamWarningState !== 'blocked' ||
  sourceMismatchTranscript.parallaxRisk !== 'high' ||
  !sourceMismatchTranscript.warnings.includes('parallax_seam_warning') ||
  !sourceMismatchTranscript.warnings.includes('source_excluded') ||
  sourceMismatchTranscript.sourceGeometrySupport !== 'unverified' ||
  sourceMismatchTranscript.sourceGeometryGraphConnected !== false ||
  !sourceMismatchTranscript.sourceGeometryWarningCodes.includes('geometry_overclaim_guardrail') ||
  !sourceMismatchTranscript.sourceGeometryWarningCodes.includes('graph_disconnected')
) {
  throw new Error(`Unexpected blocked panorama seam-review transcript: ${JSON.stringify(sourceMismatchTranscript)}.`);
}

const gridLikeFrames = [
  { expectedOffsetX: 0, expectedOffsetY: 0, sourceIndex: 0 },
  { expectedOffsetX: 48, expectedOffsetY: 0, sourceIndex: 1 },
  { expectedOffsetX: 0, expectedOffsetY: 40, sourceIndex: 2 },
  { expectedOffsetX: 48, expectedOffsetY: 40, sourceIndex: 3 },
].map((frame) => ({
  ...frame,
  contentHash: `sha256:panorama-app-server-runtime-grid-like-${frame.sourceIndex}`,
  graphRevision: 'graph_rev_panorama_app_server_runtime_grid_like_source',
  height: 48,
  width: 72,
}));
const gridLikeCommand = {
  ...dryRunCommand,
  commandId: 'command_panorama_app_server_runtime_grid_like',
  correlationId: 'corr_panorama_app_server_runtime_grid_like',
  parameters: {
    ...dryRunCommand.parameters,
    sources: gridLikeFrames.map((frame) => ({
      colorSpaceHint: 'camera_rgb',
      exposureEv: 0,
      imageId: `img_panorama_app_server_runtime_grid_like_${frame.sourceIndex}`,
      imagePath: `/synthetic/panorama/app-server-runtime-grid-like-${frame.sourceIndex}.dng`,
      rawDefaultsApplied: true,
      role: 'panorama_tile',
      sourceIndex: frame.sourceIndex,
    })),
  },
};
const gridLikeDryRun = bus.execute({
  request: buildRequest(gridLikeCommand, gridLikeFrames, [0, 1, 2, 3]),
  toolName: panoramaRoutePair.dryRunToolName,
});
if (gridLikeDryRun.kind !== 'dry_run') throw new Error('Expected grid-like panorama dry-run.');
const gridLikeTranscript = buildSeamReviewTranscript('grid_like_warning', gridLikeDryRun);
if (
  gridLikeTranscript.sourceGeometryLayout !== 'grid_like' ||
  gridLikeTranscript.sourceGeometrySupport !== 'unverified' ||
  gridLikeTranscript.sourceGeometryGraphConnected !== true ||
  gridLikeTranscript.sourceGeometrySelectedComponentCount !== 4 ||
  !gridLikeTranscript.sourceGeometryWarningCodes.includes('geometry_overclaim_guardrail') ||
  !gridLikeTranscript.sourceGeometryWarningCodes.includes('grid_like_geometry_unverified')
) {
  throw new Error(`Unexpected grid-like panorama transcript: ${JSON.stringify(gridLikeTranscript)}.`);
}

const multiRowFrames = [
  { expectedOffsetX: 0, expectedOffsetY: 0, sourceIndex: 0 },
  { expectedOffsetX: 0, expectedOffsetY: 2, sourceIndex: 1 },
  { expectedOffsetX: 0, expectedOffsetY: 40, sourceIndex: 2 },
  { expectedOffsetX: 0, expectedOffsetY: 42, sourceIndex: 3 },
].map((frame) => ({
  ...frame,
  contentHash: `sha256:panorama-app-server-runtime-multi-row-${frame.sourceIndex}`,
  graphRevision: 'graph_rev_panorama_app_server_runtime_multi_row_source',
  height: 48,
  width: 72,
}));
const multiRowCommand = {
  ...dryRunCommand,
  commandId: 'command_panorama_app_server_runtime_multi_row',
  correlationId: 'corr_panorama_app_server_runtime_multi_row',
  parameters: {
    ...dryRunCommand.parameters,
    sources: multiRowFrames.map((frame) => ({
      colorSpaceHint: 'camera_rgb',
      exposureEv: 0,
      imageId: `img_panorama_app_server_runtime_multi_row_${frame.sourceIndex}`,
      imagePath: `/synthetic/panorama/app-server-runtime-multi-row-${frame.sourceIndex}.dng`,
      rawDefaultsApplied: true,
      role: 'panorama_tile',
      sourceIndex: frame.sourceIndex,
    })),
  },
};
const multiRowDryRun = bus.execute({
  request: buildRequest(multiRowCommand, multiRowFrames, [0, 1, 2, 3]),
  toolName: panoramaRoutePair.dryRunToolName,
});
if (multiRowDryRun.kind !== 'dry_run') throw new Error('Expected multi-row panorama dry-run.');
const multiRowTranscript = buildSeamReviewTranscript('multi_row_blocked', multiRowDryRun);
if (
  multiRowTranscript.reviewStatus !== 'blocked' ||
  multiRowTranscript.sourceGeometryLayout !== 'multi_row_candidate' ||
  multiRowTranscript.sourceGeometrySupport !== 'blocked_requires_multi_row_solver' ||
  multiRowTranscript.sourceRowCountEstimate !== 2 ||
  multiRowTranscript.sourceGeometryGraphConnected !== true ||
  !multiRowTranscript.blockedReasons.includes('multi_row_panorama_not_supported') ||
  !multiRowTranscript.warnings.includes('multi_row_runtime_deferred') ||
  !multiRowTranscript.warnings.includes('parallax_seam_warning') ||
  multiRowTranscript.seamWarningState !== 'blocked' ||
  multiRowDryRun.dryRun.dryRunResult.mergePlan.preflight.status !== 'blocked_plan_only'
) {
  throw new Error(`Unexpected multi-row panorama transcript: ${JSON.stringify(multiRowTranscript)}.`);
}

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
assertBackendSelectionReceipt(applied.apply.provenance.backendSelection, {
  fallbackReason: 'requested_backend_unavailable',
  requestedBackendId: 'opencv_stitching_spike',
  selectedBackendId: 'rapidraw_homography_seam_v0',
  selectionStatus: 'fallback',
});
if (applied.apply.sidecarArtifact.engine.engineId !== applied.apply.provenance.backendSelection.selectedBackendId) {
  throw new Error('Expected panorama sidecar engine to match selected backend receipt.');
}
if (applied.apply.outputPixels.length <= sourceFrames[0].width * sourceFrames[0].height * 3) {
  throw new Error('Expected panorama runtime output to be wider than one source frame.');
}
if (applied.apply.provenance.projectionSettings.effectiveProjection !== 'rectilinear') {
  throw new Error('Expected panorama runtime to report rectilinear effective projection.');
}
if (applied.apply.provenance.boundaryMode !== 'auto_crop') {
  throw new Error('Expected panorama runtime to preserve auto-crop boundary mode.');
}
if (
  applied.apply.provenance.tileRender.tileBackedRender !== true ||
  applied.apply.provenance.tileRender.tileCount !== applied.apply.sidecarArtifact.validationMetrics.tileCount
) {
  throw new Error('Expected panorama app-server apply to report tile-backed output metadata.');
}
if (dryRun.dryRun.dryRunResult.mergePlan.preflight.executionMode !== 'tile_backed_render') {
  throw new Error('Expected panorama app-server dry-run to report tile-backed preflight execution.');
}
if (dryRun.dryRun.dryRunResult.warnings.includes('legacy_full_frame_render')) {
  throw new Error('Expected panorama app-server dry-run to omit legacy full-frame warning on tiled runtime.');
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
const exposureResult = applied.apply.provenance.exposureNormalizationResult;
if (exposureResult.mode !== 'scalar_overlap_luminance_gain_v1' || (exposureResult.appliedGainCount ?? 0) < 1) {
  throw new Error(`Expected panorama app-server apply to expose exposure gains: ${JSON.stringify(exposureResult)}.`);
}
if (
  exposureResult.overlapMetrics?.medianLogLuminanceDeltaBefore === undefined ||
  exposureResult.overlapMetrics.medianLogLuminanceDeltaAfter === undefined ||
  exposureResult.overlapMetrics.medianLogLuminanceDeltaAfter >
    exposureResult.overlapMetrics.medianLogLuminanceDeltaBefore
) {
  throw new Error(`Expected panorama app-server exposure compensation to improve overlap metrics.`);
}
for (const gain of exposureResult.appliedLuminanceGains ?? []) {
  if (gain.gain < 0.5 || gain.gain > 2) {
    throw new Error(`Expected panorama app-server exposure gain ${gain.gain} to stay inside [0.5, 2.0].`);
  }
}
assertSidecarPreviewArtifact(applied, applied.apply.provenance.seamReview.contributionMapArtifact.artifactId);
assertSidecarPreviewArtifact(applied, applied.apply.provenance.seamReview.seamMaskArtifact.artifactId);

expectThrows('unaccepted panorama apply plan', () =>
  new PanoramaAppServerRuntimeToolBusV1(sampleComputationalMergeAppServerToolManifestV1).execute({
    request: buildRequest(applyCommand),
    toolName: panoramaRoutePair.applyToolName,
  }),
);
expectThrows('blocked panorama seam review apply', () =>
  blockedBus.execute({
    request: buildRequest(
      {
        ...sourceMismatchCommand,
        approval: {
          approvalClass: ApprovalClass.EditApply,
          reason: 'Panorama source-mismatch apply should stay blocked.',
          state: 'approved',
        },
        dryRun: false,
        parameters: {
          ...sourceMismatchCommand.parameters,
          acceptedDryRunPlanHash: sourceMismatchDryRun.acceptedDryRunPlanHash,
          acceptedDryRunPlanId: sourceMismatchDryRun.dryRun.dryRunResult.mergePlan.planId,
        },
      },
      sourceFrames,
      [0, 1],
    ),
    toolName: panoramaRoutePair.applyToolName,
  }),
);
expectThrows('blocked multi-row panorama apply', () =>
  bus.execute({
    request: buildRequest(
      {
        ...multiRowCommand,
        approval: {
          approvalClass: ApprovalClass.EditApply,
          reason: 'Panorama multi-row apply should stay blocked until multi-row solver exists.',
          state: 'approved',
        },
        dryRun: false,
        parameters: {
          ...multiRowCommand.parameters,
          acceptedDryRunPlanHash: multiRowDryRun.acceptedDryRunPlanHash,
          acceptedDryRunPlanId: multiRowDryRun.dryRun.dryRunResult.mergePlan.planId,
        },
      },
      multiRowFrames,
      [0, 1, 2, 3],
    ),
    toolName: panoramaRoutePair.applyToolName,
  }),
);
panoramaSeamReviewTranscriptSchema.parse({
  ...sourceMismatchTranscript,
  scenario: 'blocked_apply',
});
panoramaSeamReviewTranscriptSchema.parse({
  ...multiRowTranscript,
  scenario: 'multi_row_blocked_apply',
});

console.log(
  JSON.stringify({
    fixture: 'synthetic_panorama_app_server_runtime_v1',
    editableArtifactId: applied.apply.sidecarArtifact.artifactId,
    output: dryRun.dryRun.dryRunResult.mergePlan.outputDimensions,
    outputSha256: new Bun.CryptoHasher('sha256').update(applied.apply.outputPixels).digest('hex'),
    planId: dryRun.dryRun.dryRunResult.mergePlan.planId,
    backendSelection: applied.apply.provenance.backendSelection,
    tileRender: applied.apply.provenance.tileRender,
    seamReviewScenarios: [
      supportedTranscript.scenario,
      weakOverlapTranscript.scenario,
      sourceMismatchTranscript.scenario,
      multiRowTranscript.scenario,
      'blocked_apply',
      'multi_row_blocked_apply',
    ],
  }),
);

function buildRequest(command, requestSourceFrames = sourceFrames, connectedSourceIndices = [0, 1, 2]) {
  return {
    artifactCreatedAt: '2026-06-17T19:30:00.000Z',
    command,
    connectedSourceIndices,
    outputArtifactId: 'artifact_panorama_app_server_runtime_output',
    previewArtifactId: 'artifact_panorama_app_server_runtime_preview',
    seed: 'rawengine-panorama-app-server-runtime-v1',
    sourceFrames: requestSourceFrames,
  };
}

function buildSeamReviewTranscript(scenario, toolResult) {
  if (toolResult.kind !== 'dry_run') throw new Error(`Expected ${scenario} panorama dry-run.`);
  const seamReview = toolResult.dryRun.provenance.seamReview;
  return panoramaSeamReviewTranscriptSchema.parse({
    blockedReasons: seamReview.blockedReasons,
    contributionMapArtifactId: seamReview.contributionMapArtifact.artifactId,
    disconnectedSourceIndices: seamReview.disconnectedSourceIndices,
    mutates: toolResult.dryRun.dryRunResult.mutates,
    overlapConfidenceLevel: seamReview.overlapConfidence.level,
    overlapConfidencePercent: Math.round(seamReview.overlapConfidence.minimumConfidenceScore * 100),
    overlapMinimumRatio: seamReview.overlapConfidence.minimumOverlapRatio,
    parallaxRisk: seamReview.seamWarningState.parallaxRisk,
    reviewStatus: seamReview.reviewStatus,
    scenario,
    seamMaskArtifactId: seamReview.seamMaskArtifact.artifactId,
    seamRisk: seamReview.seamRisk,
    seamWarningState: seamReview.seamWarningState.state,
    sourceGeometryColumnCountEstimate: toolResult.dryRun.provenance.sourceGeometry.columnCountEstimate,
    sourceGeometryConnectedComponentCount: toolResult.dryRun.provenance.sourceGeometry.connectedComponentCount,
    sourceGeometryGraphConnected: toolResult.dryRun.provenance.sourceGeometry.graphConnectivity.isConnected,
    sourceGeometryHorizontalSpanPx: toolResult.dryRun.provenance.sourceGeometry.horizontalSpanPx,
    sourceGeometryLayout: toolResult.dryRun.provenance.sourceGeometry.layout,
    sourceGeometryLayoutConfidence: toolResult.dryRun.provenance.sourceGeometry.layoutConfidence,
    sourceGeometrySupport: toolResult.dryRun.provenance.sourceGeometry.support,
    sourceGeometrySelectedComponentCount: toolResult.dryRun.provenance.sourceGeometry.selectedComponent.sourceCount,
    sourceGeometrySelectedComponentIndices: toolResult.dryRun.provenance.sourceGeometry.selectedComponent.sourceIndices,
    sourceRowCountEstimate: toolResult.dryRun.provenance.sourceGeometry.rowCountEstimate,
    sourceGeometryWarningCodes: toolResult.dryRun.provenance.sourceGeometry.warningCodes,
    warnings: toolResult.dryRun.dryRunResult.warnings,
    weakOverlapEdgeCount: seamReview.weakOverlapEdgeCount,
  });
}

function assertPreviewArtifactHandle(toolResult, artifactId) {
  if (toolResult.kind !== 'dry_run') throw new Error('Expected dry-run artifact handle source.');
  if (!toolResult.dryRun.dryRunResult.previewArtifacts.some((artifact) => artifact.artifactId === artifactId)) {
    throw new Error(`Expected panorama dry-run preview artifacts to include ${artifactId}.`);
  }
}

function assertSidecarPreviewArtifact(toolResult, artifactId) {
  if (toolResult.kind !== 'apply') throw new Error('Expected apply artifact handle source.');
  const artifact = toolResult.apply.sidecarArtifact.previewArtifacts.find(
    (candidate) => candidate.artifactId === artifactId,
  );
  if (artifact === undefined || artifact.contentHash === undefined) {
    throw new Error(`Expected panorama apply sidecar preview artifacts to include hashed ${artifactId}.`);
  }
}

function assertBackendSelectionReceipt(receipt, expected) {
  if (receipt.requestedBackendId !== expected.requestedBackendId) {
    throw new Error(`Expected requested backend ${expected.requestedBackendId}, got ${receipt.requestedBackendId}.`);
  }
  if (receipt.selectedBackendId !== expected.selectedBackendId) {
    throw new Error(`Expected selected backend ${expected.selectedBackendId}, got ${receipt.selectedBackendId}.`);
  }
  if (receipt.fallbackReason !== expected.fallbackReason) {
    throw new Error(`Expected fallback reason ${expected.fallbackReason}, got ${receipt.fallbackReason}.`);
  }
  if (receipt.selectionStatus !== expected.selectionStatus) {
    throw new Error(`Expected backend selection status ${expected.selectionStatus}, got ${receipt.selectionStatus}.`);
  }
  if (receipt.capabilityEvidence.selectedBackendCapabilities.tiledRender !== true) {
    throw new Error('Expected selected panorama backend capability evidence to report tiled render support.');
  }
  const requestedEvidence = receipt.capabilityEvidence.consideredBackends.find(
    (backend) => backend.backendId === expected.requestedBackendId,
  );
  if (
    requestedEvidence === undefined ||
    requestedEvidence.status !== 'optional_spike' ||
    requestedEvidence.requiredCiBlockerCount < 1 ||
    !requestedEvidence.warnings.includes('packaging_unproven')
  ) {
    throw new Error(`Expected requested backend diagnostic evidence, got ${JSON.stringify(requestedEvidence)}.`);
  }
}

function expectThrows(label, callback) {
  try {
    callback();
  } catch {
    return;
  }
  throw new Error(`Expected ${label} to throw.`);
}
