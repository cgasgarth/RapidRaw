#!/usr/bin/env bun

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { z } from 'zod';

const MANIFEST_PATH = resolve('fixtures/focus-stacking/focus-synthetic-bracket-fixtures.json');
const MIN_CONFIDENCE_MARGIN = 0.18;

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
    generator: z
      .object({
        seed: z.string().min(1),
      })
      .passthrough(),
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

const SharpnessRegionResultSchema = z
  .object({
    confidenceMargin: z.number().nonnegative(),
    regionId: z.string().min(1),
    scores: z.array(
      z
        .object({
          score: z.number().nonnegative(),
          sourceIndex: z.number().int().nonnegative(),
        })
        .strict(),
    ),
    status: z.enum(['confident', 'low_confidence']),
    winnerSourceIndex: z.number().int().nonnegative(),
  })
  .strict();

function fail(message, detail) {
  console.error(message);
  if (detail !== undefined) {
    console.error(JSON.stringify(detail, null, 2));
  }
  process.exit(1);
}

function stableNoise(seed, sourceIndex, x, y) {
  let value = 2166136261;
  const input = `${seed}:${sourceIndex}:${x}:${y}`;
  for (let index = 0; index < input.length; index += 1) {
    value ^= input.charCodeAt(index);
    value = Math.imul(value, 16777619) >>> 0;
  }
  return (value % 31) / 255;
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

function createSharpnessFrame(fixture, sourceFrame) {
  const pixels = new Float32Array(sourceFrame.width * sourceFrame.height);
  for (let y = 0; y < sourceFrame.height; y += 1) {
    for (let x = 0; x < sourceFrame.width; x += 1) {
      const checker = (Math.floor(x / 2) + Math.floor(y / 2)) % 2;
      const winnerInfluence = fixture.expectedWinnerRegions
        .filter((region) => region.expectedSourceIndex === sourceFrame.sourceIndex)
        .reduce((total, region) => total + regionInfluence(region, sourceFrame, x, y), 0);
      const nonWinnerInfluence = fixture.expectedWinnerRegions
        .filter((region) => region.expectedSourceIndex !== sourceFrame.sourceIndex)
        .reduce((total, region) => total + regionInfluence(region, sourceFrame, x, y), 0);
      const scalePenalty = Math.abs(1 - sourceFrame.expectedScale) * 0.6;
      const texture = checker * (winnerInfluence * 0.62 + nonWinnerInfluence * 0.08);
      const broadSignal = (x / sourceFrame.width) * 0.06 + (y / sourceFrame.height) * 0.04;
      pixels[y * sourceFrame.width + x] = Math.min(
        1,
        Math.max(
          0,
          0.24 +
            broadSignal +
            texture +
            stableNoise(fixture.generator.seed, sourceFrame.sourceIndex, x, y) -
            scalePenalty,
        ),
      );
    }
  }
  return pixels;
}

function sampleAligned(pixels, sourceFrame, x, y) {
  const sourceX = x + sourceFrame.expectedTranslationX;
  const sourceY = y + sourceFrame.expectedTranslationY;
  if (sourceX < 0 || sourceX >= sourceFrame.width || sourceY < 0 || sourceY >= sourceFrame.height) {
    return undefined;
  }
  return pixels[sourceY * sourceFrame.width + sourceX];
}

function scoreRegion(frame, sourceFrame, region) {
  let gradientEnergy = 0;
  let sampleCount = 0;
  const endX = region.x + region.width - 1;
  const endY = region.y + region.height - 1;

  for (let y = region.y + 1; y < endY; y += 1) {
    for (let x = region.x + 1; x < endX; x += 1) {
      const center = sampleAligned(frame, sourceFrame, x, y);
      const left = sampleAligned(frame, sourceFrame, x - 1, y);
      const up = sampleAligned(frame, sourceFrame, x, y - 1);
      if (center === undefined || left === undefined || up === undefined) {
        continue;
      }

      gradientEnergy += Math.abs(center - left) + Math.abs(center - up);
      sampleCount += 1;
    }
  }

  return gradientEnergy / Math.max(1, sampleCount);
}

function evaluateRegion(fixture, generatedFrames, region) {
  const scores = generatedFrames
    .map((generatedFrame) => ({
      score: Number(scoreRegion(generatedFrame.pixels, generatedFrame.sourceFrame, region).toFixed(6)),
      sourceIndex: generatedFrame.sourceFrame.sourceIndex,
    }))
    .sort((left, right) => right.score - left.score);

  const best = scores[0];
  const secondBest = scores[1];
  if (best === undefined || secondBest === undefined) {
    fail(`${fixture.fixtureId}: missing sharpness scores`, region);
  }

  const confidenceMargin = (best.score - secondBest.score) / Math.max(best.score, 0.0001);
  return SharpnessRegionResultSchema.parse({
    confidenceMargin: Number(confidenceMargin.toFixed(6)),
    regionId: region.regionId,
    scores,
    status: confidenceMargin >= MIN_CONFIDENCE_MARGIN ? 'confident' : 'low_confidence',
    winnerSourceIndex: best.sourceIndex,
  });
}

function lowConfidenceProbeRegion(fixture) {
  const referenceFrame = fixture.sourceFrames[0];
  return {
    expectedSourceIndex: referenceFrame.sourceIndex,
    height: 16,
    regionId: 'low-confidence-flat-probe',
    width: 16,
    x: Math.max(0, Math.floor(referenceFrame.width / 2) - 8),
    y: Math.max(0, referenceFrame.height - 24),
  };
}

const manifestJson = JSON.parse(await readFile(MANIFEST_PATH, 'utf8'));
const manifest = FocusFixtureManifestSchema.parse(manifestJson);
const reports = [];

for (const fixture of manifest.fixtures) {
  const generatedFrames = fixture.sourceFrames.map((sourceFrame) => ({
    pixels: createSharpnessFrame(fixture, sourceFrame),
    sourceFrame,
  }));
  const regionResults = fixture.expectedWinnerRegions.map((region) => evaluateRegion(fixture, generatedFrames, region));

  for (const result of regionResults) {
    const expectedRegion = fixture.expectedWinnerRegions.find((region) => region.regionId === result.regionId);
    if (expectedRegion === undefined) {
      fail(`${fixture.fixtureId}: missing expected region`, result);
    }
    if (result.winnerSourceIndex !== expectedRegion.expectedSourceIndex || result.status !== 'confident') {
      fail(`${fixture.fixtureId}: sharpness winner mismatch`, {
        expectedSourceIndex: expectedRegion.expectedSourceIndex,
        result,
      });
    }
  }

  const lowConfidenceResult = evaluateRegion(fixture, generatedFrames, lowConfidenceProbeRegion(fixture));
  if (lowConfidenceResult.status !== 'low_confidence') {
    fail(`${fixture.fixtureId}: low-confidence tracking did not trigger`, lowConfidenceResult);
  }

  reports.push({
    fixtureId: fixture.fixtureId,
    lowConfidenceRegions: [lowConfidenceResult.regionId],
    minConfidenceMargin: Math.min(...regionResults.map((result) => result.confidenceMargin)),
  });
}

console.log(`Validated ${reports.length} focus sharpness-map smoke fixtures.`);
for (const report of reports) {
  console.log(
    `${report.fixtureId}: minConfidenceMargin=${report.minConfidenceMargin.toFixed(3)} lowConfidenceRegions=${report.lowConfidenceRegions.join(',')}`,
  );
}
