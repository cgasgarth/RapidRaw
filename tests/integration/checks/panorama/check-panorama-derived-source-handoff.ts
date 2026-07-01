#!/usr/bin/env bun

import { openComputationalMergeDerivedSourceV1 } from '../../../../packages/rawengine-schema/src/computational-merge/computationalMergeDerivedSourceRuntime.ts';
import { PanoramaAppServerRuntimeToolBusV1 } from '../../../../packages/rawengine-schema/src/panorama/panoramaAppServerRuntime.ts';
import {
  ApprovalClass,
  RAW_ENGINE_SCHEMA_VERSION,
} from '../../../../packages/rawengine-schema/src/rawEngineSchemas.ts';
import { sampleComputationalMergeAppServerToolManifestV1 } from '../../../../packages/rawengine-schema/src/samplePayloads.ts';
import type { DerivedOutputReceipt } from '../../../../src/schemas/computational-merge/derivedOutputReceiptSchemas.ts';
import { DEFAULT_PANORAMA_UI_SETTINGS } from '../../../../src/schemas/computational-merge/panoramaUiSchemas.ts';
import { getComputationalMergeAppServerRoutePairSummary } from '../../../../src/utils/computational-merge/computationalMergeAppServerRoutePairs.ts';
import {
  buildPanoramaDerivedOutputReceipt,
  deriveDerivedOutputReceiptState,
} from '../../../../src/utils/derivedOutputReceipt.ts';

const sourcePaths = [
  '/proof/panorama/4493/source-left.CR3',
  '/proof/panorama/4493/source-center.CR3',
  '/proof/panorama/4493/source-right.CR3',
];
const sourceFrames = [
  { expectedOffsetX: 0, expectedOffsetY: 0, sourceIndex: 0 },
  { expectedOffsetX: 52, expectedOffsetY: 1, sourceIndex: 1 },
  { expectedOffsetX: 104, expectedOffsetY: -1, sourceIndex: 2 },
].map((frame) => ({
  ...frame,
  contentHash: `blake3:panorama-4493-source-${frame.sourceIndex}`,
  graphRevision: `graph_panorama_4493_source_${frame.sourceIndex}`,
  height: 48,
  width: 80,
}));

const settings = {
  ...DEFAULT_PANORAMA_UI_SETTINGS,
  boundaryMode: 'auto_crop',
  exposureMode: 'gain_compensation',
  projection: 'rectilinear',
  qualityPreference: 'balanced',
} as const;

const routePair = getComputationalMergeAppServerRoutePairSummary('panorama');
const dryRunCommand = {
  actor: { id: 'agent_rawengine', kind: 'agent' },
  approval: {
    approvalClass: ApprovalClass.PreviewOnly,
    reason: 'Panorama derived-source handoff validates source preflight before mutation.',
    state: 'not_required',
  },
  commandId: 'command_panorama_4493_dry_run',
  commandType: 'computationalMerge.createPanorama',
  correlationId: 'corr_panorama_4493_dry_run',
  dryRun: true,
  expectedGraphRevision: 'graph_panorama_4493_before_apply',
  parameters: {
    blendMode: settings.blendMode,
    boundaryMode: settings.boundaryMode,
    exposureNormalization: 'auto',
    lensCorrectionPolicy: 'required_before_stitch',
    maxPreviewDimensionPx: settings.maxPreviewDimensionPx,
    memoryBudgetBytes: 256_000_000,
    outputName: 'Panorama 4493 Editable',
    overlapFeatherPx: settings.overlapFeatherPx,
    projection: settings.projection,
    qualityPreference: settings.qualityPreference,
    seamExposureCompensationPercent: settings.seamExposureCompensationPercent,
    sources: sourceFrames.map((frame) => ({
      colorSpaceHint: 'camera_rgb',
      exposureEv: 0,
      imageId: `img_panorama_4493_${frame.sourceIndex}`,
      imagePath: sourcePathForIndex(frame.sourceIndex),
      rawDefaultsApplied: true,
      role: 'panorama_tile',
      sourceIndex: frame.sourceIndex,
    })),
  },
  schemaVersion: RAW_ENGINE_SCHEMA_VERSION,
  target: { id: 'project_panorama_4493', kind: 'project' },
} as const;

const bus = new PanoramaAppServerRuntimeToolBusV1(sampleComputationalMergeAppServerToolManifestV1);
const dryRun = bus.execute({
  request: buildRuntimeRequest(dryRunCommand),
  toolName: routePair.dryRunToolName,
});
if (dryRun.kind !== 'dry_run') throw new Error('Panorama derived-source check expected a dry-run result.');
if (dryRun.dryRun.dryRunResult.mergePlan.preflight.status !== 'accepted') {
  throw new Error(
    `Panorama source preflight was not accepted: ${dryRun.dryRun.dryRunResult.mergePlan.preflight.status}`,
  );
}
if (
  dryRun.dryRun.dryRunResult.mergePlan.sourceImageRefs.map((source) => source.imagePath).join(',') !==
  sourcePaths.join(',')
) {
  throw new Error('Panorama dry-run must preserve source ordering before apply.');
}
if (dryRun.dryRun.dryRunResult.mergePlan.outputDimensions.width <= firstSourceFrame().width) {
  throw new Error('Panorama dry-run must estimate a stitched output wider than one source.');
}

const acceptedDryRunPlanHash = dryRun.acceptedDryRunPlanHash;
const acceptedDryRunPlanId = dryRun.dryRun.dryRunResult.mergePlan.planId;
const applyCommand = {
  ...dryRunCommand,
  approval: {
    approvalClass: ApprovalClass.EditApply,
    reason: 'Panorama derived-source handoff applies an approved stitch plan.',
    state: 'approved',
  },
  commandId: 'command_panorama_4493_apply',
  correlationId: 'corr_panorama_4493_apply',
  dryRun: false,
  parameters: {
    ...dryRunCommand.parameters,
    acceptedDryRunPlanHash,
    acceptedDryRunPlanId,
  },
} as const;

const applied = bus.execute({
  request: buildRuntimeRequest(applyCommand),
  toolName: routePair.applyToolName,
});
if (applied.kind !== 'apply') throw new Error('Panorama derived-source check expected an apply result.');
if (applied.apply.provenance.projectionSettings.effectiveProjection !== settings.projection) {
  throw new Error('Panorama apply must preserve projection/settings receipt.');
}
if (
  applied.apply.sidecarArtifact.sourceState.map((source) => source.contentHash).join(',') !==
  sourceFrames.map((source) => source.contentHash).join(',')
) {
  throw new Error('Panorama apply sidecar must preserve source content hashes.');
}
if (applied.apply.sidecarArtifact.staleState.state !== 'current') {
  throw new Error('Panorama apply sidecar must start current.');
}

const review = buildReview('/proof/panorama/4493/derived/IMG_4493_Pano.tiff');
const receipt = buildPanoramaDerivedOutputReceipt({
  acceptedDryRunPlanHash,
  acceptedDryRunPlanId,
  review,
  settings,
});
if (sourcePaths.includes(receipt.openInEditorAction.path ?? '')) {
  throw new Error('Panorama derived output open action must never target an original source.');
}
if (receipt.provenanceSidecar?.sourceState[1]?.contentHash !== review.sourceRefs[1]?.contentHash) {
  throw new Error('Panorama provenance sidecar must carry source content hashes.');
}

const mutationResult = {
  ...applied.apply.mutationResult,
  changedNodeIds: [receipt.outputArtifactId],
  derivedAssetId: receipt.outputArtifactId,
  outputArtifacts: [
    {
      artifactId: receipt.outputArtifactId,
      contentHash: receipt.outputContentHash,
      dimensions: review.outputDimensions,
      kind: 'merge_output' as const,
      storage: 'export_path' as const,
    },
  ],
};
const openResult = openComputationalMergeDerivedSourceV1({
  actor: applyCommand.actor,
  approval: applyCommand.approval,
  command: applyCommand,
  correlationId: 'corr_panorama_4493_open',
  currentGraphRevision: mutationResult.appliedGraphRevision,
  mutationResult,
  receipt: receiptIdentity(receipt),
  requestId: 'request_panorama_4493_open',
  schemaVersion: RAW_ENGINE_SCHEMA_VERSION,
});
if (openResult.openPath !== receipt.openInEditorAction.path) {
  throw new Error('Panorama open-derived-source result must use the receipt output path.');
}
if (openResult.family !== 'panorama') {
  throw new Error('Panorama open-derived-source result must stay panorama-scoped.');
}

const contentChangedReceipt = buildPanoramaDerivedOutputReceipt({
  acceptedDryRunPlanHash,
  acceptedDryRunPlanId,
  review: {
    ...review,
    sourceRefs: [
      { ...reviewSourceRef(0), contentHash: 'blake3:panorama-4493-source-0-rewritten' },
      reviewSourceRef(1),
      reviewSourceRef(2),
    ],
  },
  settings,
});
const staleByContent = deriveDerivedOutputReceiptState({ current: contentChangedReceipt, receipt });
if (staleByContent.staleState !== 'stale' || !staleByContent.staleReasons?.includes('source_content_hash_changed')) {
  throw new Error('Panorama derived receipt must become stale when source content hash changes.');
}

const graphChangedReceipt = buildPanoramaDerivedOutputReceipt({
  acceptedDryRunPlanHash,
  acceptedDryRunPlanId,
  review: {
    ...review,
    sourceRefs: [
      reviewSourceRef(0),
      { ...reviewSourceRef(1), graphRevision: 'graph_panorama_4493_source_1_retouched' },
      reviewSourceRef(2),
    ],
  },
  settings,
});
const staleByGraph = deriveDerivedOutputReceiptState({ current: graphChangedReceipt, receipt });
if (staleByGraph.staleState !== 'stale' || !staleByGraph.staleReasons?.includes('source_graph_revision_changed')) {
  throw new Error('Panorama derived receipt must become stale when a source graph revision changes.');
}
expectThrows('stale panorama derived source open', () =>
  openComputationalMergeDerivedSourceV1({
    actor: applyCommand.actor,
    approval: applyCommand.approval,
    command: applyCommand,
    correlationId: 'corr_panorama_4493_open_stale',
    currentGraphRevision: mutationResult.appliedGraphRevision,
    mutationResult,
    receipt: receiptIdentity(staleByGraph),
    requestId: 'request_panorama_4493_open_stale',
    schemaVersion: RAW_ENGINE_SCHEMA_VERSION,
  }),
);

const settingsChangedReceipt = buildPanoramaDerivedOutputReceipt({
  acceptedDryRunPlanHash,
  acceptedDryRunPlanId,
  review,
  settings: { ...settings, projection: 'cylindrical' },
});
const staleBySettings = deriveDerivedOutputReceiptState({ current: settingsChangedReceipt, receipt });
if (staleBySettings.staleState !== 'stale' || !staleBySettings.staleReasons?.includes('settings_hash_changed')) {
  throw new Error('Panorama derived receipt must become stale when projection/settings change.');
}

console.log(
  JSON.stringify({
    openedDerivedSourceId: openResult.derivedSourceId,
    outputPath: openResult.openPath,
    sourceCount: review.sourceCount,
    staleReasons: [
      ...(staleByContent.staleReasons ?? []),
      ...(staleByGraph.staleReasons ?? []),
      ...(staleBySettings.staleReasons ?? []),
    ],
  }),
);

function buildRuntimeRequest(command: unknown, connectedSourceIndices = [0, 1, 2]) {
  return {
    artifactCreatedAt: '2026-07-01T12:00:00.000Z',
    command,
    connectedSourceIndices,
    outputArtifactId: 'artifact_panorama_4493_output',
    previewArtifactId: 'artifact_panorama_4493_preview',
    seed: 'rawengine-panorama-derived-source-4493',
    sourceFrames,
  };
}

function buildReview(outputPath: string) {
  return {
    boundaryMode: settings.boundaryMode,
    capabilityLevel: 'runtime_apply_capable' as const,
    crop: {
      height: applied.apply.sidecarArtifact.crop.height,
      mode: 'auto',
      preCropHeight: applied.apply.provenance.projectedBounds.height,
      preCropWidth: applied.apply.provenance.projectedBounds.width,
      width: applied.apply.sidecarArtifact.crop.width,
      x: applied.apply.sidecarArtifact.crop.x,
      y: applied.apply.sidecarArtifact.crop.y,
    },
    exposureNormalizationSummary: {
      appliedGainCount: applied.apply.provenance.exposureNormalizationResult.appliedGainCount ?? 0,
      mode: applied.apply.provenance.exposureNormalizationResult.mode,
    },
    outputDimensions: outputArtifact().dimensions,
    outputPath,
    projection: settings.projection,
    seamReview: {
      policy: 'adaptive_dp_feather_v1' as const,
      reviewStatus: 'ready' as const,
      seamCount: applied.apply.provenance.seamReview.overlapEdgeCount,
      seams: applied.apply.provenance.alignment.graph.selectedEdges.map((edge) => ({
        confidence: 'high' as const,
        featherWidthPx: settings.overlapFeatherPx,
        fromSourceIndex: edge.fromSourceIndex,
        p95ErrorPx: 0.25,
        toSourceIndex: edge.toSourceIndex,
      })),
    },
    sourceContribution: {
      excludedSourceCount: 0,
      regions: sourceFrames.map((source) => ({
        coverageRatio: 1 / sourceFrames.length,
        role: 'stitched' as const,
        sourceIndex: source.sourceIndex,
      })),
      stitchedSourceCount: sourceFrames.length,
    },
    sourceCount: sourceFrames.length,
    sourceRefs: sourceFrames.map((source) => ({
      contentHash: source.contentHash,
      graphRevision: source.graphRevision,
      path: sourcePathForIndex(source.sourceIndex),
      sourceIndex: source.sourceIndex,
    })),
    warningCodes: applied.apply.mutationResult.warnings,
  };
}

function firstSourceFrame() {
  const frame = sourceFrames[0];
  if (frame === undefined) throw new Error('Panorama 4493 check requires at least one source frame.');
  return frame;
}

function sourcePathForIndex(sourceIndex: number) {
  const path = sourcePaths[sourceIndex];
  if (path === undefined) throw new Error(`Missing panorama source path for index ${sourceIndex}.`);
  return path;
}

function reviewSourceRef(sourceIndex: number) {
  const sourceRef = review.sourceRefs[sourceIndex];
  if (sourceRef === undefined) throw new Error(`Missing panorama review source ref for index ${sourceIndex}.`);
  return sourceRef;
}

function outputArtifact() {
  const artifact = applied.apply.mutationResult.outputArtifacts[0];
  if (artifact === undefined) throw new Error('Panorama apply did not produce an output artifact.');
  return artifact;
}

function receiptIdentity(receipt: DerivedOutputReceipt) {
  return {
    acceptedDryRunPlanHash: receipt.acceptedDryRunPlanHash,
    acceptedDryRunPlanId: receipt.acceptedDryRunPlanId,
    family: receipt.family,
    openInEditorAction: {
      path: receipt.openInEditorAction.path,
      state: receipt.openInEditorAction.state,
    },
    outputArtifactId: receipt.outputArtifactId,
    outputContentHash: receipt.outputContentHash,
    outputPath: receipt.outputPath,
    provenanceSidecarPath: receipt.provenanceSidecar?.sidecarPath,
    receiptId: receipt.receiptId,
    settingsHash: receipt.settingsHash,
    sourceGraphRevisions: receipt.sourceGraphRevisions,
    staleReasons: receipt.staleReasons,
    staleState: receipt.staleState,
  };
}

function expectThrows(label: string, callback: () => void) {
  try {
    callback();
  } catch {
    return;
  }
  throw new Error(`Expected ${label} to throw.`);
}
