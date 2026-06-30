#!/usr/bin/env bun

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { performance } from 'node:perf_hooks';

import { z } from 'zod';

import { parseFocusSharpnessMapReport } from '../../../../src/schemas/focus-stack/focusSharpnessMapSchemas.ts';

const MANIFEST_PATH = resolve('fixtures/focus-stacking/focus-synthetic-bracket-fixtures.json');
const REPORT_PATH = resolve('artifacts/focus-sharpness-map/focus-sharpness-map-report.json');
const CELL_SIZE = 8;
const SMOOTH_RADIUS = 5;
const LOW_CONFIDENCE_MARGIN = 0.12;
const LOW_SHARPNESS_SCORE = 0.0005;
const EPSILON = 1e-9;
const MIN_REGION_WINNER_CELL_RATIO = 0.8;
const MIN_REGION_AGGREGATE_MARGIN = 0.16;
const MAX_REGION_LOW_CONFIDENCE_RATIO = 0.5;
const TIER_1_BUDGET_MS = 5_000;

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
    generator: z
      .object({
        seed: z.string().min(1),
      })
      .passthrough(),
    sourceFrames: z.array(SourceFrameSchema).length(3),
  })
  .passthrough();

const FocusFixtureManifestSchema = z
  .object({
    fixtures: z.array(FocusFixtureSchema).min(1),
    issue: z.literal(1059),
    schemaVersion: z.literal(1),
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

function sobelEnergyAt(luma, sourceFrame, referenceFrame, x, y) {
  const samples = [
    sampleAligned(luma, sourceFrame, referenceFrame, x - 1, y - 1),
    sampleAligned(luma, sourceFrame, referenceFrame, x, y - 1),
    sampleAligned(luma, sourceFrame, referenceFrame, x + 1, y - 1),
    sampleAligned(luma, sourceFrame, referenceFrame, x - 1, y),
    sampleAligned(luma, sourceFrame, referenceFrame, x + 1, y),
    sampleAligned(luma, sourceFrame, referenceFrame, x - 1, y + 1),
    sampleAligned(luma, sourceFrame, referenceFrame, x, y + 1),
    sampleAligned(luma, sourceFrame, referenceFrame, x + 1, y + 1),
  ];
  if (samples.some((sample) => sample === undefined)) return undefined;
  const [topLeft, topCenter, topRight, midLeft, midRight, bottomLeft, bottomCenter, bottomRight] = samples;
  const gx = topRight + 2 * midRight + bottomRight - (topLeft + 2 * midLeft + bottomLeft);
  const gy = bottomLeft + 2 * bottomCenter + bottomRight - (topLeft + 2 * topCenter + topRight);
  return gx * gx + gy * gy;
}

function createAlignedEnergyMap(luma, sourceFrame, referenceFrame) {
  const energy = new Float32Array(referenceFrame.width * referenceFrame.height);
  for (let y = 0; y < referenceFrame.height; y += 1) {
    for (let x = 0; x < referenceFrame.width; x += 1) {
      energy[y * referenceFrame.width + x] = sobelEnergyAt(luma, sourceFrame, referenceFrame, x, y) ?? 0;
    }
  }
  return energy;
}

function scoreCell(energyMap, referenceFrame, cell) {
  let total = 0;
  let count = 0;
  const minY = Math.max(0, cell.y - SMOOTH_RADIUS);
  const maxY = Math.min(referenceFrame.height, cell.y + cell.height + SMOOTH_RADIUS);
  const minX = Math.max(0, cell.x - SMOOTH_RADIUS);
  const maxX = Math.min(referenceFrame.width, cell.x + cell.width + SMOOTH_RADIUS);
  for (let y = minY; y < maxY; y += 1) {
    for (let x = minX; x < maxX; x += 1) {
      total += energyMap[y * referenceFrame.width + x];
      count += 1;
    }
  }
  return total / Math.max(1, count);
}

function createCells(fixture, sourceEnergyMaps, referenceFrame) {
  const gridWidth = Math.ceil(referenceFrame.width / CELL_SIZE);
  const gridHeight = Math.ceil(referenceFrame.height / CELL_SIZE);
  const cells = [];
  for (let cellY = 0; cellY < gridHeight; cellY += 1) {
    for (let cellX = 0; cellX < gridWidth; cellX += 1) {
      const cell = {
        height: Math.min(CELL_SIZE, referenceFrame.height - cellY * CELL_SIZE),
        width: Math.min(CELL_SIZE, referenceFrame.width - cellX * CELL_SIZE),
        x: cellX * CELL_SIZE,
        y: cellY * CELL_SIZE,
      };
      const rawScores = fixture.sourceFrames
        .map((sourceFrame) => ({
          sharpnessScore: scoreCell(sourceEnergyMaps.get(sourceFrame.sourceIndex), referenceFrame, cell),
          sourceIndex: sourceFrame.sourceIndex,
        }))
        .sort((left, right) => right.sharpnessScore - left.sharpnessScore || left.sourceIndex - right.sourceIndex);
      const best = rawScores[0];
      const secondBest = rawScores[1];
      const confidenceMargin =
        (best.sharpnessScore - secondBest.sharpnessScore) / Math.max(best.sharpnessScore, EPSILON);
      cells.push({
        ...cell,
        confidenceMargin: round6(confidenceMargin),
        lowConfidence: best.sharpnessScore < LOW_SHARPNESS_SCORE || confidenceMargin < LOW_CONFIDENCE_MARGIN,
        sourceScores: rawScores.map((score) => ({
          relativeConfidence: round6(score.sharpnessScore / Math.max(best.sharpnessScore, EPSILON)),
          sharpnessScore: round6(score.sharpnessScore),
          sourceIndex: score.sourceIndex,
        })),
        winnerSourceIndex: best.sourceIndex,
      });
    }
  }
  return { cells, gridHeight, gridWidth };
}

function cellsInsideRegion(cells, region) {
  return cells.filter((cell) => {
    const centerX = cell.x + cell.width / 2;
    const centerY = cell.y + cell.height / 2;
    return (
      centerX >= region.x &&
      centerX < region.x + region.width &&
      centerY >= region.y &&
      centerY < region.y + region.height
    );
  });
}

function evaluateRegion(cells, region, sourceFrames) {
  const selectedCells = cellsInsideRegion(cells, region);
  if (selectedCells.length < 12) {
    fail(`${region.regionId}: too few sharpness cells selected`, { cellCount: selectedCells.length });
  }
  const meanScoreBySource = sourceFrames
    .map((sourceFrame) => {
      const total = selectedCells.reduce((sum, cell) => {
        const score = cell.sourceScores.find((sourceScore) => sourceScore.sourceIndex === sourceFrame.sourceIndex);
        return sum + (score?.sharpnessScore ?? 0);
      }, 0);
      return {
        score: total / selectedCells.length,
        sourceIndex: sourceFrame.sourceIndex,
      };
    })
    .sort((left, right) => right.score - left.score || left.sourceIndex - right.sourceIndex);
  const expectedMean = meanScoreBySource.find((score) => score.sourceIndex === region.expectedSourceIndex);
  const bestOther = meanScoreBySource.find((score) => score.sourceIndex !== region.expectedSourceIndex);
  const observedWinnerSourceIndex = meanScoreBySource[0].sourceIndex;
  const aggregateConfidenceMargin = (expectedMean.score - bestOther.score) / Math.max(expectedMean.score, EPSILON);
  const winnerCellRatio =
    selectedCells.filter((cell) => cell.winnerSourceIndex === region.expectedSourceIndex).length / selectedCells.length;
  const lowConfidenceCellRatio = selectedCells.filter((cell) => cell.lowConfidence).length / selectedCells.length;
  const meanConfidenceMargin =
    selectedCells.reduce((sum, cell) => sum + cell.confidenceMargin, 0) / selectedCells.length;
  const status =
    observedWinnerSourceIndex === region.expectedSourceIndex &&
    winnerCellRatio >= MIN_REGION_WINNER_CELL_RATIO &&
    aggregateConfidenceMargin >= MIN_REGION_AGGREGATE_MARGIN &&
    lowConfidenceCellRatio <= MAX_REGION_LOW_CONFIDENCE_RATIO
      ? 'pass'
      : 'fail';

  return {
    aggregateConfidenceMargin: round6(aggregateConfidenceMargin),
    cellCount: selectedCells.length,
    expectedSourceIndex: region.expectedSourceIndex,
    lowConfidenceCellRatio: round6(lowConfidenceCellRatio),
    meanConfidenceMargin: round6(meanConfidenceMargin),
    observedWinnerSourceIndex,
    regionId: region.regionId,
    status,
    winnerCellRatio: round6(winnerCellRatio),
  };
}

function appliedTransforms(fixture, referenceFrame) {
  return fixture.sourceFrames.map((sourceFrame) => ({
    dx: referenceFrame.expectedTranslationX - sourceFrame.expectedTranslationX,
    dy: referenceFrame.expectedTranslationY - sourceFrame.expectedTranslationY,
    expectedScale: sourceFrame.expectedScale,
    scaleCompensationApplied: false,
    sourceIndex: sourceFrame.sourceIndex,
  }));
}

const startedAt = performance.now();
const manifest = FocusFixtureManifestSchema.parse(JSON.parse(await readFile(MANIFEST_PATH, 'utf8')));
const fixtureReports = [];

for (const fixture of manifest.fixtures) {
  const referenceFrame = fixture.sourceFrames.find((sourceFrame) => sourceFrame.sourceIndex === 0);
  if (referenceFrame === undefined) fail(`${fixture.fixtureId}: missing reference source 0`);

  const sourceLumas = new Map(
    fixture.sourceFrames.map((sourceFrame) => [sourceFrame.sourceIndex, createLumaFrame(fixture, sourceFrame)]),
  );
  const sourceEnergyMaps = new Map(
    fixture.sourceFrames.map((sourceFrame) => [
      sourceFrame.sourceIndex,
      createAlignedEnergyMap(sourceLumas.get(sourceFrame.sourceIndex), sourceFrame, referenceFrame),
    ]),
  );
  const map = createCells(fixture, sourceEnergyMaps, referenceFrame);
  const expectedRegionResults = fixture.expectedWinnerRegions.map((region) =>
    evaluateRegion(map.cells, region, fixture.sourceFrames),
  );

  const failedRegion = expectedRegionResults.find((result) => result.status === 'fail');
  if (failedRegion) {
    fail(`${fixture.fixtureId}: ${failedRegion.regionId} sharpness winner mismatch`, failedRegion);
  }

  fixtureReports.push({
    appliedTransforms: appliedTransforms(fixture, referenceFrame),
    expectedRegionResults,
    expectedWarningCodes: fixture.expectedWarningCodes,
    fixtureId: fixture.fixtureId,
    height: referenceFrame.height,
    map: {
      cellSize: CELL_SIZE,
      cells: map.cells,
      gridHeight: map.gridHeight,
      gridWidth: map.gridWidth,
    },
    referenceSourceIndex: 0,
    width: referenceFrame.width,
  });
}

const elapsedMs = performance.now() - startedAt;
if (elapsedMs > TIER_1_BUDGET_MS) {
  fail('Focus sharpness-map smoke exceeded Tier 1 budget', {
    budgetMs: TIER_1_BUDGET_MS,
    elapsedMs: round6(elapsedMs),
  });
}

const report = parseFocusSharpnessMapReport({
  $schema: 'https://rawengine.dev/schemas/focus-sharpness-map-report.v1.json',
  algorithm: {
    cellSizePx: CELL_SIZE,
    confidenceMarginFormula: '(bestScore-secondBestScore)/max(bestScore,epsilon)',
    detailKernel: 'sobel-3x3-gradient-energy',
    epsilon: EPSILON,
    id: 'tenengrad-sobel-luma-cell-v1',
    lowConfidenceMarginThreshold: LOW_CONFIDENCE_MARGIN,
    lowSharpnessScoreThreshold: LOW_SHARPNESS_SCORE,
    luma: 'rec709',
    maxExpectedRegionLowConfidenceCellRatio: MAX_REGION_LOW_CONFIDENCE_RATIO,
    regionAggregateMarginThreshold: MIN_REGION_AGGREGATE_MARGIN,
    regionWinnerCellRatioThreshold: MIN_REGION_WINNER_CELL_RATIO,
    smoothingWindowPx: SMOOTH_RADIUS * 2 + 1,
  },
  doesNotProve: [
    'depth_map',
    'final_blending',
    'focus_breathing_compensation',
    'real_raw_quality',
    'segmentation',
    'ui_e2e',
  ],
  fixtures: fixtureReports,
  issue: 1061,
  manifestIssue: 1059,
  schemaVersion: 1,
  snapshotDate: manifest.snapshotDate,
});

await mkdir(resolve('artifacts/focus-sharpness-map'), { recursive: true });
await writeFile(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`);

console.log(`Validated ${fixtureReports.length} focus sharpness-map smoke fixtures in ${Math.round(elapsedMs)}ms.`);
for (const fixture of fixtureReports) {
  const minWinnerRatio = Math.min(...fixture.expectedRegionResults.map((result) => result.winnerCellRatio));
  const minAggregateMargin = Math.min(
    ...fixture.expectedRegionResults.map((result) => result.aggregateConfidenceMargin),
  );
  console.log(
    `${fixture.fixtureId}: minWinnerCellRatio=${minWinnerRatio.toFixed(3)} minAggregateConfidenceMargin=${minAggregateMargin.toFixed(3)}`,
  );
}
