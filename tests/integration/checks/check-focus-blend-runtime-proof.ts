#!/usr/bin/env bun

import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

import { format, resolveConfig } from 'prettier';
import { z } from 'zod';

import {
  applyFocusStackRuntimePlanV1,
  buildFocusStackRuntimeDryRunV1,
} from '../../../packages/rawengine-schema/src/focusStackRuntimePlan.ts';
import { ApprovalClass, RAW_ENGINE_SCHEMA_VERSION } from '../../../packages/rawengine-schema/src/rawEngineSchemas.ts';
import { COMPUTATIONAL_PROOF_MEMORY_BUDGET_BYTES } from '../../../scripts/lib/computational-proof-budgets.ts';

const REPORT_PATH = 'artifacts/validation/focus-blend-runtime-proof-2026-06-20.json';
const GENERATED_AT = '2026-06-20T00:00:00.000Z';
const WIDTH = 72;
const HEIGHT = 48;
const FALLBACK_HEIGHT = 8;
const MAX_REGION_MAE = 0.035;
const MIN_TRANSLATED_BORDER_VALUE = 0.15;
const REFERENCE_SOURCE_INDEX = 1;
const MAX_SEAM_BAND_P95_ERROR = 0.02;
const MAX_EXCESS_SEAM_GRADIENT = 0.001;

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
    diagnosticArtifacts: z
      .array(
        z
          .object({
            artifactId: z.string().trim().min(1),
            contentHash: z.string().regex(/^sha256:[a-f0-9]+$/u),
            diagnosticType: z.enum(['source_selection', 'focus_confidence', 'retouch_risk']),
            kind: z.literal('mask'),
          })
          .strict(),
      )
      .length(3),
    doesNotProve: z.array(z.enum(['real_raw_e2e', 'laplacian_pyramid_quality', 'ui_review_surface'])).min(1),
    fallbackMetrics: z
      .object({
        expectedFallbackPixelCount: z.number().int().positive(),
        meanAbsoluteError: z.number().min(0).max(0),
        observedFallbackPixelCount: z.number().int().positive(),
        referenceSourceIndex: z.literal(REFERENCE_SOURCE_INDEX),
      })
      .strict(),
    focusCoverageRatio: z.literal(1),
    generatedAt: z.iso.datetime({ offset: true }),
    generatedPatchArtifactCount: z.literal(0),
    issue: z.literal(2537),
    qualityMetrics: z
      .object({
        blackPixelCount: z.literal(0),
        dryRunApplyPixelsEqual: z.literal(true),
        excessSeamGradient: z.number().min(0).max(MAX_EXCESS_SEAM_GRADIENT),
        invalidSourceContributionCount: z.number().int().nonnegative(),
        nonfiniteOutputPixelCount: z.literal(0),
        seamBandP95Error: z.number().min(0).max(MAX_SEAM_BAND_P95_ERROR),
      })
      .strict(),
    outputHash: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
    referenceSource: z
      .object({
        fallbackPolicy: z.literal('low_confidence_or_invalid_contributors'),
        selectionReason: z.literal('explicit_request'),
        sourceIndex: z.literal(REFERENCE_SOURCE_INDEX),
      })
      .strict(),
    regionMetrics: z.array(regionSchema).min(3),
    retouchLayerRecommended: z.literal(true),
    retouchRiskArtifactCount: z.literal(1),
    runtimeStatus: z.literal('apply_rendered'),
    schemaVersion: z.literal(1),
    translatedBorderMetrics: z
      .object({
        minOutputValue: z.number().min(MIN_TRANSLATED_BORDER_VALUE),
        zeroPixelCount: z.literal(0),
      })
      .strict(),
    validationMode: z.literal('synthetic_focus_blend_runtime_apply'),
  })
  .strict();

const update = process.argv.includes('--update');
const sourceRegions = [
  { expectedSourceIndex: 0, height: HEIGHT - FALLBACK_HEIGHT, regionId: 'foreground-left', width: 24, x: 0, y: 0 },
  { expectedSourceIndex: 1, height: HEIGHT - FALLBACK_HEIGHT, regionId: 'mid-plane-center', width: 24, x: 24, y: 0 },
  { expectedSourceIndex: 2, height: HEIGHT - FALLBACK_HEIGHT, regionId: 'background-right', width: 24, x: 48, y: 0 },
];
const lowConfidenceFallbackRegion = {
  expectedSourceIndex: REFERENCE_SOURCE_INDEX,
  height: FALLBACK_HEIGHT,
  regionId: 'low-confidence-reference-fallback',
  width: WIDTH,
  x: 0,
  y: HEIGHT - FALLBACK_HEIGHT,
};
type ProofRegion = (typeof sourceRegions)[number] | typeof lowConfidenceFallbackRegion;
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
const cells = sourceRegions
  .map((region) => ({
    height: region.height,
    lowConfidence: false,
    sourceScores: [0, 1, 2].map((sourceIndex) => ({
      relativeConfidence: sourceIndex === region.expectedSourceIndex ? 1 : 0.01,
      sourceIndex,
    })),
    width: region.width,
    x: region.x,
    y: region.y,
  }))
  .concat({
    height: lowConfidenceFallbackRegion.height,
    lowConfidence: true,
    sourceScores: [0, 1, 2].map((sourceIndex) => ({
      relativeConfidence: sourceIndex === 2 ? 1 : 0.01,
      sourceIndex,
    })),
    width: lowConfidenceFallbackRegion.width,
    x: lowConfidenceFallbackRegion.x,
    y: lowConfidenceFallbackRegion.y,
  });

const dryRunCommand = buildFocusCommand(true);
const dryRun = buildFocusStackRuntimeDryRunV1({
  cells,
  command: dryRunCommand,
  depthConfidenceArtifactId: 'artifact_focus_blend_depth_confidence',
  frames,
  outputArtifactId: 'artifact_focus_blend_output',
  previewArtifactId: 'artifact_focus_blend_preview',
  referenceSourceIndex: REFERENCE_SOURCE_INDEX,
  retouchLayerArtifactId: 'artifact_focus_blend_retouch',
  sharpnessMapArtifactId: 'artifact_focus_blend_sharpness',
});
const applied = applyFocusStackRuntimePlanV1({
  cells,
  command: {
    ...buildFocusCommand(false),
    parameters: {
      ...dryRunCommand.parameters,
      acceptedDryRunPlanHash: dryRun.acceptedDryRunPlanHash,
      acceptedDryRunPlanId: dryRun.dryRunResult.mergePlan.planId,
    },
  },
  depthConfidenceArtifactId: 'artifact_focus_blend_depth_confidence',
  frames,
  outputArtifactId: 'artifact_focus_blend_output',
  previewArtifactId: 'artifact_focus_blend_preview',
  referenceSourceIndex: REFERENCE_SOURCE_INDEX,
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
const fallbackMetrics = {
  expectedFallbackPixelCount: lowConfidenceFallbackRegion.width * lowConfidenceFallbackRegion.height,
  meanAbsoluteError: roundMetric(
    regionMeanAbsoluteError(
      applied.outputPixels,
      expectedFrameForRegion(lowConfidenceFallbackRegion),
      lowConfidenceFallbackRegion,
    ),
  ),
  observedFallbackPixelCount: applied.provenance.sharpnessSettings.fallbackPixelCount,
  referenceSourceIndex: applied.provenance.referenceSource.sourceIndex,
};
if (fallbackMetrics.observedFallbackPixelCount !== fallbackMetrics.expectedFallbackPixelCount) {
  throw new Error(
    `Expected ${fallbackMetrics.expectedFallbackPixelCount} reference fallback pixels, got ${fallbackMetrics.observedFallbackPixelCount}.`,
  );
}
const report = reportSchema.parse({
  artifactCount: applied.mutationResult.outputArtifacts.length,
  diagnosticArtifacts: buildDiagnosticArtifactProof(),
  doesNotProve: ['real_raw_e2e', 'laplacian_pyramid_quality', 'ui_review_surface'],
  fallbackMetrics,
  focusCoverageRatio: dryRun.provenance.focusCoverageRatio,
  generatedAt: GENERATED_AT,
  generatedPatchArtifactCount: countArtifactsByKind('generated_patch'),
  issue: 2537,
  qualityMetrics: buildQualityMetrics(dryRun.outputPixels, applied.outputPixels),
  outputHash: hashFloat32(applied.outputPixels),
  referenceSource: applied.provenance.referenceSource,
  regionMetrics,
  retouchLayerRecommended: applied.provenance.qualityMetrics.retouchLayerRecommended,
  retouchRiskArtifactCount: diagnosticArtifactsFor('retouch_risk').length,
  runtimeStatus: applied.provenance.runtimeStatus,
  schemaVersion: 1,
  translatedBorderMetrics: translatedBorderMetrics(applied.outputPixels),
  validationMode: 'synthetic_focus_blend_runtime_apply',
});
const reportJson = await format(JSON.stringify(report), {
  ...((await resolveConfig('package.json')) ?? {}),
  parser: 'json',
});

if (update) {
  await mkdir(dirname(REPORT_PATH), { recursive: true });
  await writeFile(REPORT_PATH, reportJson);
  console.log(`focus blend runtime proof artifact wrote ${REPORT_PATH}`);
  process.exit(0);
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
  region: ProofRegion,
): number {
  let total = 0;
  let count = 0;
  const referenceFrame = expectedFrameForRegion(lowConfidenceFallbackRegion);
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

function translatedBorderMetrics(outputPixels: Float32Array): { minOutputValue: number; zeroPixelCount: number } {
  let minOutputValue = Number.POSITIVE_INFINITY;
  let zeroPixelCount = 0;
  const y = sourceRegions[2]?.y;
  const region = sourceRegions[2];
  if (region === undefined || y === undefined) {
    throw new Error('Focus blend proof requires a translated border region.');
  }
  for (let x = region.x; x < region.x + region.width; x += 1) {
    const value = outputPixels[y * WIDTH + x] ?? 0;
    minOutputValue = Math.min(minOutputValue, value);
    if (value === 0) zeroPixelCount += 1;
  }
  return {
    minOutputValue: roundMetric(minOutputValue),
    zeroPixelCount,
  };
}

function buildQualityMetrics(
  dryRunPixels: Float32Array,
  appliedPixels: Float32Array,
): {
  blackPixelCount: 0;
  dryRunApplyPixelsEqual: true;
  excessSeamGradient: number;
  invalidSourceContributionCount: number;
  nonfiniteOutputPixelCount: 0;
  seamBandP95Error: number;
} {
  if (!buffersEqual(dryRunPixels, appliedPixels)) {
    throw new Error('Focus blend dry-run and apply pixels diverged.');
  }
  const blackPixelCount = countMatching(appliedPixels, (value) => value === 0);
  const nonfiniteOutputPixelCount = countMatching(appliedPixels, (value) => !Number.isFinite(value));
  if (blackPixelCount !== 0 || nonfiniteOutputPixelCount !== 0) {
    throw new Error(
      `Focus blend output contains invalid pixels: black=${blackPixelCount} nonfinite=${nonfiniteOutputPixelCount}.`,
    );
  }
  return {
    blackPixelCount: 0,
    dryRunApplyPixelsEqual: true,
    excessSeamGradient: seamGradientMetrics(appliedPixels).excessSeamGradient,
    invalidSourceContributionCount:
      applied.provenance.sharpnessSettings.diagnosticCount - fallbackMetrics.observedFallbackPixelCount,
    nonfiniteOutputPixelCount: 0,
    seamBandP95Error: seamBandP95Error(appliedPixels),
  };
}

function buildDiagnosticArtifactProof(): Array<{
  artifactId: string;
  contentHash: string;
  diagnosticType: 'focus_confidence' | 'retouch_risk' | 'source_selection';
  kind: 'mask';
}> {
  return [
    diagnosticArtifact('artifact_focus_blend_sharpness', 'source_selection'),
    diagnosticArtifact('artifact_focus_blend_depth_confidence', 'focus_confidence'),
    diagnosticArtifact('artifact_focus_blend_retouch', 'retouch_risk'),
  ];
}

function diagnosticArtifact(
  artifactId: string,
  diagnosticType: 'focus_confidence' | 'retouch_risk' | 'source_selection',
): {
  artifactId: string;
  contentHash: string;
  diagnosticType: 'focus_confidence' | 'retouch_risk' | 'source_selection';
  kind: 'mask';
} {
  const artifact = applied.mutationResult.outputArtifacts.find((candidate) => candidate.artifactId === artifactId);
  if (artifact === undefined || artifact.contentHash === undefined || artifact.kind !== 'mask') {
    throw new Error(`Expected focus diagnostic mask artifact ${artifactId}.`);
  }
  return {
    artifactId: artifact.artifactId,
    contentHash: artifact.contentHash,
    diagnosticType,
    kind: 'mask',
  };
}

function diagnosticArtifactsFor(diagnosticType: 'focus_confidence' | 'retouch_risk' | 'source_selection') {
  return buildDiagnosticArtifactProof().filter((artifact) => artifact.diagnosticType === diagnosticType);
}

function countArtifactsByKind(kind: string): number {
  return applied.mutationResult.outputArtifacts.filter((artifact) => artifact.kind === kind).length;
}

function buffersEqual(left: Float32Array, right: Float32Array): boolean {
  if (left.length !== right.length) return false;
  return left.every((value, index) => value === right[index]);
}

function countMatching(pixels: Float32Array, predicate: (value: number) => boolean): number {
  return pixels.reduce((count, value) => count + (predicate(value) ? 1 : 0), 0);
}

function seamBandP95Error(outputPixels: Float32Array): number {
  const errors: number[] = [];
  for (const seamX of [24, 48]) {
    for (let y = 1; y < HEIGHT - FALLBACK_HEIGHT - 1; y += 1) {
      for (let x = seamX - 1; x <= seamX + 1; x += 1) {
        const expectedFrame = expectedFrameForRegion(regionForPixel(x, y));
        const expected = sampleAligned(expectedFrame, expectedFrameForRegion(lowConfidenceFallbackRegion), x, y);
        if (expected === undefined) continue;
        errors.push(Math.abs((outputPixels[y * WIDTH + x] ?? 0) - expected));
      }
    }
  }
  return roundMetric(percentile(errors, 0.95));
}

function seamGradientMetrics(outputPixels: Float32Array): { excessSeamGradient: number } {
  const seamGradients = [24, 48].flatMap((seamX) =>
    range(1, HEIGHT - FALLBACK_HEIGHT - 1).map((y) =>
      Math.abs(pixelAt(outputPixels, seamX, y) - pixelAt(outputPixels, seamX - 1, y)),
    ),
  );
  const interiorGradients = [12, 36, 60].flatMap((x) =>
    range(1, HEIGHT - FALLBACK_HEIGHT - 1).map((y) =>
      Math.abs(pixelAt(outputPixels, x, y) - pixelAt(outputPixels, x - 1, y)),
    ),
  );
  return {
    excessSeamGradient: roundMetric(Math.max(0, average(seamGradients) - average(interiorGradients))),
  };
}

function regionForPixel(x: number, y: number): ProofRegion {
  const region = [...sourceRegions, lowConfidenceFallbackRegion].find(
    (candidate) =>
      x >= candidate.x && x < candidate.x + candidate.width && y >= candidate.y && y < candidate.y + candidate.height,
  );
  if (region === undefined) throw new Error(`Focus blend proof missing region for ${x},${y}.`);
  return region;
}

function pixelAt(pixels: Float32Array, x: number, y: number): number {
  return pixels[y * WIDTH + x] ?? 0;
}

function percentile(values: number[], percentileValue: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.ceil(sorted.length * percentileValue) - 1);
  return sorted[index] ?? 0;
}

function range(start: number, endExclusive: number): number[] {
  return Array.from({ length: Math.max(0, endExclusive - start) }, (_, index) => start + index);
}

function average(values: number[]): number {
  return values.reduce((total, value) => total + value, 0) / Math.max(1, values.length);
}

function expectedFrameForRegion(region: ProofRegion): (typeof frames)[number] {
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
