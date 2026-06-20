#!/usr/bin/env bun

import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';

import { format, resolveConfig } from 'prettier';
import { z } from 'zod';

import {
  applyFocusStackRuntimePlanV1,
  buildFocusStackRuntimeDryRunV1,
} from '../../../packages/rawengine-schema/src/focusStackRuntimePlan.ts';
import { ApprovalClass, RAW_ENGINE_SCHEMA_VERSION } from '../../../packages/rawengine-schema/src/rawEngineSchemas.ts';
import { COMPUTATIONAL_PROOF_MEMORY_BUDGET_BYTES } from '../../../scripts/lib/computational-proof-budgets.ts';

const REPORT_PATH = 'docs/validation/focus-blend-runtime-proof-2026-06-20.json';
const GENERATED_AT = '2026-06-20T00:00:00.000Z';
const WIDTH = 72;
const HEIGHT = 48;
const MAX_REGION_MAE = 0.035;

const regionSchema = z
  .object({
    expectedSourceIndex: z.number().int().nonnegative(),
    meanAbsoluteError: z.number().min(0).max(MAX_REGION_MAE),
    regionId: z.string().trim().min(1),
  })
  .strict();

const reportSchema = z
  .object({
    artifactCount: z.number().int().min(4),
    doesNotProve: z.array(z.enum(['real_raw_e2e', 'laplacian_pyramid_quality', 'ui_review_surface'])).min(1),
    focusCoverageRatio: z.literal(1),
    generatedAt: z.iso.datetime({ offset: true }),
    issue: z.literal(2355),
    outputHash: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
    regionMetrics: z.array(regionSchema).min(3),
    retouchLayerRecommended: z.literal(true),
    runtimeStatus: z.literal('apply_rendered'),
    schemaVersion: z.literal(1),
    validationMode: z.literal('synthetic_focus_blend_runtime_apply'),
  })
  .strict();

const update = process.argv.includes('--update');
const sourceRegions = [
  { expectedSourceIndex: 0, height: HEIGHT, regionId: 'foreground-left', width: 24, x: 0, y: 0 },
  { expectedSourceIndex: 1, height: HEIGHT, regionId: 'mid-plane-center', width: 24, x: 24, y: 0 },
  { expectedSourceIndex: 2, height: HEIGHT, regionId: 'background-right', width: 24, x: 48, y: 0 },
];
const frames = [0, 1, 2].map((sourceIndex) => ({
  contentHash: `sha256:focus-blend-source-${sourceIndex}`,
  focusDistanceMm: 180 + sourceIndex * 60,
  graphRevision: 'graph_rev_focus_blend_source',
  height: HEIGHT,
  pixels: createFocusFrame(sourceIndex),
  sourceIndex,
  translationX: sourceIndex === 0 ? 0 : sourceIndex,
  translationY: sourceIndex === 2 ? -1 : 0,
  width: WIDTH,
}));
const cells = sourceRegions.map((region) => ({
  height: region.height,
  lowConfidence: false,
  sourceScores: [0, 1, 2].map((sourceIndex) => ({
    relativeConfidence: sourceIndex === region.expectedSourceIndex ? 1 : 0.01,
    sourceIndex,
  })),
  width: region.width,
  x: region.x,
  y: region.y,
}));

const dryRunCommand = buildFocusCommand(true);
const dryRun = buildFocusStackRuntimeDryRunV1({
  cells,
  command: dryRunCommand,
  depthConfidenceArtifactId: 'artifact_focus_blend_depth_confidence',
  frames,
  outputArtifactId: 'artifact_focus_blend_output',
  previewArtifactId: 'artifact_focus_blend_preview',
  retouchLayerArtifactId: 'artifact_focus_blend_retouch',
  sharpnessMapArtifactId: 'artifact_focus_blend_sharpness',
});
const applied = applyFocusStackRuntimePlanV1({
  cells,
  command: {
    ...buildFocusCommand(false),
    parameters: {
      ...dryRunCommand.parameters,
      acceptedDryRunPlanHash: `sha256:${dryRun.dryRunResult.mergePlan.planId}`,
      acceptedDryRunPlanId: dryRun.dryRunResult.mergePlan.planId,
    },
  },
  depthConfidenceArtifactId: 'artifact_focus_blend_depth_confidence',
  frames,
  outputArtifactId: 'artifact_focus_blend_output',
  previewArtifactId: 'artifact_focus_blend_preview',
  retouchLayerArtifactId: 'artifact_focus_blend_retouch',
  sharpnessMapArtifactId: 'artifact_focus_blend_sharpness',
});

const regionMetrics = sourceRegions.map((region) =>
  regionSchema.parse({
    expectedSourceIndex: region.expectedSourceIndex,
    meanAbsoluteError: roundMetric(
      regionMeanAbsoluteError(applied.outputPixels, expectedFrameForRegion(region), region),
    ),
    regionId: region.regionId,
  }),
);
const report = reportSchema.parse({
  artifactCount: applied.mutationResult.outputArtifacts.length,
  doesNotProve: ['real_raw_e2e', 'laplacian_pyramid_quality', 'ui_review_surface'],
  focusCoverageRatio: dryRun.provenance.focusCoverageRatio,
  generatedAt: GENERATED_AT,
  issue: 2355,
  outputHash: hashFloat32(applied.outputPixels),
  regionMetrics,
  retouchLayerRecommended: applied.provenance.qualityMetrics.retouchLayerRecommended,
  runtimeStatus: applied.provenance.runtimeStatus,
  schemaVersion: 1,
  validationMode: 'synthetic_focus_blend_runtime_apply',
});
const reportJson = await format(JSON.stringify(report), {
  ...((await resolveConfig('package.json')) ?? {}),
  parser: 'json',
});

if (update) {
  await writeFile(REPORT_PATH, reportJson);
  console.log('focus blend runtime proof updated');
  process.exit(0);
}

if (!existsSync(REPORT_PATH)) {
  throw new Error(`Missing ${REPORT_PATH}; run bun run check:focus-blend-runtime-proof:update.`);
}

const expected = reportSchema.parse(JSON.parse(await readFile(REPORT_PATH, 'utf8')));
if (JSON.stringify(expected) !== JSON.stringify(report)) {
  throw new Error(`${REPORT_PATH} is stale; run bun run check:focus-blend-runtime-proof:update.`);
}

console.log(`focus blend runtime proof ok (${report.artifactCount} artifacts)`);

function buildFocusCommand(dryRun: boolean) {
  return {
    actor: { id: 'agent_rawengine', kind: 'agent' },
    approval: {
      approvalClass: dryRun ? ApprovalClass.PreviewOnly : ApprovalClass.EditApply,
      reason: dryRun ? 'Preview conservative focus blend.' : 'Apply accepted conservative focus blend.',
      state: dryRun ? 'not_required' : 'approved',
    },
    commandId: dryRun ? 'command_focus_blend_preview' : 'command_focus_blend_apply',
    commandType: 'computationalMerge.createFocusStack',
    correlationId: dryRun ? 'corr_focus_blend_preview' : 'corr_focus_blend_apply',
    dryRun,
    expectedGraphRevision: 'graph_rev_focus_blend',
    parameters: {
      alignmentMode: 'translation',
      blendMethod: 'weighted_sharpness',
      maxPreviewDimensionPx: 1200,
      memoryBudgetBytes: COMPUTATIONAL_PROOF_MEMORY_BUDGET_BYTES,
      outputName: 'Synthetic Conservative Focus Blend',
      qualityPreference: 'best',
      retouchLayerPolicy: 'generate_retouch_layer',
      sources: frames.map((frame) => ({
        colorSpaceHint: 'camera_rgb',
        focusDistanceMm: frame.focusDistanceMm,
        imageId: `img_focus_blend_${frame.sourceIndex}`,
        imagePath: `/synthetic/focus/blend-${frame.sourceIndex}.dng`,
        rawDefaultsApplied: true,
        role: 'focus_slice',
        sourceIndex: frame.sourceIndex,
      })),
    },
    schemaVersion: RAW_ENGINE_SCHEMA_VERSION,
    target: { id: 'project_focus_blend', kind: 'project' },
  };
}

function createFocusFrame(sourceIndex: number): Float32Array {
  const pixels = new Float32Array(WIDTH * HEIGHT);
  for (let y = 0; y < HEIGHT; y += 1) {
    for (let x = 0; x < WIDTH; x += 1) {
      const localPattern = ((x * 7 + y * 11 + sourceIndex * 19) % 31) / 255;
      const sourceRegion = sourceRegions.find((region) => x >= region.x && x < region.x + region.width);
      const focusBoost = sourceRegion?.expectedSourceIndex === sourceIndex ? 0.72 : 0.08;
      pixels[y * WIDTH + x] = Math.min(1, 0.12 + localPattern + focusBoost);
    }
  }
  return pixels;
}

function regionMeanAbsoluteError(
  outputPixels: Float32Array,
  expectedFrame: (typeof frames)[number],
  region: (typeof sourceRegions)[number],
): number {
  let total = 0;
  let count = 0;
  const referenceFrame = frames[0];
  if (referenceFrame === undefined) throw new Error('Focus blend proof requires a reference frame.');
  for (let y = region.y; y < region.y + region.height; y += 1) {
    for (let x = region.x; x < region.x + region.width; x += 1) {
      const expected = sampleAligned(expectedFrame, referenceFrame, x, y);
      if (expected === undefined) continue;
      total += Math.abs((outputPixels[y * WIDTH + x] ?? 0) - expected);
      count += 1;
    }
  }
  return total / Math.max(1, count);
}

function expectedFrameForRegion(region: (typeof sourceRegions)[number]): (typeof frames)[number] {
  const frame = frames.find((candidate) => candidate.sourceIndex === region.expectedSourceIndex);
  if (frame === undefined) {
    throw new Error(`Focus blend proof missing expected frame for region ${region.regionId}.`);
  }
  return frame;
}

function sampleAligned(frame: (typeof frames)[number], referenceFrame: (typeof frames)[number], x: number, y: number) {
  const sourceX = x - (referenceFrame.translationX - frame.translationX);
  const sourceY = y - (referenceFrame.translationY - frame.translationY);
  if (sourceX < 0 || sourceX >= frame.width || sourceY < 0 || sourceY >= frame.height) return undefined;
  return frame.pixels[sourceY * frame.width + sourceX];
}

function hashFloat32(pixels: Float32Array): string {
  return `sha256:${createHash('sha256').update(Buffer.from(pixels.buffer)).digest('hex')}`;
}

function roundMetric(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}
