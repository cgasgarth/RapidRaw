#!/usr/bin/env bun

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { z } from 'zod';

const MANIFEST_PATH = resolve('fixtures/focus-stacking/focus-synthetic-bracket-fixtures.json');
const MIN_WINNER_REGION_WEIGHT = 0.68;
const MAX_REGION_RUNNER_UP_WEIGHT = 0.24;
const MAX_ADJACENT_WEIGHT_DELTA = 0.42;

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
    expectedWinnerRegions: z.array(WinnerRegionSchema).min(3),
    fixtureId: z.string().regex(/^focus\.synthetic\.[a-z0-9.-]+\.v[0-9]+$/u),
    sourceFrames: z.array(SourceFrameSchema).length(3),
  })
  .passthrough()
  .superRefine((fixture, context) => {
    const sourceIndexes = new Set(fixture.sourceFrames.map((sourceFrame) => sourceFrame.sourceIndex));
    for (const region of fixture.expectedWinnerRegions) {
      if (!sourceIndexes.has(region.expectedSourceIndex)) {
        context.addIssue({
          code: 'custom',
          message: 'Expected winner region must reference a source frame.',
          path: ['expectedWinnerRegions', region.regionId],
        });
      }
    }
  });

const FocusFixtureManifestSchema = z
  .object({
    fixtures: z.array(FocusFixtureSchema).min(1),
    issue: z.literal(1059),
    schemaVersion: z.literal(1),
  })
  .passthrough();

const RegionBlendResultSchema = z
  .object({
    averageWinnerWeight: z.number().min(0).max(1),
    dominantSourceIndex: z.number().int().nonnegative(),
    maxAdjacentWeightDelta: z.number().min(0).max(1),
    maxRunnerUpWeight: z.number().min(0).max(1),
    regionId: z.string().min(1),
  })
  .strict();

function fail(message, detail) {
  console.error(message);
  if (detail !== undefined) {
    console.error(JSON.stringify(detail, null, 2));
  }
  process.exit(1);
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

function sourceWeightScore(fixture, sourceFrame, x, y) {
  const winnerInfluence = fixture.expectedWinnerRegions
    .filter((region) => region.expectedSourceIndex === sourceFrame.sourceIndex)
    .reduce((total, region) => total + regionInfluence(region, sourceFrame, x, y), 0);
  const nonWinnerInfluence = fixture.expectedWinnerRegions
    .filter((region) => region.expectedSourceIndex !== sourceFrame.sourceIndex)
    .reduce((total, region) => total + regionInfluence(region, sourceFrame, x, y), 0);
  const scalePenalty = Math.abs(1 - sourceFrame.expectedScale) * 0.45;
  return Math.max(0.02, 0.04 + winnerInfluence * 1.8 + nonWinnerInfluence * 0.08 - scalePenalty);
}

function normalizedWeights(fixture, x, y) {
  const weightedScores = fixture.sourceFrames.map((sourceFrame) => ({
    score: sourceWeightScore(fixture, sourceFrame, x, y) ** 1.2,
    sourceIndex: sourceFrame.sourceIndex,
  }));
  const totalScore = weightedScores.reduce((total, weightedScore) => total + weightedScore.score, 0);
  return weightedScores.map((weightedScore) => ({
    sourceIndex: weightedScore.sourceIndex,
    weight: weightedScore.score / Math.max(totalScore, 0.0001),
  }));
}

function weightForSource(weights, sourceIndex) {
  return weights.find((weight) => weight.sourceIndex === sourceIndex)?.weight ?? 0;
}

function dominantSourceIndex(weights) {
  const sortedWeights = [...weights].sort((left, right) => right.weight - left.weight);
  const dominant = sortedWeights[0];
  if (dominant === undefined) {
    fail('Missing normalized weights.');
  }
  return dominant.sourceIndex;
}

function maxAdjacentDelta(fixture, region, sourceIndex) {
  let maxDelta = 0;
  const endX = region.x + region.width - 1;
  const endY = region.y + region.height - 1;

  for (let y = region.y; y <= endY; y += 1) {
    for (let x = region.x; x <= endX; x += 1) {
      const currentWeight = weightForSource(normalizedWeights(fixture, x, y), sourceIndex);
      if (x < endX) {
        const rightWeight = weightForSource(normalizedWeights(fixture, x + 1, y), sourceIndex);
        maxDelta = Math.max(maxDelta, Math.abs(currentWeight - rightWeight));
      }
      if (y < endY) {
        const downWeight = weightForSource(normalizedWeights(fixture, x, y + 1), sourceIndex);
        maxDelta = Math.max(maxDelta, Math.abs(currentWeight - downWeight));
      }
    }
  }

  return maxDelta;
}

function evaluateRegion(fixture, region) {
  const sourceWeightTotals = new Map(fixture.sourceFrames.map((sourceFrame) => [sourceFrame.sourceIndex, 0]));
  let sampleCount = 0;

  for (let y = region.y; y < region.y + region.height; y += 1) {
    for (let x = region.x; x < region.x + region.width; x += 1) {
      const weights = normalizedWeights(fixture, x, y);
      for (const weight of weights) {
        sourceWeightTotals.set(weight.sourceIndex, (sourceWeightTotals.get(weight.sourceIndex) ?? 0) + weight.weight);
      }
      sampleCount += 1;
    }
  }

  const averageWeights = [...sourceWeightTotals.entries()]
    .map(([sourceIndex, totalWeight]) => ({
      sourceIndex,
      weight: totalWeight / Math.max(1, sampleCount),
    }))
    .sort((left, right) => right.weight - left.weight);
  const winnerWeight = averageWeights.find((weight) => weight.sourceIndex === region.expectedSourceIndex);
  const runnerUpWeight = averageWeights.find((weight) => weight.sourceIndex !== region.expectedSourceIndex);
  if (winnerWeight === undefined || runnerUpWeight === undefined) {
    fail(`${fixture.fixtureId}: missing average blend weights`, region);
  }

  return RegionBlendResultSchema.parse({
    averageWinnerWeight: Number(winnerWeight.weight.toFixed(6)),
    dominantSourceIndex: dominantSourceIndex(averageWeights),
    maxAdjacentWeightDelta: Number(maxAdjacentDelta(fixture, region, region.expectedSourceIndex).toFixed(6)),
    maxRunnerUpWeight: Number(runnerUpWeight.weight.toFixed(6)),
    regionId: region.regionId,
  });
}

const manifestJson = JSON.parse(await readFile(MANIFEST_PATH, 'utf8'));
const manifest = FocusFixtureManifestSchema.parse(manifestJson);
const reports = [];

for (const fixture of manifest.fixtures) {
  const regionResults = fixture.expectedWinnerRegions.map((region) => evaluateRegion(fixture, region));
  for (const result of regionResults) {
    const expectedRegion = fixture.expectedWinnerRegions.find((region) => region.regionId === result.regionId);
    if (expectedRegion === undefined) {
      fail(`${fixture.fixtureId}: missing expected region`, result);
    }
    if (result.dominantSourceIndex !== expectedRegion.expectedSourceIndex) {
      fail(`${fixture.fixtureId}: weighted blend selected wrong dominant source`, {
        expectedSourceIndex: expectedRegion.expectedSourceIndex,
        result,
      });
    }
    if (result.averageWinnerWeight < MIN_WINNER_REGION_WEIGHT) {
      fail(`${fixture.fixtureId}: weighted blend winner contribution is too low`, result);
    }
    if (result.maxRunnerUpWeight > MAX_REGION_RUNNER_UP_WEIGHT) {
      fail(`${fixture.fixtureId}: weighted blend runner-up contribution is too high`, result);
    }
    if (result.maxAdjacentWeightDelta > MAX_ADJACENT_WEIGHT_DELTA) {
      fail(`${fixture.fixtureId}: weighted blend produced a hard local weight jump`, result);
    }
  }

  reports.push({
    fixtureId: fixture.fixtureId,
    minWinnerWeight: Math.min(...regionResults.map((result) => result.averageWinnerWeight)),
    maxAdjacentWeightDelta: Math.max(...regionResults.map((result) => result.maxAdjacentWeightDelta)),
  });
}

console.log(`Validated ${reports.length} focus weighted-blend smoke fixtures.`);
for (const report of reports) {
  console.log(
    `${report.fixtureId}: minWinnerWeight=${report.minWinnerWeight.toFixed(3)} maxAdjacentWeightDelta=${report.maxAdjacentWeightDelta.toFixed(3)}`,
  );
}
