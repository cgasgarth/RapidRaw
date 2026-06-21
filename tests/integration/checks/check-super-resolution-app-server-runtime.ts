#!/usr/bin/env bun

import { SuperResolutionAppServerRuntimeToolBusV1 } from '../../../packages/rawengine-schema/src/superResolutionAppServerRuntime.ts';
import {
  calculateMeanAbsoluteErrorV1,
  createNearestNeighborBaselineV1,
} from '../../../packages/rawengine-schema/src/superResolutionPixelShift.ts';
import { ApprovalClass, RAW_ENGINE_SCHEMA_VERSION } from '../../../packages/rawengine-schema/src/rawEngineSchemas.ts';
import { sampleComputationalMergeAppServerToolManifestV1 } from '../../../packages/rawengine-schema/src/samplePayloads.ts';
import { getComputationalMergeAppServerRoutePairSummary } from '../../../src/utils/computationalMergeAppServerRoutePairs.ts';

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
  contentHash: `sha256:sr-app-server-runtime-${frame.sourceIndex}`,
  graphRevision: 'graph_rev_sr_app_server_runtime_source',
  height: LOW_HEIGHT,
  pixels: downsample(truth, frame.shiftX, frame.shiftY),
  shiftX: frame.shiftX,
  shiftY: frame.shiftY,
  sourceIndex: frame.sourceIndex,
  width: LOW_WIDTH,
}));

const dryRunCommand = {
  actor: { id: 'agent_rawengine', kind: 'agent' },
  approval: {
    approvalClass: ApprovalClass.PreviewOnly,
    reason: 'Super-resolution app-server runtime smoke validates dry-run dispatch.',
    state: 'not_required',
  },
  commandId: 'command_sr_app_server_runtime',
  commandType: 'computationalMerge.createSuperResolution',
  correlationId: 'corr_sr_app_server_runtime',
  dryRun: true,
  expectedGraphRevision: 'graph_rev_sr_app_server_runtime',
  parameters: {
    alignmentMode: 'translation',
    detailPolicy: 'conservative',
    maxPreviewDimensionPx: 1200,
    mode: 'multi_image',
    outputName: 'Synthetic App Server Runtime SR',
    outputScale: SCALE,
    qualityPreference: 'best',
    sources: frames.map((frame) => ({
      colorSpaceHint: 'camera_rgb',
      exposureEv: 0,
      imageId: `img_sr_app_server_runtime_${frame.sourceIndex}`,
      imagePath: `/synthetic/sr/app-server-runtime-${frame.sourceIndex}.dng`,
      rawDefaultsApplied: true,
      role: 'sr_frame',
      sourceIndex: frame.sourceIndex,
    })),
  },
  schemaVersion: RAW_ENGINE_SCHEMA_VERSION,
  target: { id: 'project_sr_app_server_runtime', kind: 'project' },
};

const bus = new SuperResolutionAppServerRuntimeToolBusV1(sampleComputationalMergeAppServerToolManifestV1);
const dryRun = bus.execute({
  request: buildRequest(dryRunCommand),
  toolName: superResolutionRoutePair.dryRunToolName,
});
if (dryRun.kind !== 'dry_run') throw new Error('Expected dry-run dispatch result.');

const applyCommand = {
  ...dryRunCommand,
  approval: {
    approvalClass: ApprovalClass.EditApply,
    reason: 'Super-resolution app-server runtime smoke applies accepted plan.',
    state: 'approved',
  },
  commandId: 'command_sr_app_server_runtime_apply',
  correlationId: 'corr_sr_app_server_runtime_apply',
  dryRun: false,
  parameters: {
    ...dryRunCommand.parameters,
    acceptedDryRunPlanHash: dryRun.acceptedDryRunPlanHash,
    acceptedDryRunPlanId: dryRun.dryRun.dryRunResult.mergePlan.planId,
  },
};
const applied = bus.execute({
  request: buildRequest(applyCommand),
  toolName: superResolutionRoutePair.applyToolName,
});
if (applied.kind !== 'apply') throw new Error('Expected apply dispatch result.');
if (applied.apply.sidecarArtifact.validationSummary.humanReviewStatus !== 'pending') {
  throw new Error('Expected SR sidecar artifact to require pending human review.');
}
if (!applied.apply.sidecarArtifact.warningCodes.includes('human_review_required')) {
  throw new Error('Expected SR sidecar artifact to include human_review_required warning.');
}
if (applied.apply.sidecarArtifact.outputArtifact.contentHash === undefined) {
  throw new Error('Expected SR sidecar output artifact hash for review.');
}
if (applied.apply.sidecarArtifact.outputArtifact.dimensions?.width !== HIGH_WIDTH) {
  throw new Error('Expected SR sidecar output width to match rendered output.');
}

expectThrows('unaccepted apply plan', () =>
  new SuperResolutionAppServerRuntimeToolBusV1(sampleComputationalMergeAppServerToolManifestV1).execute({
    request: buildRequest(applyCommand),
    toolName: superResolutionRoutePair.applyToolName,
  }),
);

const nearestBaseline = createNearestNeighborBaselineV1(frames[0].pixels, LOW_WIDTH, LOW_HEIGHT, SCALE);
const improvementRatio =
  (calculateMeanAbsoluteErrorV1(nearestBaseline, truth) -
    calculateMeanAbsoluteErrorV1(applied.apply.outputPixels, truth)) /
  calculateMeanAbsoluteErrorV1(nearestBaseline, truth);
if (improvementRatio < 0.65) throw new Error(`Expected SR improvement ratio >= 0.65, got ${improvementRatio}.`);

const result = {
  fixture: 'synthetic_sr_app_server_runtime_v1',
  humanReviewStatus: applied.apply.sidecarArtifact.validationSummary.humanReviewStatus,
  improvementRatio,
  outputSha256: new Bun.CryptoHasher('sha256').update(new Uint8Array(applied.apply.outputPixels.buffer)).digest('hex'),
  planId: dryRun.dryRun.dryRunResult.mergePlan.planId,
};
if (process.argv.includes('--verbose')) {
  console.log(JSON.stringify(result, null, 2));
} else {
  console.log(`SR app-server runtime ok (improvement=${result.improvementRatio.toFixed(3)})`);
}

function buildRequest(command) {
  return {
    command,
    confidenceMapArtifactId: 'artifact_sr_app_server_runtime_confidence',
    frames,
    outputArtifactId: 'artifact_sr_app_server_runtime_output',
    previewArtifactId: 'artifact_sr_app_server_runtime_preview',
  };
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
