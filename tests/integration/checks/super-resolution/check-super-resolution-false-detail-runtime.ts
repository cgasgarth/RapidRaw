#!/usr/bin/env bun

import {
  ApprovalClass,
  RAW_ENGINE_SCHEMA_VERSION,
} from '../../../../packages/rawengine-schema/src/rawEngineSchemas.ts';
import { sampleComputationalMergeAppServerToolManifestV1 } from '../../../../packages/rawengine-schema/src/samplePayloads.ts';
import { SuperResolutionAppServerRuntimeToolBusV1 } from '../../../../packages/rawengine-schema/src/super-resolution/superResolutionAppServerRuntime.ts';
import { getComputationalMergeAppServerRoutePairSummary } from '../../../../src/utils/computational-merge/computationalMergeAppServerRoutePairs.ts';
import { buildSuperResolutionOutputReviewFromArtifact } from '../../../../src/utils/superResolutionOutputReview.ts';

const superResolutionRoutePair = getComputationalMergeAppServerRoutePairSummary('super_resolution');
const SCALE = 2;
const LOW_WIDTH = 24;
const LOW_HEIGHT = 18;
const HIGH_WIDTH = LOW_WIDTH * SCALE;
const HIGH_HEIGHT = LOW_HEIGHT * SCALE;

const truth = createTruth();
const frames = [
  { noise: 0, shiftX: 0, shiftY: 0, sourceIndex: 0 },
  { noise: 0.25, shiftX: 1, shiftY: 0, sourceIndex: 1 },
  { noise: 0.25, shiftX: 0, shiftY: 1, sourceIndex: 2 },
  { noise: 0.25, shiftX: 1, shiftY: 1, sourceIndex: 3 },
].map((frame) => ({
  contentHash: `sha256:sr-false-detail-${frame.sourceIndex}`,
  graphRevision: 'graph_rev_sr_false_detail_source',
  height: LOW_HEIGHT,
  pixels: downsample(truth, frame.shiftX, frame.shiftY, frame.noise),
  shiftX: frame.shiftX,
  shiftY: frame.shiftY,
  sourceIndex: frame.sourceIndex,
  width: LOW_WIDTH,
}));

const command = {
  actor: { id: 'agent_rawengine', kind: 'agent' },
  approval: {
    approvalClass: ApprovalClass.PreviewOnly,
    reason: 'Super-resolution false-detail runtime check validates measured review gating.',
    state: 'not_required',
  },
  commandId: 'command_sr_false_detail_runtime',
  commandType: 'computationalMerge.createSuperResolution',
  correlationId: 'corr_sr_false_detail_runtime',
  dryRun: true,
  expectedGraphRevision: 'graph_rev_sr_false_detail_runtime',
  parameters: {
    alignmentMode: 'translation',
    detailPolicy: 'conservative',
    maxPreviewDimensionPx: 1200,
    mode: 'multi_image',
    outputName: 'Synthetic False Detail Runtime SR',
    outputScale: SCALE,
    qualityPreference: 'best',
    reconstructionMode: 'model_detail',
    sources: frames.map((frame) => ({
      colorSpaceHint: 'camera_rgb',
      exposureEv: 0,
      imageId: `img_sr_false_detail_${frame.sourceIndex}`,
      imagePath: `/synthetic/sr/false-detail-${frame.sourceIndex}.dng`,
      rawDefaultsApplied: true,
      role: 'sr_frame',
      sourceIndex: frame.sourceIndex,
    })),
  },
  schemaVersion: RAW_ENGINE_SCHEMA_VERSION,
  target: { id: 'project_sr_false_detail_runtime', kind: 'project' },
};

const bus = new SuperResolutionAppServerRuntimeToolBusV1(sampleComputationalMergeAppServerToolManifestV1);
const dryRun = bus.execute({
  request: buildRequest(command),
  toolName: superResolutionRoutePair.dryRunToolName,
});
if (dryRun.kind !== 'dry_run') throw new Error('Expected false-detail dry-run result.');
if (dryRun.dryRun.provenance.measuredReview.falseDetailRisk !== 'high') {
  throw new Error(`Expected high false-detail risk, got ${dryRun.dryRun.provenance.measuredReview.falseDetailRisk}.`);
}
if (!dryRun.dryRun.dryRunResult.warnings.includes('texture_risk')) {
  throw new Error('Expected false-detail dry-run to include texture_risk warning.');
}

const applyCommand = {
  ...command,
  approval: {
    approvalClass: ApprovalClass.EditApply,
    reason: 'Super-resolution false-detail runtime check applies the accepted dry-run.',
    state: 'approved',
  },
  commandId: 'command_sr_false_detail_runtime_apply',
  correlationId: 'corr_sr_false_detail_runtime_apply',
  dryRun: false,
  parameters: {
    ...command.parameters,
    acceptedDryRunPlanHash: dryRun.acceptedDryRunPlanHash,
    acceptedDryRunPlanId: dryRun.dryRun.dryRunResult.mergePlan.planId,
  },
};
const applied = bus.execute({
  request: buildRequest(applyCommand),
  toolName: superResolutionRoutePair.applyToolName,
});
if (applied.kind !== 'apply') throw new Error('Expected false-detail apply result.');
const outputReview = buildSuperResolutionOutputReviewFromArtifact(applied.apply.sidecarArtifact);
if (outputReview.decision !== 'blocked') {
  throw new Error(`Expected blocked false-detail output review, got ${outputReview.decision}.`);
}
if (outputReview.falseDetailRisk !== 'high') {
  throw new Error(`Expected high false-detail output review, got ${outputReview.falseDetailRisk}.`);
}
if (outputReview.detailReview.reviewStatus !== 'rejected') {
  throw new Error(`Expected rejected false-detail review regions, got ${outputReview.detailReview.reviewStatus}.`);
}
if (!outputReview.detailReview.regions.every((region) => region.reviewStatus === 'rejected')) {
  throw new Error('Expected every false-detail review region to reject the pathological reconstruction.');
}
if (outputReview.falseDetailRiskScore === null || outputReview.falseDetailRiskScore < 0.5) {
  throw new Error(`Expected elevated false-detail risk score, got ${outputReview.falseDetailRiskScore}.`);
}

const result = {
  detailGainRatio: applied.apply.sidecarArtifact.measuredReview?.detailGainRatio,
  downscaleReconstructionError: applied.apply.sidecarArtifact.measuredReview?.downscaleReconstructionError,
  falseDetailRisk: outputReview.falseDetailRisk,
  falseDetailRiskScore: outputReview.falseDetailRiskScore,
  outputHeight: HIGH_HEIGHT,
  outputWidth: HIGH_WIDTH,
};
if (process.argv.includes('--verbose')) {
  console.log(JSON.stringify(result, null, 2));
} else {
  console.log(
    `SR false-detail runtime ok (risk=${outputReview.falseDetailRisk}, score=${outputReview.falseDetailRiskScore?.toFixed(2)})`,
  );
}

function buildRequest(command: typeof applyCommand | typeof command) {
  return {
    command,
    confidenceMapArtifactId: `artifact_${command.commandId}_support_map`,
    frames,
    outputArtifactId: 'artifact_sr_false_detail_runtime_output',
    previewArtifactId: 'artifact_sr_false_detail_runtime_preview',
  };
}

function createTruth(): Float32Array {
  const truth = new Float32Array(LOW_WIDTH * SCALE * LOW_HEIGHT * SCALE);
  const width = LOW_WIDTH * SCALE;
  const height = LOW_HEIGHT * SCALE;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      truth[y * width + x] = Math.min(1, 0.1 + x * 0.01 + y * 0.005 + ((x + y) % 2 === 0 ? 0 : 0.2));
    }
  }
  return truth;
}

function downsample(truthPixels: Float32Array, shiftX: number, shiftY: number, noise: number): Float32Array {
  const output = new Float32Array(LOW_WIDTH * LOW_HEIGHT);
  const truthWidth = LOW_WIDTH * SCALE;
  for (let y = 0; y < LOW_HEIGHT; y += 1) {
    for (let x = 0; x < LOW_WIDTH; x += 1) {
      let value = truthPixels[(y * SCALE + shiftY) * truthWidth + x * SCALE + shiftX] ?? 0;
      if (noise > 0) {
        value = Math.max(0, Math.min(1, value + (((x * 13 + y * 7) % 5) - 2) * noise));
      }
      output[y * LOW_WIDTH + x] = value;
    }
  }
  return output;
}
