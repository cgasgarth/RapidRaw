#!/usr/bin/env bun

import { FocusStackAppServerRuntimeToolBusV1 } from '../../../packages/rawengine-schema/src/focusStackAppServerRuntime.ts';
import {
  buildFocusStackUiApplyCommandV1,
  buildFocusStackUiDryRunCommandV1,
} from '../../../packages/rawengine-schema/src/focusStackUiControls.ts';
import { sampleComputationalMergeAppServerToolManifestV1 } from '../../../packages/rawengine-schema/src/samplePayloads.ts';
import { getComputationalMergeAppServerRoutePairSummary } from '../../../src/utils/computationalMergeAppServerRoutePairs.ts';
import { buildFocusStackOutputReviewFromArtifact } from '../../../src/utils/focusStackOutputReview.ts';
import { COMPUTATIONAL_PROOF_MEMORY_BUDGET_BYTES } from '../../../scripts/lib/computational-proof-budgets.ts';

const focusRoutePair = getComputationalMergeAppServerRoutePairSummary('focus_stack');
const WIDTH = 72;
const HEIGHT = 48;
const sourceRegions = [
  { height: HEIGHT, sourceIndex: 0, width: 24, x: 0, y: 0 },
  { height: HEIGHT, sourceIndex: 1, width: 24, x: 24, y: 0 },
  { height: HEIGHT, sourceIndex: 2, width: 24, x: 48, y: 0 },
];
const frames = [0, 1, 2].map((sourceIndex) => ({
  contentHash: `sha256:focus-ui-runtime-${sourceIndex}`,
  focusDistanceMm: 180 + sourceIndex * 60,
  graphRevision: 'graph_rev_focus_ui_runtime_source',
  height: HEIGHT,
  pixels: createFocusFrame(sourceIndex),
  sourceIndex,
  translationX: 0,
  translationY: 0,
  width: WIDTH,
}));
const cells = sourceRegions.map((region) => ({
  height: region.height,
  lowConfidence: region.sourceIndex === 1,
  sourceScores: [0, 1, 2].map((sourceIndex) => ({
    relativeConfidence: sourceIndex === region.sourceIndex ? 1 : region.sourceIndex === 1 ? 0.84 : 0.01,
    sourceIndex,
  })),
  width: region.width,
  x: region.x,
  y: region.y,
}));

const controls = {
  alignmentMode: 'translation',
  blendMethod: 'weighted_sharpness',
  haloSuppressionStrengthPercent: 80,
  maxPreviewDimensionPx: 1200,
  memoryBudgetBytes: COMPUTATIONAL_PROOF_MEMORY_BUDGET_BYTES,
  outputName: 'Synthetic UI Runtime Focus Stack',
  qualityPreference: 'best',
  retouchLayerPolicy: 'generate_retouch_layer',
  sources: frames.map((frame) => ({
    colorSpaceHint: 'camera_rgb',
    focusDistanceMm: frame.focusDistanceMm,
    imageId: `img_focus_ui_runtime_${frame.sourceIndex}`,
    imagePath: `/synthetic/focus/ui-runtime-${frame.sourceIndex}.dng`,
    sourceIndex: frame.sourceIndex,
  })),
};

const dryRunCommand = buildFocusStackUiDryRunCommandV1(controls, {
  commandId: 'command_focus_ui_runtime_dry_run',
  correlationId: 'corr_focus_ui_runtime',
  expectedGraphRevision: 'graph_rev_focus_ui_runtime',
  targetId: 'project_focus_ui_runtime',
});

const bus = new FocusStackAppServerRuntimeToolBusV1(sampleComputationalMergeAppServerToolManifestV1);
const dryRun = bus.execute({
  request: buildRequest(dryRunCommand),
  toolName: focusRoutePair.dryRunToolName,
});
if (dryRun.kind !== 'dry_run') throw new Error('Expected focus UI runtime bridge dry-run result.');

const applyCommand = buildFocusStackUiApplyCommandV1(controls, {
  acceptedDryRunPlanHash: dryRun.acceptedDryRunPlanHash,
  acceptedDryRunPlanId: dryRun.dryRun.dryRunResult.mergePlan.planId,
  commandId: 'command_focus_ui_runtime_apply',
  correlationId: 'corr_focus_ui_runtime_apply',
  expectedGraphRevision: 'graph_rev_focus_ui_runtime',
  idempotencyKey: 'idem_focus_ui_runtime_apply',
  targetId: 'project_focus_ui_runtime',
});

const applied = bus.execute({
  request: buildRequest(applyCommand),
  toolName: focusRoutePair.applyToolName,
});
if (applied.kind !== 'apply') throw new Error('Expected focus UI runtime bridge apply result.');
if (applied.apply.provenance.acceptedDryRunPlanId !== dryRun.dryRun.dryRunResult.mergePlan.planId) {
  throw new Error('Focus UI runtime bridge did not preserve accepted dry-run plan ID.');
}

const outputHash = new Bun.CryptoHasher('sha256')
  .update(new Uint8Array(applied.apply.outputPixels.buffer))
  .digest('hex');
const sourceHashes = frames.map((frame) =>
  new Bun.CryptoHasher('sha256').update(new Uint8Array(frame.pixels.buffer)).digest('hex'),
);
if (sourceHashes.includes(outputHash))
  throw new Error('Expected focus UI runtime output to differ from source frames.');
if (applied.apply.sidecarArtifact.haloReview === undefined) {
  throw new Error('Focus sidecar artifact must persist halo review metadata.');
}
if (applied.apply.sidecarArtifact.haloReview.reviewStatus !== 'review_required') {
  throw new Error(
    `Expected review_required halo status, got ${applied.apply.sidecarArtifact.haloReview.reviewStatus}.`,
  );
}
const outputReview = buildFocusStackOutputReviewFromArtifact(applied.apply.sidecarArtifact);
if (outputReview.editableHandoff.artifactHash !== applied.apply.sidecarArtifact.outputArtifact.contentHash) {
  throw new Error('Focus output review did not preserve editable artifact hash.');
}
if (
  outputReview.editableHandoff.exportReviewArtifactId !==
  `${applied.apply.sidecarArtifact.outputArtifact.artifactId}:export-review`
) {
  throw new Error('Focus output review did not preserve export review handoff id.');
}
if (outputReview.haloReview.transitionRiskRegions.length !== cells.length) {
  throw new Error(
    `Expected ${cells.length} transition regions, got ${outputReview.haloReview.transitionRiskRegions.length}.`,
  );
}
if (outputReview.reviewOverlay.sourceContributionDetails.length !== frames.length) {
  throw new Error('Focus output review must expose one source contribution detail per input source.');
}
for (const source of outputReview.reviewOverlay.sourceContributionDetails) {
  if (source.confidencePercent < 62 || source.confidencePercent > 100) {
    throw new Error(`Focus source ${source.sourceId} has invalid confidence ${source.confidencePercent}.`);
  }
  if (source.coverageCellCount < 1) {
    throw new Error(`Focus source ${source.sourceId} must expose positive coverage cell count.`);
  }
}
if (dryRunCommand.parameters.haloSuppressionStrengthPercent !== 80) {
  throw new Error('Focus UI runtime bridge did not preserve dry-run halo suppression.');
}
if (applyCommand.parameters.haloSuppressionStrengthPercent !== 80) {
  throw new Error('Focus UI runtime bridge did not preserve apply halo suppression.');
}

expectThrows('mismatched accepted focus UI runtime plan', () =>
  bus.execute({
    request: buildRequest({
      ...applyCommand,
      parameters: {
        ...applyCommand.parameters,
        acceptedDryRunPlanHash: 'sha256:not-the-accepted-plan',
      },
    }),
    toolName: focusRoutePair.applyToolName,
  }),
);

const result = {
  fixture: 'synthetic_focus_ui_runtime_bridge_v1',
  focusCoverageRatio: applied.apply.provenance.focusCoverageRatio,
  haloReviewStatus: outputReview.haloReview.reviewStatus,
  haloRiskCellRatio: outputReview.haloRiskCellRatio,
  outputSha256: outputHash,
  planId: dryRun.dryRun.dryRunResult.mergePlan.planId,
};
if (process.argv.includes('--verbose')) {
  console.log(JSON.stringify(result, null, 2));
} else {
  console.log(`focus UI runtime bridge ok (coverage=${result.focusCoverageRatio})`);
}

function buildRequest(command) {
  return {
    cells,
    command,
    depthConfidenceArtifactId: 'artifact_focus_ui_runtime_depth_confidence',
    frames,
    outputArtifactId: 'artifact_focus_ui_runtime_output',
    previewArtifactId: 'artifact_focus_ui_runtime_preview',
    retouchLayerArtifactId: 'artifact_focus_ui_runtime_retouch',
    sharpnessMapArtifactId: 'artifact_focus_ui_runtime_sharpness',
  };
}

function createFocusFrame(sourceIndex) {
  const pixels = new Float32Array(WIDTH * HEIGHT);
  for (let y = 0; y < HEIGHT; y += 1) {
    for (let x = 0; x < WIDTH; x += 1) {
      const localPattern = ((x * 7 + y * 11 + sourceIndex * 19) % 31) / 255;
      const sourceRegion = sourceRegions.find((region) => x >= region.x && x < region.x + region.width);
      const focusBoost = sourceRegion?.sourceIndex === sourceIndex ? 0.72 : 0.08;
      pixels[y * WIDTH + x] = Math.min(1, 0.12 + localPattern + focusBoost);
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
