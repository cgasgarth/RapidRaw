#!/usr/bin/env bun

import {
  applyFocusStackRuntimePlanV1,
  buildFocusStackRuntimeDryRunV1,
} from '../packages/rawengine-schema/src/focusStackRuntimePlan.ts';
import { ApprovalClass, RAW_ENGINE_SCHEMA_VERSION } from '../packages/rawengine-schema/src/rawEngineSchemas.ts';

const WIDTH = 72;
const HEIGHT = 48;
const sourceRegions = [
  { height: HEIGHT, sourceIndex: 0, width: 24, x: 0, y: 0 },
  { height: HEIGHT, sourceIndex: 1, width: 24, x: 24, y: 0 },
  { height: HEIGHT, sourceIndex: 2, width: 24, x: 48, y: 0 },
];

const frames = [0, 1, 2].map((sourceIndex) => ({
  contentHash: `sha256:focus-runtime-source-${sourceIndex}`,
  focusDistanceMm: 180 + sourceIndex * 60,
  graphRevision: 'graph_rev_focus_runtime_source',
  height: HEIGHT,
  pixels: createFocusFrame(sourceIndex),
  sourceIndex,
  translationX: 0,
  translationY: 0,
  width: WIDTH,
}));

const cells = sourceRegions.map((region) => ({
  height: region.height,
  lowConfidence: false,
  sourceScores: [0, 1, 2].map((sourceIndex) => ({
    relativeConfidence: sourceIndex === region.sourceIndex ? 1 : 0.01,
    sourceIndex,
  })),
  width: region.width,
  x: region.x,
  y: region.y,
}));

const dryRunCommand = {
  actor: { id: 'agent_rawengine', kind: 'agent' },
  approval: {
    approvalClass: ApprovalClass.PreviewOnly,
    reason: 'Focus stack runtime smoke validates non-mutating dry-run rendering.',
    state: 'not_required',
  },
  commandId: 'command_focus_runtime_plan_smoke',
  commandType: 'computationalMerge.createFocusStack',
  correlationId: 'corr_focus_runtime_plan_smoke',
  dryRun: true,
  expectedGraphRevision: 'graph_rev_focus_runtime',
  parameters: {
    alignmentMode: 'translation',
    blendMethod: 'weighted_sharpness',
    maxPreviewDimensionPx: 1200,
    memoryBudgetBytes: 64_000_000,
    outputName: 'Synthetic Runtime Focus Stack',
    qualityPreference: 'best',
    retouchLayerPolicy: 'generate_retouch_layer',
    sources: frames.map((frame) => ({
      colorSpaceHint: 'camera_rgb',
      focusDistanceMm: frame.focusDistanceMm,
      imageId: `img_focus_runtime_${frame.sourceIndex}`,
      imagePath: `/synthetic/focus/runtime-${frame.sourceIndex}.dng`,
      rawDefaultsApplied: true,
      role: 'focus_slice',
      sourceIndex: frame.sourceIndex,
    })),
  },
  schemaVersion: RAW_ENGINE_SCHEMA_VERSION,
  target: { id: 'project_focus_runtime', kind: 'project' },
};

const dryRun = buildFocusStackRuntimeDryRunV1({
  cells,
  command: dryRunCommand,
  depthConfidenceArtifactId: 'artifact_focus_runtime_depth_confidence',
  frames,
  outputArtifactId: 'artifact_focus_runtime_output',
  previewArtifactId: 'artifact_focus_runtime_preview',
  retouchLayerArtifactId: 'artifact_focus_runtime_retouch',
  sharpnessMapArtifactId: 'artifact_focus_runtime_sharpness',
});

const applyCommand = {
  ...dryRunCommand,
  approval: {
    approvalClass: ApprovalClass.EditApply,
    reason: 'Focus stack runtime smoke applies accepted dry-run plan.',
    state: 'approved',
  },
  commandId: 'command_focus_runtime_apply_smoke',
  correlationId: 'corr_focus_runtime_apply_smoke',
  dryRun: false,
  parameters: {
    ...dryRunCommand.parameters,
    acceptedDryRunPlanHash: `sha256:${dryRun.dryRunResult.mergePlan.planId}`,
    acceptedDryRunPlanId: dryRun.dryRunResult.mergePlan.planId,
  },
};

const applied = applyFocusStackRuntimePlanV1({
  cells,
  command: applyCommand,
  depthConfidenceArtifactId: 'artifact_focus_runtime_depth_confidence',
  frames,
  outputArtifactId: 'artifact_focus_runtime_output',
  previewArtifactId: 'artifact_focus_runtime_preview',
  retouchLayerArtifactId: 'artifact_focus_runtime_retouch',
  sharpnessMapArtifactId: 'artifact_focus_runtime_sharpness',
});

assertEqual(dryRun.provenance.focusCoverageRatio, 1, 'focus coverage');
assertEqual(applied.provenance.runtimeStatus, 'apply_rendered', 'apply runtime status');
assertEqual(applied.provenance.acceptedDryRunPlanId, dryRun.dryRunResult.mergePlan.planId, 'accepted plan id');

const outputHash = new Bun.CryptoHasher('sha256').update(new Uint8Array(applied.outputPixels.buffer)).digest('hex');
const sourceHashes = frames.map((frame) =>
  new Bun.CryptoHasher('sha256').update(new Uint8Array(frame.pixels.buffer)).digest('hex'),
);
if (sourceHashes.includes(outputHash)) {
  throw new Error('Expected focus stack output to differ from every source frame.');
}

console.log(
  JSON.stringify(
    {
      acceptedDryRunPlanId: applied.provenance.acceptedDryRunPlanId,
      fixture: 'synthetic_focus_runtime_plan_v1',
      focusCoverageRatio: dryRun.provenance.focusCoverageRatio,
      outputSha256: outputHash,
      warnings: dryRun.dryRunResult.warnings,
    },
    null,
    2,
  ),
);

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

function assertEqual(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${expected}, got ${actual}.`);
  }
}
