#!/usr/bin/env bun

import { sampleComputationalMergeAppServerToolManifestV1 } from '../../../../packages/rawengine-schema/src/samplePayloads.ts';
import { SuperResolutionAppServerRuntimeToolBusV1 } from '../../../../packages/rawengine-schema/src/super-resolution/superResolutionAppServerRuntime.ts';
import {
  calculateMeanAbsoluteErrorV1,
  createNearestNeighborBaselineV1,
} from '../../../../packages/rawengine-schema/src/super-resolution/superResolutionPixelShift.ts';
import {
  buildSuperResolutionUiApplyCommandV1,
  buildSuperResolutionUiDryRunCommandV1,
} from '../../../../packages/rawengine-schema/src/super-resolution/superResolutionUiControls.ts';
import { getComputationalMergeAppServerRoutePairSummary } from '../../../../src/utils/computational-merge/computationalMergeAppServerRoutePairs.ts';
import { buildSuperResolutionDerivedOutputReceipt } from '../../../../src/utils/derivedOutputReceipt.ts';
import { buildSuperResolutionOutputReviewFromArtifact } from '../../../../src/utils/superResolutionOutputReview.ts';

const superResolutionRoutePair = getComputationalMergeAppServerRoutePairSummary('super_resolution');
const SCALE = 2;
const LOW_WIDTH = 24;
const LOW_HEIGHT = 18;
const HIGH_WIDTH = LOW_WIDTH * SCALE;
const HIGH_HEIGHT = LOW_HEIGHT * SCALE;

const truth = createTruth();
const frames = [
  { shiftX: 0, shiftY: 0, sourceIndex: 0 },
  { shiftX: 1, shiftY: 0, sourceIndex: 1 },
  { shiftX: 0, shiftY: 1, sourceIndex: 2 },
  { shiftX: 1, shiftY: 1, sourceIndex: 3 },
].map((frame) => ({
  contentHash: `sha256:sr-ui-runtime-${frame.sourceIndex}`,
  graphRevision: 'graph_rev_sr_ui_runtime_source',
  height: LOW_HEIGHT,
  pixels: downsample(truth, frame.shiftX, frame.shiftY),
  shiftX: frame.shiftX,
  shiftY: frame.shiftY,
  sourceIndex: frame.sourceIndex,
  width: LOW_WIDTH,
}));

const controls = {
  alignmentMode: 'translation',
  detailPolicy: 'conservative',
  maxPreviewDimensionPx: 1200,
  outputName: 'Synthetic UI Runtime SR',
  outputScale: SCALE,
  qualityPreference: 'best',
  reconstructionMode: 'optical_flow',
  sources: frames.map((frame) => ({
    colorSpaceHint: 'camera_rgb',
    exposureEv: 0,
    imageId: `img_sr_ui_runtime_${frame.sourceIndex}`,
    imagePath: `/synthetic/sr/ui-runtime-${frame.sourceIndex}.dng`,
    sourceIndex: frame.sourceIndex,
  })),
};

const dryRunCommand = buildSuperResolutionUiDryRunCommandV1(controls, {
  commandId: 'command_sr_ui_runtime_dry_run',
  correlationId: 'corr_sr_ui_runtime',
  expectedGraphRevision: 'graph_rev_sr_ui_runtime',
  targetId: 'project_sr_ui_runtime',
});

const bus = new SuperResolutionAppServerRuntimeToolBusV1(sampleComputationalMergeAppServerToolManifestV1);
const dryRun = bus.execute({
  request: buildRequest(dryRunCommand),
  toolName: superResolutionRoutePair.dryRunToolName,
});
if (dryRun.kind !== 'dry_run') throw new Error('Expected SR UI runtime bridge dry-run result.');

const applyCommand = buildSuperResolutionUiApplyCommandV1(controls, {
  acceptedDryRunPlanHash: dryRun.acceptedDryRunPlanHash,
  acceptedDryRunPlanId: dryRun.dryRun.dryRunResult.mergePlan.planId,
  commandId: 'command_sr_ui_runtime_apply',
  correlationId: 'corr_sr_ui_runtime_apply',
  expectedGraphRevision: 'graph_rev_sr_ui_runtime',
  idempotencyKey: 'idem_sr_ui_runtime_apply',
  targetId: 'project_sr_ui_runtime',
});

const applied = bus.execute({
  request: buildRequest(applyCommand),
  toolName: superResolutionRoutePair.applyToolName,
});
if (applied.kind !== 'apply') throw new Error('Expected SR UI runtime bridge apply result.');
if (applied.apply.provenance.acceptedDryRunPlanId !== dryRun.dryRun.dryRunResult.mergePlan.planId) {
  throw new Error('SR UI runtime bridge did not preserve accepted dry-run plan ID.');
}
const tiledApplyReceipt = buildTiledApplyReceipt({
  outputHeight: HIGH_HEIGHT,
  outputPixels: applied.apply.outputPixels.length,
  outputWidth: HIGH_WIDTH,
  runtimeArtifactId: applied.apply.mutationResult.derivedAssetId,
  scale: SCALE,
});
const outputReview = buildSuperResolutionOutputReviewFromArtifact({
  ...applied.apply.sidecarArtifact,
  tiledApplyReceipt,
});
if (outputReview.editableGate !== 'blocked_review_required') {
  throw new Error(`Expected SR output review to block editable handoff, got ${outputReview.editableGate}.`);
}
if (outputReview.tiledApplyReceipt?.runtimeArtifactId !== applied.apply.mutationResult.derivedAssetId) {
  throw new Error('SR output review did not preserve tiled apply runtime artifact id.');
}
if (outputReview.tiledApplyReceipt.tileGrid.tileCount !== 4) {
  throw new Error(`Expected 4 tiled apply tiles, got ${outputReview.tiledApplyReceipt.tileGrid.tileCount}.`);
}
if (outputReview.tiledApplyReceipt.observedPerformance.outputMegapixels <= 0) {
  throw new Error('SR tiled apply receipt must record positive output megapixels.');
}
const derivedReceipt = buildSuperResolutionDerivedOutputReceipt({
  acceptedDryRunPlanHash: dryRun.acceptedDryRunPlanHash,
  acceptedDryRunPlanId: dryRun.dryRun.dryRunResult.mergePlan.planId,
  review: outputReview,
  settings: controls,
});
if (derivedReceipt.superResolution?.tiledApplyReceipt?.runtimeStatus !== 'apply_rendered') {
  throw new Error('SR derived output receipt did not persist tiled apply metadata.');
}
if (derivedReceipt.superResolution.tiledApplyReceipt.tileGrid.tileCount !== tiledApplyReceipt.tileGrid.tileCount) {
  throw new Error('SR derived output receipt changed tiled apply tile count.');
}
if (outputReview.humanReviewStatus !== 'pending') {
  throw new Error(`Expected pending human review, got ${outputReview.humanReviewStatus}.`);
}
if (outputReview.downscaleReconstructionError === null) {
  throw new Error('Expected SR output review to expose downscale reconstruction error.');
}
if (outputReview.falseDetailRiskScore === null) {
  throw new Error('Expected SR output review to expose false-detail risk score.');
}
if (outputReview.outputArtifactHash !== applied.apply.sidecarArtifact.outputArtifact.contentHash) {
  throw new Error('SR output review did not preserve output artifact hash.');
}
if (
  outputReview.sourceRefs.map((source) => source.contentHash).join(',') !==
  applied.apply.sidecarArtifact.sourceState.map((source) => source.contentHash).join(',')
) {
  throw new Error('SR output review did not preserve source content hashes.');
}
if (
  outputReview.sourceRefs.map((source) => source.graphRevision).join(',') !==
  applied.apply.sidecarArtifact.sourceState.map((source) => source.graphRevision).join(',')
) {
  throw new Error('SR output review did not preserve source graph revisions.');
}
if (
  outputReview.sourceRefs.map((source) => source.path ?? '').join(',') !==
  applied.apply.sidecarArtifact.sourceImageRefs.map((source) => source.imagePath).join(',')
) {
  throw new Error('SR output review did not preserve source image paths.');
}
if (outputReview.reconstructionMode !== 'optical_flow') {
  throw new Error(`Expected sidecar artifact review reconstruction mode, got ${outputReview.reconstructionMode}.`);
}
if (outputReview.detailReview.reviewStatus !== 'needs_review') {
  throw new Error(`Expected needs-review SR detail review, got ${outputReview.detailReview.reviewStatus}.`);
}
if (
  outputReview.detailReview.regions.map((region) => region.regionId).join(',') !==
  applied.apply.sidecarArtifact.measuredReview?.detailReviewRegions.map((region) => region.regionId).join(',')
) {
  throw new Error('SR output review did not preserve measured detail review regions.');
}
if (outputReview.detailReview.improvementHighlightCount < 3) {
  throw new Error(`Expected SR detail review highlights, got ${outputReview.detailReview.improvementHighlightCount}.`);
}
if (
  outputReview.detailReview.meanImprovementRatio !==
  Number(
    (
      (applied.apply.sidecarArtifact.measuredReview?.detailReviewRegions.reduce(
        (sum, region) => sum + region.improvementRatio,
        0,
      ) ?? 0) / Math.max(1, applied.apply.sidecarArtifact.measuredReview?.detailReviewRegions.length ?? 0)
    ).toFixed(3),
  )
) {
  throw new Error('SR output review did not preserve the measured mean detail improvement ratio.');
}
if (outputReview.detailReview.meanImprovementRatio < 1.08) {
  throw new Error(`Expected SR detail review improvement, got ${outputReview.detailReview.meanImprovementRatio}.`);
}
if (
  !outputReview.detailReview.regions.some(
    (region) =>
      region.regionId === 'center-microcontrast' && region.reconstructedSharpnessScore > region.baselineSharpnessScore,
  )
) {
  throw new Error('SR output review missing measured center detail improvement region.');
}
if (!outputReview.warningCodes.includes('human_review_required')) {
  throw new Error('SR output review must keep human-review warning.');
}
if (applied.apply.sidecarArtifact.supportMap === undefined) {
  throw new Error('SR sidecar artifact must persist support-map metadata.');
}
if (outputReview.supportMap.artifactId !== applied.apply.sidecarArtifact.supportMap.artifactId) {
  throw new Error('SR output review did not preserve support-map artifact id.');
}
if (outputReview.supportMap.reviewStatus !== applied.apply.sidecarArtifact.supportMap.reviewStatus) {
  throw new Error('SR output review did not preserve support-map review status.');
}
if (outputReview.supportMap.weakSupportRatio !== applied.apply.sidecarArtifact.supportMap.weakSupportRatio) {
  throw new Error('SR output review did not preserve support-map weak support ratio.');
}
if (outputReview.detailGainRatio !== applied.apply.sidecarArtifact.measuredReview?.detailGainRatio) {
  throw new Error('SR output review did not preserve measured detail gain ratio.');
}
if (outputReview.reviewArtifacts.length !== 4) {
  throw new Error(`Expected 4 SR review artifacts, got ${outputReview.reviewArtifacts.length}.`);
}
if (
  !outputReview.reviewArtifacts.some(
    (artifact) =>
      artifact.kind === 'reconstruction_review_crop' &&
      artifact.path === 'artifacts/validation/sr-synthetic-output-artifact/sr-x2-review-crop-center.pgm' &&
      artifact.contentHash === 'sha256:a11fafd6b4dac601c7afa6903f6f04a01e720c988fd20ef2fc7087e08e8a5326' &&
      !artifact.publicRepoAllowed,
  )
) {
  throw new Error('SR output review missing private reconstruction crop review artifact metadata.');
}
if (
  !outputReview.reviewArtifacts.some(
    (artifact) =>
      artifact.kind === 'crop_review_sheet' &&
      artifact.path === 'artifacts/validation/sr-synthetic-output-artifact/sr-x2-crop-review-sheet.html' &&
      artifact.contentHash === 'sha256:fe26992fc8262f8ce81fd3f8a8c2fa19d9b1aa013ebd300b6348c7e3357a7823' &&
      !artifact.publicRepoAllowed,
  )
) {
  throw new Error('SR output review missing private 100/200 crop sheet artifact metadata.');
}

expectThrows('mismatched accepted SR UI runtime plan', () =>
  bus.execute({
    request: buildRequest({
      ...applyCommand,
      parameters: {
        ...applyCommand.parameters,
        acceptedDryRunPlanHash: 'sha256:not-the-accepted-plan',
      },
    }),
    toolName: superResolutionRoutePair.applyToolName,
  }),
);

const nearestBaseline = createNearestNeighborBaselineV1(frames[0].pixels, LOW_WIDTH, LOW_HEIGHT, SCALE);
const improvementRatio =
  (calculateMeanAbsoluteErrorV1(nearestBaseline, truth) -
    calculateMeanAbsoluteErrorV1(applied.apply.outputPixels, truth)) /
  calculateMeanAbsoluteErrorV1(nearestBaseline, truth);
if (improvementRatio < 0.65) throw new Error(`Expected SR improvement ratio >= 0.65, got ${improvementRatio}.`);

const downgradedControls = { ...controls, outputScale: 4 };
const downgradedDryRunCommand = buildSuperResolutionUiDryRunCommandV1(downgradedControls, {
  commandId: 'command_sr_ui_runtime_downgrade_dry_run',
  correlationId: 'corr_sr_ui_runtime_downgrade',
  expectedGraphRevision: 'graph_rev_sr_ui_runtime_downgrade',
  targetId: 'project_sr_ui_runtime',
});
const downgradedDryRun = bus.execute({
  request: buildRequest(downgradedDryRunCommand),
  toolName: superResolutionRoutePair.dryRunToolName,
});
if (downgradedDryRun.kind !== 'dry_run') throw new Error('Expected downgraded SR dry-run result.');
const downgradedApplyCommand = buildSuperResolutionUiApplyCommandV1(downgradedControls, {
  acceptedDryRunPlanHash: downgradedDryRun.acceptedDryRunPlanHash,
  acceptedDryRunPlanId: downgradedDryRun.dryRun.dryRunResult.mergePlan.planId,
  commandId: 'command_sr_ui_runtime_downgrade_apply',
  correlationId: 'corr_sr_ui_runtime_downgrade_apply',
  expectedGraphRevision: 'graph_rev_sr_ui_runtime_downgrade',
  idempotencyKey: 'idem_sr_ui_runtime_downgrade_apply',
  targetId: 'project_sr_ui_runtime',
});
const downgradedApplied = bus.execute({
  request: buildRequest(downgradedApplyCommand),
  toolName: superResolutionRoutePair.applyToolName,
});
if (downgradedApplied.kind !== 'apply') throw new Error('Expected downgraded SR apply result.');
const downgradedReview = buildSuperResolutionOutputReviewFromArtifact(downgradedApplied.apply.sidecarArtifact);
if (downgradedReview.supportMap.requestedScale !== 4 || downgradedReview.supportMap.effectiveScale !== 2) {
  throw new Error(`Expected requested x4/effective x2 support map, got ${JSON.stringify(downgradedReview.supportMap)}`);
}
if (downgradedReview.supportMap.downgradeReason !== 'effective_scale_downgraded') {
  throw new Error(`Expected effective-scale downgrade reason, got ${downgradedReview.supportMap.downgradeReason}`);
}
if (!downgradedReview.warningCodes.includes('effective_scale_downgraded')) {
  throw new Error('Downgraded SR output review must include effective-scale warning.');
}
if (downgradedReview.detailReview.reconstructedArtifactId !== downgradedReview.outputArtifactId) {
  throw new Error('Downgraded SR detail review must point at the reconstructed output artifact.');
}

const result = {
  detailReviewStatus: outputReview.detailReview.reviewStatus,
  fixture: 'synthetic_sr_ui_runtime_bridge_v1',
  improvementRatio,
  outputReviewEditableGate: outputReview.editableGate,
  outputReviewStatus: outputReview.humanReviewStatus,
  supportMapReviewStatus: outputReview.supportMap.reviewStatus,
  supportMapWeakSupportRatio: outputReview.supportMap.weakSupportRatio,
  outputSha256: new Bun.CryptoHasher('sha256').update(new Uint8Array(applied.apply.outputPixels.buffer)).digest('hex'),
  planId: dryRun.dryRun.dryRunResult.mergePlan.planId,
};
if (process.argv.includes('--verbose')) {
  console.log(JSON.stringify(result, null, 2));
} else {
  console.log(`SR UI runtime bridge ok (improvement=${result.improvementRatio.toFixed(3)})`);
}

function buildRequest(command) {
  return {
    command,
    confidenceMapArtifactId: 'artifact_sr_ui_runtime_confidence',
    frames,
    outputArtifactId: 'artifact_sr_ui_runtime_output',
    previewArtifactId: 'artifact_sr_ui_runtime_preview',
  };
}

function buildTiledApplyReceipt({
  outputHeight,
  outputPixels,
  outputWidth,
  runtimeArtifactId,
  scale,
}: {
  outputHeight: number;
  outputPixels: number;
  outputWidth: number;
  runtimeArtifactId: string;
  scale: number;
}) {
  const outputMegapixels = Number((outputPixels / 1_000_000).toFixed(6));
  const tileWidth = Math.ceil(outputWidth / scale);
  const tileHeight = Math.ceil(outputHeight / scale);
  const tileCount = scale * scale;
  const estimatedPeakMemoryBytes = outputPixels * Float32Array.BYTES_PER_ELEMENT;

  return {
    applyMode: 'tiled_conservative',
    conservativeLimits: {
      enhancementMode: 'bounded_pixel_shift_interleave',
      fullResolutionEnhancement: false,
      maxOutputMegapixels: Number(Math.max(outputMegapixels, 0.1).toFixed(6)),
      maxPeakMemoryBytes: estimatedPeakMemoryBytes * 2,
      previewExportParityClaimed: false,
    },
    observedPerformance: {
      estimatedPeakMemoryBytes,
      observedApplyMs: Number(Math.max(1, outputPixels / 10_000).toFixed(3)),
      observedMegapixelsPerSecond: Number(Math.max(0.001, outputMegapixels * 10).toFixed(6)),
      outputMegapixels,
    },
    outputDimensions: {
      height: outputHeight,
      width: outputWidth,
    },
    receiptVersion: 1,
    runtimeArtifactId,
    runtimeStatus: 'apply_rendered',
    tileGrid: {
      overlapPx: 1,
      tileCount,
      tileHeight,
      tileWidth,
      tilesX: scale,
      tilesY: scale,
    },
  } as const;
}

function createTruth() {
  const pixels = new Float32Array(HIGH_WIDTH * HIGH_HEIGHT);
  for (let y = 0; y < HIGH_HEIGHT; y += 1) {
    for (let x = 0; x < HIGH_WIDTH; x += 1) {
      pixels[y * HIGH_WIDTH + x] = Math.max(
        0,
        Math.min(1, (x / HIGH_WIDTH) * 0.35 + (y / HIGH_HEIGHT) * 0.25 + (x % 3 === 0 ? 0.28 : 0.08)),
      );
    }
  }
  return pixels;
}

function downsample(truthPixels, shiftX, shiftY) {
  const pixels = new Float32Array(LOW_WIDTH * LOW_HEIGHT);
  for (let y = 0; y < LOW_HEIGHT; y += 1) {
    for (let x = 0; x < LOW_WIDTH; x += 1) {
      pixels[y * LOW_WIDTH + x] = truthPixels[(y * SCALE + shiftY) * HIGH_WIDTH + x * SCALE + shiftX] ?? 0;
    }
  }
  return pixels;
}

function expectThrows(label, callback) {
  try {
    callback();
  } catch {
    return;
  }
  throw new Error(`Expected ${label} to throw.`);
}
