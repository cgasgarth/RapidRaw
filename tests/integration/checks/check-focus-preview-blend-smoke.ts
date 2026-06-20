#!/usr/bin/env bun

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { spawnSync } from 'node:child_process';

import { z } from 'zod';

import { applyWeightedSharpnessFocusStackV1 } from '../../../packages/rawengine-schema/src/focusStackWeightedBlend.ts';
import { parseFocusPreviewBlendReport } from '../../../src/schemas/focusPreviewBlendSchemas.ts';
import { parseFocusSharpnessMapReport } from '../../../src/schemas/focusSharpnessMapSchemas.ts';

const MANIFEST_PATH = resolve('fixtures/focus-stacking/focus-synthetic-bracket-fixtures.json');
const SHARPNESS_REPORT_PATH = resolve('artifacts/focus-sharpness-map/focus-sharpness-map-report.json');
const OUTPUT_DIR = resolve('artifacts/focus-preview-blend');
const REPORT_PATH = resolve(OUTPUT_DIR, 'focus-preview-blend-report.json');
const WEIGHT_POWER = 5;
const LOW_CONFIDENCE_WEIGHT_FLOOR = 0.12;
const MAX_REGION_MAE = 0.08;
const HALO_RISK_DIFF_THRESHOLD = 0.16;
const MAX_HALO_RISK_CELL_RATIO = 0.2;
const TIER_1_BUDGET_MS = 5_000;
const MAX_FAILURE_OUTPUT_CHARS = 12_000;

function writeBoundedOutput(name, value) {
  if (!value) return;
  const normalized = value.endsWith('\n') ? value : `${value}\n`;
  if (normalized.length <= MAX_FAILURE_OUTPUT_CHARS) {
    process.stderr.write(normalized);
    return;
  }
  console.error(`${name} truncated (${normalized.length} chars)`);
  process.stderr.write(normalized.slice(0, 6_000));
  console.error('\n[...]');
  process.stderr.write(normalized.slice(-6_000));
}

const SourceFrameSchema = z
  .object({
    expectedScale: z.number().positive(),
    expectedTranslationX: z.number().int(),
    expectedTranslationY: z.number().int(),
    height: z.number().int().positive().max(512),
    sourceIndex: z.number().int().nonnegative(),
    width: z.number().int().positive().max(512),
  })
  .strict();

const WinnerRegionSchema = z
  .object({
    expectedSourceIndex: z.number().int().nonnegative(),
    height: z.number().int().positive(),
    regionId: z.string().regex(/^[a-z0-9-]+$/u),
    width: z.number().int().positive(),
    x: z.number().int().nonnegative(),
    y: z.number().int().nonnegative(),
  })
  .strict();

const FocusFixtureSchema = z
  .object({
    expectedWarningCodes: z.array(z.string().min(1)),
    expectedWinnerRegions: z.array(WinnerRegionSchema).min(3),
    fixtureId: z.string().regex(/^focus\.synthetic\.[a-z0-9.-]+\.v[0-9]+$/u),
    generator: z.object({ seed: z.string().min(1) }).passthrough(),
    sourceFrames: z.array(SourceFrameSchema).length(3),
    staleSourceNegativeCase: z
      .object({
        expectedBlockCode: z.literal('stale_source_graph_revision'),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

const FocusFixtureManifestSchema = z
  .object({
    fixtures: z.array(FocusFixtureSchema).min(1),
    issue: z.literal(1059),
    snapshotDate: z.string().date(),
  })
  .passthrough();

function fail(message, detail) {
  console.error(message);
  if (detail !== undefined) console.error(JSON.stringify(detail, null, 2));
  process.exit(1);
}

function round6(value) {
  return Number(value.toFixed(6));
}

function stableByte(seed, sourceIndex, x, y, channel) {
  let value = 2166136261;
  const input = `${seed}:${sourceIndex}:${x}:${y}:${channel}`;
  for (let index = 0; index < input.length; index += 1) {
    value ^= input.charCodeAt(index);
    value = Math.imul(value, 16777619) >>> 0;
  }
  return value % 256;
}

function regionInfluence(region, sourceFrame, x, y) {
  const shiftedX = x - sourceFrame.expectedTranslationX;
  const shiftedY = y - sourceFrame.expectedTranslationY;
  const centerX = region.x + region.width / 2;
  const centerY = region.y + region.height / 2;
  const radiusX = Math.max(region.width / 2, 1);
  const radiusY = Math.max(region.height / 2, 1);
  const distance = (shiftedX - centerX) ** 2 / radiusX ** 2 + (shiftedY - centerY) ** 2 / radiusY ** 2;
  return Math.max(0, 1 - distance);
}

function createLumaFrame(fixture, sourceFrame) {
  const luma = new Float32Array(sourceFrame.width * sourceFrame.height);
  for (let y = 0; y < sourceFrame.height; y += 1) {
    for (let x = 0; x < sourceFrame.width; x += 1) {
      const basePattern = (stableByte(fixture.generator.seed, sourceFrame.sourceIndex, x, y, 0) % 48) + 64;
      const winnerBoost = fixture.expectedWinnerRegions
        .filter((region) => region.expectedSourceIndex === sourceFrame.sourceIndex)
        .reduce((total, region) => total + Math.round(regionInfluence(region, sourceFrame, x, y) * 120), 0);
      const nonWinnerTexture = fixture.expectedWinnerRegions
        .filter((region) => region.expectedSourceIndex !== sourceFrame.sourceIndex)
        .reduce((total, region) => total + Math.round(regionInfluence(region, sourceFrame, x, y) * 24), 0);
      const breathingTint = Math.round((sourceFrame.expectedScale - 1) * 1200);
      const value = Math.max(0, Math.min(255, basePattern + winnerBoost + nonWinnerTexture));
      const red = Math.max(0, Math.min(255, value + breathingTint));
      const green = Math.max(0, Math.min(255, value + sourceFrame.sourceIndex * 12));
      const blue = Math.max(0, Math.min(255, 255 - value + sourceFrame.sourceIndex * 18));
      luma[y * sourceFrame.width + x] = (0.2126 * red + 0.7152 * green + 0.0722 * blue) / 255;
    }
  }
  return luma;
}

function sampleAligned(luma, sourceFrame, referenceFrame, x, y) {
  const dx = referenceFrame.expectedTranslationX - sourceFrame.expectedTranslationX;
  const dy = referenceFrame.expectedTranslationY - sourceFrame.expectedTranslationY;
  const sourceX = x - dx;
  const sourceY = y - dy;
  if (sourceX < 0 || sourceX >= sourceFrame.width || sourceY < 0 || sourceY >= sourceFrame.height) {
    return undefined;
  }
  return luma[sourceY * sourceFrame.width + sourceX];
}

function blendFixture(fixture, sharpnessFixture) {
  const referenceFrame = fixture.sourceFrames.find((sourceFrame) => sourceFrame.sourceIndex === 0);
  if (referenceFrame === undefined) fail(`${fixture.fixtureId}: missing reference source 0`);
  const sourceLumas = new Map(
    fixture.sourceFrames.map((sourceFrame) => [sourceFrame.sourceIndex, createLumaFrame(fixture, sourceFrame)]),
  );
  const blendResult = applyWeightedSharpnessFocusStackV1({
    cells: sharpnessFixture.map.cells,
    frames: fixture.sourceFrames.map((sourceFrame) => {
      const pixels = sourceLumas.get(sourceFrame.sourceIndex);
      if (pixels === undefined) {
        fail(`${fixture.fixtureId}: missing source frame for preview blend`, { sourceIndex: sourceFrame.sourceIndex });
      }
      return {
        height: sourceFrame.height,
        pixels,
        sourceIndex: sourceFrame.sourceIndex,
        translationX: sourceFrame.expectedTranslationX,
        translationY: sourceFrame.expectedTranslationY,
        width: sourceFrame.width,
      };
    }),
    lowConfidenceWeightFloor: LOW_CONFIDENCE_WEIGHT_FLOOR,
    referenceSourceIndex: 0,
    weightPower: WEIGHT_POWER,
  });

  return { blended: blendResult.outputPixels, referenceFrame, sourceLumas };
}

function meanAbsoluteErrorForRegion(blended, sourceLumas, fixture, sharpnessFixture, referenceFrame, region) {
  let total = 0;
  let count = 0;
  for (let y = region.y; y < region.y + region.height; y += 1) {
    for (let x = region.x; x < region.x + region.width; x += 1) {
      const sharpnessCell = sharpnessCellForPixel(sharpnessFixture.map.cells, x, y);
      const expectedSourceIndex = sharpnessCell.lowConfidence ? referenceFrame.sourceIndex : region.expectedSourceIndex;
      const expectedFrame = fixture.sourceFrames.find((sourceFrame) => sourceFrame.sourceIndex === expectedSourceIndex);
      const expectedLuma = sourceLumas.get(expectedSourceIndex);
      if (expectedFrame === undefined || expectedLuma === undefined) {
        fail(`${fixture.fixtureId}: missing expected source frame for preview metric`, {
          expectedSourceIndex,
          regionId: region.regionId,
        });
      }
      const expected = sampleAligned(expectedLuma, expectedFrame, referenceFrame, x, y);
      if (expected === undefined) continue;
      total += Math.abs((blended[y * referenceFrame.width + x] ?? 0) - expected);
      count += 1;
    }
  }
  return total / Math.max(1, count);
}

function sharpnessCellForPixel(cells, x, y) {
  const cell = cells.find(
    (candidate) =>
      x >= candidate.x && x < candidate.x + candidate.width && y >= candidate.y && y < candidate.y + candidate.height,
  );
  if (cell === undefined) {
    fail('Missing sharpness cell for preview metric', { x, y });
  }
  return cell;
}

function haloRiskCellRatio(sharpnessFixture, fixture, blended, referenceFrame) {
  let risky = 0;
  let checked = 0;
  for (const cell of sharpnessFixture.map.cells) {
    const right = sharpnessFixture.map.cells.find(
      (candidate) => candidate.x === cell.x + cell.width && candidate.y === cell.y,
    );
    const down = sharpnessFixture.map.cells.find(
      (candidate) => candidate.x === cell.x && candidate.y === cell.y + cell.height,
    );
    for (const neighbor of [right, down].filter(Boolean)) {
      checked += 1;
      if (neighbor.winnerSourceIndex === cell.winnerSourceIndex) continue;
      const sampleX = Math.min(referenceFrame.width - 1, Math.max(cell.x, neighbor.x));
      const sampleY = Math.min(referenceFrame.height - 1, Math.max(cell.y, neighbor.y));
      const leftValue = blended[sampleY * referenceFrame.width + Math.max(0, sampleX - 1)] ?? 0;
      const rightValue = blended[sampleY * referenceFrame.width + sampleX] ?? 0;
      if (Math.abs(leftValue - rightValue) > HALO_RISK_DIFF_THRESHOLD) risky += 1;
    }
  }
  return risky / Math.max(1, checked);
}

async function writePgm(filePath, pixels, width, height) {
  const body = new Uint8Array(width * height);
  for (let index = 0; index < pixels.length; index += 1) {
    body[index] = Math.max(0, Math.min(255, Math.round((pixels[index] ?? 0) * 255)));
  }
  await writeFile(filePath, Buffer.concat([Buffer.from(`P5\n${width} ${height}\n255\n`), Buffer.from(body)]));
}

const startedAt = performance.now();
const sharpnessCheck = spawnSync('bun', ['run', 'check:focus-sharpness-map-smoke'], { encoding: 'utf8' });
if (sharpnessCheck.status !== 0) {
  writeBoundedOutput('stdout', sharpnessCheck.stdout);
  writeBoundedOutput('stderr', sharpnessCheck.stderr);
  process.exit(sharpnessCheck.status ?? 1);
}

const manifest = FocusFixtureManifestSchema.parse(JSON.parse(await readFile(MANIFEST_PATH, 'utf8')));
const sharpnessReport = parseFocusSharpnessMapReport(JSON.parse(await readFile(SHARPNESS_REPORT_PATH, 'utf8')));
await mkdir(OUTPUT_DIR, { recursive: true });

const fixtureReports = [];
for (const fixture of manifest.fixtures) {
  const sharpnessFixture = sharpnessReport.fixtures.find((candidate) => candidate.fixtureId === fixture.fixtureId);
  if (sharpnessFixture === undefined) fail(`${fixture.fixtureId}: missing sharpness report fixture`);
  const { blended, referenceFrame, sourceLumas } = blendFixture(fixture, sharpnessFixture);
  const artifactPath = resolve(OUTPUT_DIR, `${fixture.fixtureId}.preview-blend.pgm`);
  await writePgm(artifactPath, blended, referenceFrame.width, referenceFrame.height);

  const regionMetrics = fixture.expectedWinnerRegions.map((region) => {
    const meanAbsoluteError = meanAbsoluteErrorForRegion(
      blended,
      sourceLumas,
      fixture,
      sharpnessFixture,
      referenceFrame,
      region,
    );
    return {
      expectedSourceIndex: region.expectedSourceIndex,
      meanAbsoluteError: round6(meanAbsoluteError),
      regionId: region.regionId,
      status: meanAbsoluteError <= MAX_REGION_MAE ? 'pass' : 'fail',
    };
  });
  const failedRegion = regionMetrics.find((region) => region.status === 'fail');
  if (failedRegion) fail(`${fixture.fixtureId}: preview blend region mismatch`, failedRegion);

  const haloRiskRatio = haloRiskCellRatio(sharpnessFixture, fixture, blended, referenceFrame);
  if (haloRiskRatio > MAX_HALO_RISK_CELL_RATIO) {
    fail(`${fixture.fixtureId}: halo risk exceeds threshold`, { haloRiskRatio: round6(haloRiskRatio) });
  }

  fixtureReports.push({
    artifactPath,
    blockCodes: fixture.staleSourceNegativeCase ? [fixture.staleSourceNegativeCase.expectedBlockCode] : [],
    fixtureId: fixture.fixtureId,
    haloRiskCellRatio: round6(haloRiskRatio),
    height: referenceFrame.height,
    lowConfidenceCellRatio: round6(
      sharpnessFixture.map.cells.filter((cell) => cell.lowConfidence).length / sharpnessFixture.map.cells.length,
    ),
    provenance: {
      focusSharpnessIssue: 1061,
      manifestIssue: 1059,
      scaleCompensationApplied: false,
      sharpnessAlgorithmId: sharpnessReport.algorithm.id,
    },
    regionMetrics,
    warningCodes: fixture.expectedWarningCodes,
    width: referenceFrame.width,
  });
}

const elapsedMs = performance.now() - startedAt;
if (elapsedMs > TIER_1_BUDGET_MS) {
  fail('Focus preview blend smoke exceeded Tier 1 budget', {
    budgetMs: TIER_1_BUDGET_MS,
    elapsedMs: round6(elapsedMs),
  });
}

const report = parseFocusPreviewBlendReport({
  $schema: 'https://rawengine.dev/schemas/focus-preview-blend-report.v1.json',
  algorithm: {
    id: 'weighted-sharpness-preview-blend-v2',
    lowConfidenceWeightFloor: LOW_CONFIDENCE_WEIGHT_FLOOR,
    maxHaloRiskCellRatio: MAX_HALO_RISK_CELL_RATIO,
    maxRegionMeanAbsoluteError: MAX_REGION_MAE,
    weightPower: WEIGHT_POWER,
  },
  doesNotProve: [
    'depth_map',
    'final_focus_stack_quality',
    'focus_breathing_compensation',
    'gpu_work',
    'laplacian_pyramid_quality',
    'real_raw_quality',
    'ui_e2e',
  ],
  fixtures: fixtureReports,
  issue: 1062,
  runtimeStatus: 'preview_only_synthetic_smoke',
  schemaVersion: 1,
  snapshotDate: manifest.snapshotDate,
});

await writeFile(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`);

console.log(`Validated ${fixtureReports.length} focus preview blend smoke fixtures in ${Math.round(elapsedMs)}ms.`);
for (const fixture of fixtureReports) {
  const maxRegionMae = Math.max(...fixture.regionMetrics.map((metric) => metric.meanAbsoluteError));
  console.log(
    `${fixture.fixtureId}: maxRegionMAE=${maxRegionMae.toFixed(3)} haloRisk=${fixture.haloRiskCellRatio.toFixed(3)}`,
  );
}
