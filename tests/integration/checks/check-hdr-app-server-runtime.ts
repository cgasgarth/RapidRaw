#!/usr/bin/env bun

import { HdrAppServerRuntimeToolBusV1 } from '../../../packages/rawengine-schema/src/hdrAppServerRuntime.ts';
import { ApprovalClass, RAW_ENGINE_SCHEMA_VERSION } from '../../../packages/rawengine-schema/src/rawEngineSchemas.ts';
import { sampleComputationalMergeAppServerToolManifestV1 } from '../../../packages/rawengine-schema/src/samplePayloads.ts';
import { getComputationalMergeAppServerRoutePairSummary } from '../../../src/utils/computationalMergeAppServerRoutePairs.ts';

const hdrRoutePair = getComputationalMergeAppServerRoutePairSummary('hdr');
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

console.log(
  JSON.stringify({
    alignmentConfidence: applied.apply.provenance.alignmentConfidence,
    fixture: 'synthetic_hdr_app_server_runtime_v1',
    motionCoverageRatio: applied.apply.provenance.motionCoverageRatio,
    outputSha256: new Bun.CryptoHasher('sha256')
      .update(new Uint8Array(applied.apply.mergedPixels.buffer))
      .digest('hex'),
    planId: dryRun.dryRun.dryRunResult.mergePlan.planId,
  }),
);

function buildRequest(command) {
  return {
    clipThreshold: 0.99,
    command,
    frames,
    motionThreshold: 0.03,
    outputArtifactId: 'artifact_hdr_app_server_runtime_output',
    previewArtifactId: 'artifact_hdr_app_server_runtime_preview',
    searchRadiusPx: 5,
    sensorWhiteRadiance: 1,
  };
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
