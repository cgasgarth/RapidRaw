#!/usr/bin/env bun

import { PanoramaAppServerRuntimeToolBusV1 } from '../../../packages/rawengine-schema/src/panoramaAppServerRuntime.ts';
import {
  buildPanoramaUiApplyCommandV1,
  buildPanoramaUiDryRunCommandV1,
} from '../../../packages/rawengine-schema/src/panoramaUiControls.ts';
import { sampleComputationalMergeAppServerToolManifestV1 } from '../../../packages/rawengine-schema/src/samplePayloads.ts';
import { COMPUTATIONAL_PROOF_MEMORY_BUDGET_BYTES } from '../../../scripts/lib/computational/proof-budgets.ts';
import { getComputationalMergeAppServerRoutePairSummary } from '../../../src/utils/computationalMergeAppServerRoutePairs.ts';

const panoramaRoutePair = getComputationalMergeAppServerRoutePairSummary('panorama');
const sourceFrames = [
  { expectedOffsetX: 0, expectedOffsetY: 0, sourceIndex: 0 },
  { expectedOffsetX: 48, expectedOffsetY: 2, sourceIndex: 1 },
  { expectedOffsetX: 96, expectedOffsetY: -1, sourceIndex: 2 },
].map((frame) => ({
  ...frame,
  contentHash: `sha256:panorama-ui-runtime-${frame.sourceIndex}`,
  graphRevision: 'graph_rev_panorama_ui_runtime_source',
  height: 48,
  width: 72,
}));

const controls = {
  blendMode: 'multi_band',
  boundaryMode: 'auto_crop',
  exposureMode: 'gain_compensation',
  lensCorrectionPolicy: 'required_before_stitch',
  maxPreviewDimensionPx: 1200,
  memoryBudgetBytes: COMPUTATIONAL_PROOF_MEMORY_BUDGET_BYTES,
  outputName: 'Synthetic UI Runtime Panorama',
  projection: 'cylindrical',
  qualityPreference: 'balanced',
  sources: sourceFrames.map((frame) => ({
    colorSpaceHint: 'camera_rgb',
    exposureEv: frame.sourceIndex === 1 ? 0.8 : 0,
    imageId: `img_panorama_ui_runtime_${frame.sourceIndex}`,
    imagePath: `/synthetic/panorama/ui-runtime-${frame.sourceIndex}.dng`,
    sourceIndex: frame.sourceIndex,
  })),
};

const dryRunCommand = buildPanoramaUiDryRunCommandV1(controls, {
  commandId: 'command_panorama_ui_runtime_dry_run',
  correlationId: 'corr_panorama_ui_runtime',
  expectedGraphRevision: 'graph_rev_panorama_ui_runtime',
  targetId: 'project_panorama_ui_runtime',
});

const bus = new PanoramaAppServerRuntimeToolBusV1(sampleComputationalMergeAppServerToolManifestV1);
const dryRun = bus.execute({
  request: buildRequest(dryRunCommand),
  toolName: panoramaRoutePair.dryRunToolName,
});
if (dryRun.kind !== 'dry_run') throw new Error('Expected panorama UI runtime bridge dry-run result.');
const reducedSeamExposureCommand = buildPanoramaUiDryRunCommandV1(
  { ...controls, seamExposureCompensationPercent: 40 },
  {
    commandId: 'command_panorama_ui_runtime_reduced_seam_exposure',
    correlationId: 'corr_panorama_ui_runtime_reduced_seam_exposure',
    expectedGraphRevision: 'graph_rev_panorama_ui_runtime',
    targetId: 'project_panorama_ui_runtime',
  },
);
const reducedSeamExposureDryRun = bus.execute({
  request: buildRequest(reducedSeamExposureCommand),
  toolName: panoramaRoutePair.dryRunToolName,
});
if (reducedSeamExposureDryRun.kind !== 'dry_run') {
  throw new Error('Expected reduced seam exposure panorama dry-run result.');
}
const fullCompensationHash = hashPixels(dryRun.dryRun.outputPixels);
const reducedCompensationHash = hashPixels(reducedSeamExposureDryRun.dryRun.outputPixels);
if (fullCompensationHash === reducedCompensationHash) {
  throw new Error('Panorama seam exposure compensation strength did not change output pixels.');
}
if (reducedSeamExposureDryRun.dryRun.provenance.exposureNormalizationResult.compensationStrengthPercent !== 40) {
  throw new Error('Panorama seam exposure compensation strength was not preserved in provenance.');
}

const manualCropCommand = buildPanoramaUiDryRunCommandV1(
  {
    ...controls,
    boundaryMode: 'manual_crop',
    manualCropInsetsPercent: {
      bottom: 10,
      left: 8,
      right: 12,
      top: 6,
    },
    overlapFeatherPx: 128,
  },
  {
    commandId: 'command_panorama_ui_runtime_manual_crop',
    correlationId: 'corr_panorama_ui_runtime_manual_crop',
    expectedGraphRevision: 'graph_rev_panorama_ui_runtime',
    targetId: 'project_panorama_ui_runtime',
  },
);
const manualCropDryRun = bus.execute({
  request: buildRequest(manualCropCommand),
  toolName: panoramaRoutePair.dryRunToolName,
});
if (manualCropDryRun.kind !== 'dry_run') {
  throw new Error('Expected manual crop panorama dry-run result.');
}
const manualCropOutput = manualCropDryRun.dryRun.dryRunResult.mergePlan.outputDimensions;
const baseOutput = dryRun.dryRun.dryRunResult.mergePlan.outputDimensions;
if (manualCropOutput.width >= baseOutput.width || manualCropOutput.height >= baseOutput.height) {
  throw new Error('Panorama manual crop did not reduce rendered output dimensions.');
}
if (manualCropDryRun.dryRun.provenance.crop.mode !== 'manual') {
  throw new Error('Panorama manual crop was not preserved in provenance.');
}
if (manualCropDryRun.dryRun.provenance.seamBlend.overlapFeatherPx !== 128) {
  throw new Error('Panorama overlap feather was not preserved in provenance.');
}
if (hashPixels(manualCropDryRun.dryRun.outputPixels) === fullCompensationHash) {
  throw new Error('Panorama manual crop did not change rendered output pixels.');
}

const applyCommand = buildPanoramaUiApplyCommandV1(controls, {
  acceptedDryRunPlanHash: dryRun.acceptedDryRunPlanHash,
  acceptedDryRunPlanId: dryRun.dryRun.dryRunResult.mergePlan.planId,
  commandId: 'command_panorama_ui_runtime_apply',
  correlationId: 'corr_panorama_ui_runtime_apply',
  expectedGraphRevision: 'graph_rev_panorama_ui_runtime',
  idempotencyKey: 'idem_panorama_ui_runtime_apply',
  targetId: 'project_panorama_ui_runtime',
});

const applied = bus.execute({
  request: buildRequest(applyCommand),
  toolName: panoramaRoutePair.applyToolName,
});
if (applied.kind !== 'apply') throw new Error('Expected panorama UI runtime bridge apply result.');
if (applied.apply.outputPixels.length <= sourceFrames[0].width * sourceFrames[0].height * 3) {
  throw new Error('Expected panorama UI runtime output to be wider than one source frame.');
}
if (applied.apply.provenance.acceptedDryRunPlanId !== dryRun.dryRun.dryRunResult.mergePlan.planId) {
  throw new Error('Panorama UI runtime bridge did not preserve accepted dry-run plan ID.');
}
if (applied.apply.provenance.projectionSettings.effectiveProjection !== 'cylindrical') {
  throw new Error('Panorama UI runtime bridge must report cylindrical effective projection.');
}
if (applied.apply.provenance.projectionSettings.support !== 'implemented_current_engine') {
  throw new Error('Panorama UI runtime bridge must report implemented cylindrical support.');
}
if (applied.apply.provenance.boundaryMode !== 'auto_crop') {
  throw new Error('Panorama UI runtime bridge must preserve auto-crop boundary mode.');
}

expectThrows('mismatched accepted panorama UI runtime plan', () =>
  bus.execute({
    request: buildRequest({
      ...applyCommand,
      parameters: {
        ...applyCommand.parameters,
        acceptedDryRunPlanHash: 'sha256:not-the-accepted-plan',
      },
    }),
    toolName: panoramaRoutePair.applyToolName,
  }),
);

const result = {
  fixture: 'synthetic_panorama_ui_runtime_bridge_v1',
  fullCompensationHash,
  manualCropOutput,
  output: dryRun.dryRun.dryRunResult.mergePlan.outputDimensions,
  outputSha256: hashPixels(applied.apply.outputPixels),
  planId: dryRun.dryRun.dryRunResult.mergePlan.planId,
  reducedCompensationHash,
};
if (process.argv.includes('--verbose')) {
  console.log(JSON.stringify(result, null, 2));
} else {
  console.log(`panorama UI runtime bridge ok (${result.output.width}x${result.output.height})`);
}

function buildRequest(command) {
  return {
    command,
    connectedSourceIndices: [0, 1, 2],
    outputArtifactId: 'artifact_panorama_ui_runtime_output',
    previewArtifactId: 'artifact_panorama_ui_runtime_preview',
    seed: 'rawengine-panorama-ui-runtime-v1',
    sourceFrames,
  };
}

function hashPixels(pixels: Uint8Array) {
  return new Bun.CryptoHasher('sha256').update(pixels).digest('hex');
}

function expectThrows(label, callback) {
  try {
    callback();
  } catch {
    return;
  }
  throw new Error(`Expected ${label} to throw.`);
}
