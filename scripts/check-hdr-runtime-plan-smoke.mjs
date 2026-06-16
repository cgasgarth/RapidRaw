#!/usr/bin/env bun

import { ApprovalClass, RAW_ENGINE_SCHEMA_VERSION } from '../packages/rawengine-schema/src/rawEngineSchemas.ts';
import { applyHdrRuntimePlanV1, buildHdrRuntimeDryRunV1 } from '../packages/rawengine-schema/src/hdrRuntimePlan.ts';

const WIDTH = 64;
const HEIGHT = 48;
const SENSOR_WHITE_RADIANCE = 1;
const CLIP_THRESHOLD = 0.99;
const MOTION_THRESHOLD = 0.03;
const SEARCH_RADIUS_PX = 5;
const BRACKETS = [
  { exposureEv: -2, shiftX: 2, shiftY: -1, sourceIndex: 0 },
  { exposureEv: 0, shiftX: 0, shiftY: 0, sourceIndex: 1 },
  { exposureEv: 2, shiftX: -3, shiftY: 2, sourceIndex: 2 },
];

const scene = createSyntheticRadianceScene(WIDTH, HEIGHT);
const frames = BRACKETS.map((bracket) => ({
  contentHash: `sha256:hdr-runtime-source-${bracket.sourceIndex}`,
  exposureEv: bracket.exposureEv,
  graphRevision: 'graph_rev_hdr_runtime_source',
  height: HEIGHT,
  pixels: shiftImage(renderBracket(scene, bracket.exposureEv), WIDTH, HEIGHT, bracket.shiftX, bracket.shiftY),
  sourceIndex: bracket.sourceIndex,
  width: WIDTH,
}));

const dryRunCommand = {
  actor: { id: 'agent_rawengine', kind: 'agent' },
  approval: {
    approvalClass: ApprovalClass.PreviewOnly,
    reason: 'HDR runtime smoke validates non-mutating dry-run rendering.',
    state: 'not_required',
  },
  commandId: 'command_hdr_runtime_plan_smoke',
  commandType: 'computationalMerge.createHdr',
  correlationId: 'corr_hdr_runtime_plan_smoke',
  dryRun: true,
  expectedGraphRevision: 'graph_rev_hdr_runtime',
  parameters: {
    alignmentMode: 'translation',
    bracketValidation: 'required',
    deghosting: 'medium',
    maxPreviewDimensionPx: 1200,
    mergeStrategy: 'scene_linear_radiance',
    outputName: 'Synthetic Runtime HDR',
    qualityPreference: 'balanced',
    sources: BRACKETS.map((bracket) => ({
      colorSpaceHint: 'camera_rgb',
      exposureEv: bracket.exposureEv,
      imageId: `img_hdr_runtime_${bracket.sourceIndex}`,
      imagePath: `/synthetic/hdr/runtime-${bracket.sourceIndex}.dng`,
      rawDefaultsApplied: true,
      role: 'hdr_bracket',
      sourceIndex: bracket.sourceIndex,
    })),
    toneMapPreview: true,
  },
  schemaVersion: RAW_ENGINE_SCHEMA_VERSION,
  target: { id: 'project_hdr_runtime', kind: 'project' },
};

const dryRun = buildHdrRuntimeDryRunV1({
  clipThreshold: CLIP_THRESHOLD,
  command: dryRunCommand,
  frames,
  motionThreshold: MOTION_THRESHOLD,
  outputArtifactId: 'artifact_hdr_runtime_output',
  previewArtifactId: 'artifact_hdr_runtime_preview',
  searchRadiusPx: SEARCH_RADIUS_PX,
  sensorWhiteRadiance: SENSOR_WHITE_RADIANCE,
});

const applyCommand = {
  ...dryRunCommand,
  approval: {
    approvalClass: ApprovalClass.EditApply,
    reason: 'HDR runtime smoke applies accepted dry-run plan.',
    state: 'approved',
  },
  commandId: 'command_hdr_runtime_apply_smoke',
  correlationId: 'corr_hdr_runtime_apply_smoke',
  dryRun: false,
  parameters: {
    ...dryRunCommand.parameters,
    acceptedDryRunPlanHash: `sha256:${dryRun.dryRunResult.mergePlan.planId}`,
    acceptedDryRunPlanId: dryRun.dryRunResult.mergePlan.planId,
  },
};

const applied = applyHdrRuntimePlanV1({
  clipThreshold: CLIP_THRESHOLD,
  command: applyCommand,
  frames,
  motionThreshold: MOTION_THRESHOLD,
  outputArtifactId: 'artifact_hdr_runtime_output',
  previewArtifactId: 'artifact_hdr_runtime_preview',
  searchRadiusPx: SEARCH_RADIUS_PX,
  sensorWhiteRadiance: SENSOR_WHITE_RADIANCE,
});

assertEqual(dryRun.provenance.alignmentMode, 'translation', 'dry-run alignment mode');
assertEqual(dryRun.provenance.deghosting, 'medium', 'dry-run deghosting');
assertEqual(applied.provenance.runtimeStatus, 'apply_rendered', 'apply runtime status');
assertEqual(applied.provenance.acceptedDryRunPlanId, dryRun.dryRunResult.mergePlan.planId, 'accepted dry-run plan id');

if (dryRun.provenance.alignmentConfidence < 0.99) {
  throw new Error(`Expected alignment confidence >= 0.99, got ${dryRun.provenance.alignmentConfidence}.`);
}

if (dryRun.provenance.motionCoverageRatio <= 0) {
  throw new Error('Expected moving-subject fixture to produce a non-empty deghost mask.');
}

if (applied.mergedPixels.length !== WIDTH * HEIGHT) {
  throw new Error('Expected applied HDR runtime output dimensions to match fixture.');
}

console.log(
  JSON.stringify(
    {
      acceptedDryRunPlanId: applied.provenance.acceptedDryRunPlanId,
      alignmentConfidence: dryRun.provenance.alignmentConfidence,
      fixture: 'synthetic_hdr_runtime_plan_v1',
      motionCoverageRatio: dryRun.provenance.motionCoverageRatio,
      outputSha256: new Bun.CryptoHasher('sha256').update(new Uint8Array(applied.mergedPixels.buffer)).digest('hex'),
    },
    null,
    2,
  ),
);

function createSyntheticRadianceScene(width, height) {
  const pixels = new Float64Array(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const gradient = 0.03 + (x / (width - 1)) * 0.11;
      const windowHighlight = isInsideRectangle(x, y, 39, 8, 18, 15) ? 0.07 : 0;
      const movingSubject = isInsideRectangle(x, y, 25, 20, 9, 10) ? 0.18 : 0;
      pixels[getPixelIndex(x, y, width)] = gradient + windowHighlight + movingSubject;
    }
  }
  return pixels;
}

function renderBracket(scene, exposureEv) {
  const exposureScale = 2 ** exposureEv;
  const pixels = new Float64Array(scene.length);
  for (let index = 0; index < scene.length; index += 1) {
    pixels[index] = Math.min(1, ((scene[index] ?? 0) * exposureScale) / SENSOR_WHITE_RADIANCE);
  }
  return pixels;
}

function shiftImage(image, width, height, shiftX, shiftY) {
  const shifted = new Float64Array(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const sourceX = x - shiftX;
      const sourceY = y - shiftY;
      if (sourceX >= 0 && sourceX < width && sourceY >= 0 && sourceY < height) {
        shifted[getPixelIndex(x, y, width)] = image[getPixelIndex(sourceX, sourceY, width)] ?? 0;
      }
    }
  }
  return shifted;
}

function isInsideRectangle(x, y, left, top, width, height) {
  return x >= left && x < left + width && y >= top && y < top + height;
}

function getPixelIndex(x, y, width) {
  return y * width + x;
}

function assertEqual(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${expected}, got ${actual}.`);
  }
}
