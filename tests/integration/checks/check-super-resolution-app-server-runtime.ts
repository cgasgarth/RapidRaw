#!/usr/bin/env bun

import { z } from 'zod';
import { ApprovalClass, RAW_ENGINE_SCHEMA_VERSION } from '../../../packages/rawengine-schema/src/rawEngineSchemas.ts';
import { sampleComputationalMergeAppServerToolManifestV1 } from '../../../packages/rawengine-schema/src/samplePayloads.ts';
import { SuperResolutionAppServerRuntimeToolBusV1 } from '../../../packages/rawengine-schema/src/superResolutionAppServerRuntime.ts';
import {
  calculateMeanAbsoluteErrorV1,
  createNearestNeighborBaselineV1,
} from '../../../packages/rawengine-schema/src/superResolutionPixelShift.ts';
import { getComputationalMergeAppServerRoutePairSummary } from '../../../src/utils/computational-merge/computationalMergeAppServerRoutePairs.ts';

const superResolutionRoutePair = getComputationalMergeAppServerRoutePairSummary('super_resolution');
const SCALE = 2;
const LOW_WIDTH = 24;
const LOW_HEIGHT = 18;
const HIGH_WIDTH = LOW_WIDTH * SCALE;
const HIGH_HEIGHT = LOW_HEIGHT * SCALE;
const srSupportMapDryRunTranscriptSchema = z
  .object({
    downgradeReason: z.string().trim().min(1).optional(),
    effectiveScale: z.number().min(1).max(4),
    mutates: z.literal(false),
    planId: z.string().trim().min(1),
    requestedScale: z.number().min(1.1).max(4),
    reviewStatus: z.enum(['apply_ready', 'blocked', 'review_required']),
    scenario: z.enum(['blocked_apply', 'downgraded_scale', 'supported', 'weak_support']),
    supportMapArtifactId: z.string().trim().min(1),
    warnings: z.array(z.string().trim().min(1)),
    weakSupportRatio: z.number().min(0).max(1),
  })
  .strict();

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
const supportedTranscript = buildSupportMapDryRunTranscript('supported', dryRun);
if (
  supportedTranscript.effectiveScale !== SCALE ||
  supportedTranscript.requestedScale !== SCALE ||
  supportedTranscript.reviewStatus !== 'apply_ready' ||
  supportedTranscript.weakSupportRatio !== 0
) {
  throw new Error(`Unexpected supported SR dry-run transcript: ${JSON.stringify(supportedTranscript)}.`);
}

const downgradedDryRunCommand = {
  ...dryRunCommand,
  commandId: 'command_sr_app_server_runtime_downgraded',
  parameters: {
    ...dryRunCommand.parameters,
    outputScale: 4,
  },
};
const downgradedDryRun = bus.execute({
  request: buildRequest(downgradedDryRunCommand),
  toolName: superResolutionRoutePair.dryRunToolName,
});
if (downgradedDryRun.kind !== 'dry_run') throw new Error('Expected downgraded dry-run dispatch result.');
const downgradedTranscript = buildSupportMapDryRunTranscript('downgraded_scale', downgradedDryRun);
if (
  downgradedTranscript.downgradeReason !== 'effective_scale_downgraded' ||
  downgradedTranscript.effectiveScale !== SCALE ||
  downgradedTranscript.requestedScale !== 4 ||
  downgradedTranscript.reviewStatus !== 'review_required'
) {
  throw new Error(`Unexpected downgraded SR dry-run transcript: ${JSON.stringify(downgradedTranscript)}.`);
}

const weakSupportFrames = frames.slice(0, 2);
const weakSupportDryRunCommand = {
  ...dryRunCommand,
  commandId: 'command_sr_app_server_runtime_weak_support',
  parameters: {
    ...dryRunCommand.parameters,
    sources: dryRunCommand.parameters.sources.slice(0, weakSupportFrames.length),
  },
};
const weakSupportDryRun = bus.execute({
  request: buildRequest(weakSupportDryRunCommand, weakSupportFrames),
  toolName: superResolutionRoutePair.dryRunToolName,
});
if (weakSupportDryRun.kind !== 'dry_run') throw new Error('Expected weak-support dry-run dispatch result.');
const weakSupportTranscript = buildSupportMapDryRunTranscript('weak_support', weakSupportDryRun);
if (
  weakSupportTranscript.reviewStatus !== 'blocked' ||
  !weakSupportTranscript.warnings.includes('support_map_blocked') ||
  weakSupportTranscript.weakSupportRatio <= 0.25
) {
  throw new Error(`Unexpected weak-support SR dry-run transcript: ${JSON.stringify(weakSupportTranscript)}.`);
}

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
srSupportMapDryRunTranscriptSchema.parse({
  ...supportedTranscript,
  reviewStatus: 'blocked',
  scenario: 'blocked_apply',
  warnings: [...supportedTranscript.warnings, 'apply_rejected_without_accepted_plan'],
});

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
  supportMapScenarios: [
    supportedTranscript.scenario,
    downgradedTranscript.scenario,
    weakSupportTranscript.scenario,
    'blocked_apply',
  ],
  outputSha256: new Bun.CryptoHasher('sha256').update(new Uint8Array(applied.apply.outputPixels.buffer)).digest('hex'),
  planId: dryRun.dryRun.dryRunResult.mergePlan.planId,
};
if (process.argv.includes('--verbose')) {
  console.log(JSON.stringify(result, null, 2));
} else {
  console.log(`SR app-server runtime ok (improvement=${result.improvementRatio.toFixed(3)})`);
}

function buildRequest(command, requestFrames = frames) {
  return {
    command,
    confidenceMapArtifactId: `artifact_${command.commandId}_support_map`,
    frames: requestFrames,
    outputArtifactId: 'artifact_sr_app_server_runtime_output',
    previewArtifactId: 'artifact_sr_app_server_runtime_preview',
  };
}

function buildSupportMapDryRunTranscript(scenario, toolResult) {
  if (toolResult.kind !== 'dry_run') throw new Error(`Expected ${scenario} SR support-map dry-run.`);
  const { provenance } = toolResult.dryRun;
  const supportMap = provenance.supportMap;
  return srSupportMapDryRunTranscriptSchema.parse({
    ...(supportMap.downgradeReason === undefined ? {} : { downgradeReason: supportMap.downgradeReason }),
    effectiveScale: supportMap.effectiveScale,
    mutates: false,
    planId: toolResult.dryRun.dryRunResult.mergePlan.planId,
    requestedScale: supportMap.requestedScale,
    reviewStatus: supportMap.reviewStatus,
    scenario,
    supportMapArtifactId: supportMap.artifactId,
    warnings: toolResult.dryRun.dryRunResult.warnings,
    weakSupportRatio: supportMap.weakSupportRatio,
  });
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
