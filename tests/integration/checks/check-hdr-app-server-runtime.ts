#!/usr/bin/env bun

import { z } from 'zod';

import { HdrAppServerRuntimeToolBusV1 } from '../../../packages/rawengine-schema/src/hdrAppServerRuntime.ts';
import { ApprovalClass, RAW_ENGINE_SCHEMA_VERSION } from '../../../packages/rawengine-schema/src/rawEngineSchemas.ts';
import { sampleComputationalMergeAppServerToolManifestV1 } from '../../../packages/rawengine-schema/src/samplePayloads.ts';
import { getComputationalMergeAppServerRoutePairSummary } from '../../../src/utils/computationalMergeAppServerRoutePairs.ts';

const hdrRoutePair = getComputationalMergeAppServerRoutePairSummary('hdr');
const hdrDerivedSourceDryRunTranscriptSchema = z
  .object({
    blockCodes: z.array(z.string().trim().min(1)),
    bracketReadiness: z.enum(['accepted', 'blocked', 'warning']),
    displayPreviewArtifactId: z.string().trim().min(1),
    exportPreviewArtifactId: z.string().trim().min(1),
    mutates: z.literal(false),
    reviewStatus: z.enum(['apply_ready', 'blocked', 'review_required']),
    scenario: z.enum(['blocked_apply', 'blocked_bracket', 'ready', 'warning_motion']),
    sceneLinearArtifactId: z.string().trim().min(1),
    warningCodes: z.array(z.string().trim().min(1)),
  })
  .strict();
const WIDTH = 48;
const HEIGHT = 36;
const BRACKETS = [
  { exposureEv: -2, shiftX: 1, shiftY: -1, sourceIndex: 0 },
  { exposureEv: 0, shiftX: 0, shiftY: 0, sourceIndex: 1 },
  { exposureEv: 2, shiftX: -2, shiftY: 1, sourceIndex: 2 },
];
const scene = createScene(WIDTH, HEIGHT);
const frames = BRACKETS.map((bracket) => ({
  contentHash: `sha256:hdr-app-server-runtime-${bracket.sourceIndex}`,
  exposureEv: bracket.exposureEv,
  graphRevision: 'graph_rev_hdr_app_server_runtime_source',
  height: HEIGHT,
  pixels: shift(renderBracket(scene, bracket.exposureEv), WIDTH, HEIGHT, bracket.shiftX, bracket.shiftY),
  sourceIndex: bracket.sourceIndex,
  width: WIDTH,
}));

const dryRunCommand = {
  actor: { id: 'agent_rawengine', kind: 'agent' },
  approval: {
    approvalClass: ApprovalClass.PreviewOnly,
    reason: 'HDR app-server runtime smoke validates dry-run dispatch.',
    state: 'not_required',
  },
  commandId: 'command_hdr_app_server_runtime',
  commandType: 'computationalMerge.createHdr',
  correlationId: 'corr_hdr_app_server_runtime',
  dryRun: true,
  expectedGraphRevision: 'graph_rev_hdr_app_server_runtime',
  parameters: {
    alignmentMode: 'translation',
    bracketValidation: 'required',
    deghosting: 'medium',
    maxPreviewDimensionPx: 1200,
    mergeStrategy: 'scene_linear_radiance',
    outputName: 'Synthetic App Server Runtime HDR',
    qualityPreference: 'balanced',
    sources: BRACKETS.map((bracket) => ({
      colorSpaceHint: 'camera_rgb',
      exposureEv: bracket.exposureEv,
      imageId: `img_hdr_app_server_runtime_${bracket.sourceIndex}`,
      imagePath: `/synthetic/hdr/app-server-runtime-${bracket.sourceIndex}.dng`,
      rawDefaultsApplied: true,
      role: 'hdr_bracket',
      sourceIndex: bracket.sourceIndex,
    })),
    toneMapPreview: true,
  },
  schemaVersion: RAW_ENGINE_SCHEMA_VERSION,
  target: { id: 'project_hdr_app_server_runtime', kind: 'project' },
};

const bus = new HdrAppServerRuntimeToolBusV1(sampleComputationalMergeAppServerToolManifestV1);
const dryRun = bus.execute({
  request: buildRequest(dryRunCommand),
  toolName: hdrRoutePair.dryRunToolName,
});
if (dryRun.kind !== 'dry_run') throw new Error('Expected HDR dry-run dispatch result.');
const warningTranscript = buildDerivedSourceTranscript('warning_motion', dryRun);
if (
  warningTranscript.reviewStatus !== 'review_required' ||
  !warningTranscript.warningCodes.includes('motion_detected') ||
  !warningTranscript.warningCodes.includes('tone_mapped_preview_only')
) {
  throw new Error(`Unexpected warning HDR dry-run transcript: ${JSON.stringify(warningTranscript)}.`);
}
assertPreviewArtifactHandle(dryRun, warningTranscript.sceneLinearArtifactId);
assertPreviewArtifactHandle(dryRun, warningTranscript.displayPreviewArtifactId);
assertPreviewArtifactHandle(dryRun, warningTranscript.exportPreviewArtifactId);

const readyCommand = {
  ...dryRunCommand,
  commandId: 'command_hdr_app_server_runtime_ready',
  correlationId: 'corr_hdr_app_server_runtime_ready',
  parameters: {
    ...dryRunCommand.parameters,
    deghosting: 'off',
    toneMapPreview: false,
  },
};
const readyDryRun = bus.execute({
  request: buildRequest(readyCommand, frames, 1_000_000_000),
  toolName: hdrRoutePair.dryRunToolName,
});
if (readyDryRun.kind !== 'dry_run') throw new Error('Expected ready HDR dry-run dispatch result.');
const readyTranscript = buildDerivedSourceTranscript('ready', readyDryRun);
if (readyTranscript.reviewStatus !== 'apply_ready' || readyTranscript.warningCodes.length !== 0) {
  throw new Error(`Unexpected ready HDR dry-run transcript: ${JSON.stringify(readyTranscript)}.`);
}

const narrowExposureValues = [-0.2, 0, 0.2];
const narrowSources = dryRunCommand.parameters.sources.map((source, index) => ({
  ...source,
  exposureEv: narrowExposureValues[index] ?? 0,
}));
const narrowFrames = frames.map((frame, index) => ({
  ...frame,
  exposureEv: narrowExposureValues[index] ?? 0,
}));
const blockedCommand = {
  ...dryRunCommand,
  commandId: 'command_hdr_app_server_runtime_blocked',
  correlationId: 'corr_hdr_app_server_runtime_blocked',
  parameters: {
    ...dryRunCommand.parameters,
    sources: narrowSources,
  },
};
const blockedBus = new HdrAppServerRuntimeToolBusV1(sampleComputationalMergeAppServerToolManifestV1);
const blockedDryRun = blockedBus.execute({
  request: buildRequest(blockedCommand, narrowFrames),
  toolName: hdrRoutePair.dryRunToolName,
});
if (blockedDryRun.kind !== 'dry_run') throw new Error('Expected blocked HDR dry-run dispatch result.');
const blockedTranscript = buildDerivedSourceTranscript('blocked_bracket', blockedDryRun);
if (
  blockedTranscript.reviewStatus !== 'blocked' ||
  blockedTranscript.bracketReadiness !== 'blocked' ||
  !blockedTranscript.blockCodes.includes('not_a_bracket')
) {
  throw new Error(`Unexpected blocked HDR dry-run transcript: ${JSON.stringify(blockedTranscript)}.`);
}

const applyCommand = {
  ...dryRunCommand,
  approval: {
    approvalClass: ApprovalClass.EditApply,
    reason: 'HDR app-server runtime smoke applies accepted plan.',
    state: 'approved',
  },
  commandId: 'command_hdr_app_server_runtime_apply',
  correlationId: 'corr_hdr_app_server_runtime_apply',
  dryRun: false,
  parameters: {
    ...dryRunCommand.parameters,
    acceptedDryRunPlanHash: dryRun.acceptedDryRunPlanHash,
    acceptedDryRunPlanId: dryRun.dryRun.dryRunResult.mergePlan.planId,
  },
};
const applied = bus.execute({
  request: buildRequest(applyCommand),
  toolName: hdrRoutePair.applyToolName,
});
if (applied.kind !== 'apply') throw new Error('Expected HDR apply dispatch result.');
if (applied.apply.provenance.alignmentConfidence < 0.99) {
  throw new Error(`Expected alignment confidence >= 0.99, got ${applied.apply.provenance.alignmentConfidence}.`);
}

expectThrows('unaccepted HDR apply plan', () =>
  new HdrAppServerRuntimeToolBusV1(sampleComputationalMergeAppServerToolManifestV1).execute({
    request: buildRequest(applyCommand),
    toolName: hdrRoutePair.applyToolName,
  }),
);
expectThrows('blocked HDR derived-source apply', () =>
  blockedBus.execute({
    request: buildRequest(
      {
        ...blockedCommand,
        approval: {
          approvalClass: ApprovalClass.EditApply,
          reason: 'HDR blocked derived-source review must not apply.',
          state: 'approved',
        },
        dryRun: false,
        parameters: {
          ...blockedCommand.parameters,
          acceptedDryRunPlanHash: blockedDryRun.acceptedDryRunPlanHash,
          acceptedDryRunPlanId: blockedDryRun.dryRun.dryRunResult.mergePlan.planId,
        },
      },
      narrowFrames,
    ),
    toolName: hdrRoutePair.applyToolName,
  }),
);
hdrDerivedSourceDryRunTranscriptSchema.parse({
  ...blockedTranscript,
  scenario: 'blocked_apply',
});

console.log(
  JSON.stringify({
    alignmentConfidence: applied.apply.provenance.alignmentConfidence,
    fixture: 'synthetic_hdr_app_server_runtime_v1',
    motionCoverageRatio: applied.apply.provenance.motionCoverageRatio,
    outputSha256: new Bun.CryptoHasher('sha256')
      .update(new Uint8Array(applied.apply.mergedPixels.buffer))
      .digest('hex'),
    planId: dryRun.dryRun.dryRunResult.mergePlan.planId,
    reviewScenarios: [
      readyTranscript.scenario,
      warningTranscript.scenario,
      blockedTranscript.scenario,
      'blocked_apply',
    ],
  }),
);

function buildRequest(command, requestFrames = frames, requestMotionThreshold = 0.03) {
  return {
    clipThreshold: 0.99,
    command,
    frames: requestFrames,
    motionThreshold: requestMotionThreshold,
    outputArtifactId: 'artifact_hdr_app_server_runtime_output',
    previewArtifactId: 'artifact_hdr_app_server_runtime_preview',
    searchRadiusPx: 5,
    sensorWhiteRadiance: 1,
  };
}

function buildDerivedSourceTranscript(scenario, toolResult) {
  if (toolResult.kind !== 'dry_run') throw new Error(`Expected ${scenario} HDR dry-run.`);
  const review = toolResult.dryRun.provenance.derivedSourceReview;
  return hdrDerivedSourceDryRunTranscriptSchema.parse({
    blockCodes: review.blockCodes,
    bracketReadiness: review.bracketReadiness,
    displayPreviewArtifactId: review.displayPreviewArtifact.artifactId,
    exportPreviewArtifactId: review.exportPreviewArtifact.artifactId,
    mutates: toolResult.dryRun.dryRunResult.mutates,
    reviewStatus: review.reviewStatus,
    scenario,
    sceneLinearArtifactId: review.sceneLinearArtifact.artifactId,
    warningCodes: review.warningCodes,
  });
}

function assertPreviewArtifactHandle(toolResult, artifactId) {
  if (toolResult.kind !== 'dry_run') throw new Error('Expected dry-run artifact handle source.');
  if (!toolResult.dryRun.dryRunResult.previewArtifacts.some((artifact) => artifact.artifactId === artifactId)) {
    throw new Error(`Expected HDR dry-run preview artifacts to include ${artifactId}.`);
  }
}

function createScene(width, height) {
  const pixels = new Float64Array(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      pixels[y * width + x] = 0.03 + (x / (width - 1)) * 0.11 + (x > 25 && y > 10 && y < 22 ? 0.14 : 0);
    }
  }
  return pixels;
}

function renderBracket(scenePixels, exposureEv) {
  const pixels = new Float64Array(scenePixels.length);
  for (let index = 0; index < scenePixels.length; index += 1) {
    pixels[index] = Math.min(1, (scenePixels[index] ?? 0) * 2 ** exposureEv);
  }
  return pixels;
}

function shift(image, width, height, shiftX, shiftY) {
  const shifted = new Float64Array(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const sourceX = x - shiftX;
      const sourceY = y - shiftY;
      if (sourceX >= 0 && sourceX < width && sourceY >= 0 && sourceY < height) {
        shifted[y * width + x] = image[sourceY * width + sourceX] ?? 0;
      }
    }
  }
  return shifted;
}

function expectThrows(label, callback) {
  try {
    callback();
  } catch {
    return;
  }
  throw new Error(`Expected ${label} to throw.`);
}
