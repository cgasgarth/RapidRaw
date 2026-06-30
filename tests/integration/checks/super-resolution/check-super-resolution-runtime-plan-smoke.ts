#!/usr/bin/env bun

import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  ApprovalClass,
  RAW_ENGINE_SCHEMA_VERSION,
} from '../../../../packages/rawengine-schema/src/rawEngineSchemas.ts';
import {
  calculateMeanAbsoluteErrorV1,
  createNearestNeighborBaselineV1,
} from '../../../../packages/rawengine-schema/src/super-resolution/superResolutionPixelShift.ts';
import {
  applySuperResolutionRuntimePlanV1,
  buildSuperResolutionRuntimeDryRunV1,
} from '../../../../packages/rawengine-schema/src/super-resolution/superResolutionRuntimePlan.ts';

const SCALE = 2;
const LOW_WIDTH = 48;
const LOW_HEIGHT = 32;
const HIGH_WIDTH = LOW_WIDTH * SCALE;
const HIGH_HEIGHT = LOW_HEIGHT * SCALE;
const MIN_IMPROVEMENT_RATIO = 0.65;
const OUTPUT_DIR = resolve('artifacts/super-resolution-runtime-plan-smoke');
const REPORT_PATH = resolve(OUTPUT_DIR, 'super-resolution-runtime-plan-smoke-report.json');

const sourceFrameDefs = [
  { shiftX: 0, shiftY: 0, sourceIndex: 0 },
  { shiftX: 1, shiftY: 0, sourceIndex: 1 },
  { shiftX: 0, shiftY: 1, sourceIndex: 2 },
  { shiftX: 1, shiftY: 1, sourceIndex: 3 },
];
const truth = createHighResolutionTruth();
const frames = sourceFrameDefs.map((frame) => ({
  contentHash: `sha256:sr-runtime-source-${frame.sourceIndex}`,
  graphRevision: 'graph_rev_sr_runtime_source',
  height: LOW_HEIGHT,
  pixels: downsamplePixelShiftFrame(truth, frame.shiftX, frame.shiftY),
  shiftX: frame.shiftX,
  shiftY: frame.shiftY,
  sourceIndex: frame.sourceIndex,
  width: LOW_WIDTH,
}));

const dryRunCommand = {
  actor: { id: 'agent_rawengine', kind: 'agent' },
  approval: {
    approvalClass: ApprovalClass.PreviewOnly,
    reason: 'Super-resolution runtime smoke validates non-mutating dry-run rendering.',
    state: 'not_required',
  },
  commandId: 'command_sr_runtime_plan_smoke',
  commandType: 'computationalMerge.createSuperResolution',
  correlationId: 'corr_sr_runtime_plan_smoke',
  dryRun: true,
  expectedGraphRevision: 'graph_rev_sr_runtime',
  parameters: {
    alignmentMode: 'translation',
    detailPolicy: 'conservative',
    maxPreviewDimensionPx: 1200,
    mode: 'multi_image',
    outputName: 'Synthetic Runtime Super Resolution',
    outputScale: SCALE,
    qualityPreference: 'best',
    sources: frames.map((frame) => ({
      colorSpaceHint: 'camera_rgb',
      exposureEv: 0,
      imageId: `img_sr_runtime_${frame.sourceIndex}`,
      imagePath: `/synthetic/sr/runtime-${frame.sourceIndex}.dng`,
      rawDefaultsApplied: true,
      role: 'sr_frame',
      sourceIndex: frame.sourceIndex,
    })),
  },
  schemaVersion: RAW_ENGINE_SCHEMA_VERSION,
  target: { id: 'project_sr_runtime', kind: 'project' },
};

const dryRun = buildSuperResolutionRuntimeDryRunV1({
  command: dryRunCommand,
  confidenceMapArtifactId: 'artifact_sr_runtime_confidence',
  frames,
  outputArtifactId: 'artifact_sr_runtime_output',
  previewArtifactId: 'artifact_sr_runtime_preview',
});

const applyCommand = {
  ...dryRunCommand,
  approval: {
    approvalClass: ApprovalClass.EditApply,
    reason: 'Super-resolution runtime smoke applies accepted dry-run plan.',
    state: 'approved',
  },
  commandId: 'command_sr_runtime_apply_smoke',
  correlationId: 'corr_sr_runtime_apply_smoke',
  dryRun: false,
  parameters: {
    ...dryRunCommand.parameters,
    acceptedDryRunPlanHash: `sha256:${dryRun.dryRunResult.mergePlan.planId}`,
    acceptedDryRunPlanId: dryRun.dryRunResult.mergePlan.planId,
  },
};

const applied = applySuperResolutionRuntimePlanV1({
  command: applyCommand,
  confidenceMapArtifactId: 'artifact_sr_runtime_confidence',
  frames,
  outputArtifactId: 'artifact_sr_runtime_output',
  previewArtifactId: 'artifact_sr_runtime_preview',
});

assertEqual(applied.provenance.runtimeStatus, 'apply_rendered', 'apply runtime status');
assertEqual(applied.provenance.acceptedDryRunPlanId, dryRun.dryRunResult.mergePlan.planId, 'accepted plan id');
assertEqual(applied.provenance.effectiveOutputScale, SCALE, 'effective output scale');
assertEqual(
  applied.provenance.alignmentDiagnostics.algorithmId,
  'declared_pixel_shift_lattice_diagnostics_v1',
  'alignment algorithm',
);
assertEqual(applied.provenance.alignmentDiagnostics.status, 'complete_declared_lattice', 'alignment status');
assertEqual(applied.provenance.alignmentDiagnostics.confidence, 1, 'alignment confidence');
assertEqual(applied.provenance.alignmentDiagnostics.phaseCoverageRatio, 1, 'alignment phase coverage');
assertEqual(
  applied.provenance.alignmentDiagnostics.uniqueShiftPhaseCount,
  sourceFrameDefs.length,
  'unique shift phases',
);
assertEqual(applied.provenance.alignmentDiagnostics.geometryConsistent, true, 'alignment geometry consistency');
assertEqual(applied.provenance.confidenceMap.completeSampleRatio, 1, 'complete sample ratio');
assertEqual(applied.provenance.confidenceMap.minSampleCount, 1, 'minimum sample count');
assertEqual(applied.provenance.confidenceMap.maxSampleCount, 1, 'maximum sample count');
assertEqual(applied.provenance.detailQuality.outputPixelCount, HIGH_WIDTH * HIGH_HEIGHT, 'detail output pixels');
assertEqual(
  applied.provenance.reconstructionDiagnostics.algorithmId,
  'integer_pixel_shift_interleave_x2_v1',
  'reconstruction algorithm',
);
assertEqual(applied.provenance.reconstructionDiagnostics.status, 'accepted', 'reconstruction status');
assertEqual(applied.provenance.reconstructionDiagnostics.filledPixelRatio, 1, 'reconstruction filled ratio');
assertEqual(applied.provenance.reconstructionDiagnostics.finiteOutputRatio, 1, 'reconstruction finite ratio');
assertEqual(applied.provenance.reconstructionDiagnostics.missingPixelCount, 0, 'reconstruction missing pixels');
assertEqual(
  applied.provenance.reconstructionDiagnostics.duplicateSamplePixelCount,
  0,
  'reconstruction duplicate sample pixels',
);
assertEqual(
  applied.provenance.reconstructionDiagnostics.averageSamplesPerOutputPixel,
  1,
  'reconstruction average samples',
);
assertEqual(
  applied.provenance.detailQuality.sourcePixelCount,
  LOW_WIDTH * LOW_HEIGHT * frames.length,
  'detail source pixels',
);
assertEqual(applied.provenance.frameRegistrations.length, sourceFrameDefs.length, 'frame registration count');
const artifactIds = applied.mutationResult.outputArtifacts.map((artifact) => artifact.artifactId).sort();
assertDeepEqual(artifactIds, ['artifact_sr_runtime_confidence', 'artifact_sr_runtime_output'], 'SR output artifacts');
const [outputArtifact] = applied.mutationResult.outputArtifacts;
if (outputArtifact?.contentHash === undefined) {
  throw new Error('Expected SR output artifact to include a rendered content hash.');
}

const nearestBaseline = createNearestNeighborBaselineV1(frames[0].pixels, LOW_WIDTH, LOW_HEIGHT, SCALE);
const baselineMae = calculateMeanAbsoluteErrorV1(nearestBaseline, truth);
const srMae = calculateMeanAbsoluteErrorV1(applied.outputPixels, truth);
const improvementRatio = (baselineMae - srMae) / baselineMae;
if (improvementRatio < MIN_IMPROVEMENT_RATIO) {
  throw new Error(`Expected SR improvement ratio >= ${MIN_IMPROVEMENT_RATIO}, got ${improvementRatio}.`);
}

const result = {
  acceptedDryRunPlanId: applied.provenance.acceptedDryRunPlanId,
  alignmentDiagnostics: applied.provenance.alignmentDiagnostics,
  artifactCount: applied.mutationResult.outputArtifacts.length,
  fixture: 'synthetic_sr_runtime_plan_v1',
  frameRegistrations: applied.provenance.frameRegistrations,
  quality: {
    confidenceMap: applied.provenance.confidenceMap,
    detailQuality: applied.provenance.detailQuality,
    reconstructionDiagnostics: applied.provenance.reconstructionDiagnostics,
  },
  improvementRatio,
  outputArtifactContentHash: outputArtifact.contentHash,
  performanceEstimate: dryRun.dryRunResult.mergePlan.performanceEstimate,
  outputSha256: new Bun.CryptoHasher('sha256').update(new Uint8Array(applied.outputPixels.buffer)).digest('hex'),
  outputSize: dryRun.dryRunResult.mergePlan.outputDimensions,
  runtimeStatus: applied.provenance.runtimeStatus,
};
await mkdir(OUTPUT_DIR, { recursive: true });
await writeFile(REPORT_PATH, `${JSON.stringify(result, null, 2)}\n`);

if (process.argv.includes('--verbose')) {
  console.log(JSON.stringify(result, null, 2));
} else {
  console.log(
    `SR runtime plan ok (${result.outputSize.width}x${result.outputSize.height}, improvement=${result.improvementRatio.toFixed(3)})`,
  );
}

function createHighResolutionTruth() {
  const pixels = new Float32Array(HIGH_WIDTH * HIGH_HEIGHT);
  for (let y = 0; y < HIGH_HEIGHT; y += 1) {
    for (let x = 0; x < HIGH_WIDTH; x += 1) {
      const nx = x / (HIGH_WIDTH - 1);
      const ny = y / (HIGH_HEIGHT - 1);
      const slantedEdge = nx + ny * 0.42 > 0.78 ? 0.82 : 0.18;
      const linePair = (Math.floor(x / 2) + Math.floor(y / 3)) % 2 === 0 ? 0.12 : -0.08;
      const radial = Math.sin((x * x + y * y) * 0.013) * 0.05;
      pixels[y * HIGH_WIDTH + x] = Math.max(0, Math.min(1, slantedEdge + linePair + radial));
    }
  }
  return pixels;
}

function downsamplePixelShiftFrame(truthPixels, shiftX, shiftY) {
  const pixels = new Float32Array(LOW_WIDTH * LOW_HEIGHT);
  for (let y = 0; y < LOW_HEIGHT; y += 1) {
    for (let x = 0; x < LOW_WIDTH; x += 1) {
      const sourceX = x * SCALE + shiftX;
      const sourceY = y * SCALE + shiftY;
      pixels[y * LOW_WIDTH + x] = truthPixels[sourceY * HIGH_WIDTH + sourceX] ?? 0;
    }
  }
  return pixels;
}

function assertEqual(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${expected}, got ${actual}.`);
  }
}

function assertDeepEqual(actual, expected, label) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}.`);
  }
}
