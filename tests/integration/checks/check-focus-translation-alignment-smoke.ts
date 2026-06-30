#!/usr/bin/env bun

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { performance } from 'node:perf_hooks';

import { z } from 'zod';

import { estimateFocusStackAlignmentV1 } from '../../../packages/rawengine-schema/src/focus-stack/focusStackAlignmentRuntime.ts';

const MANIFEST_PATH = resolve('fixtures/focus-stacking/focus-synthetic-bracket-fixtures.json');
const SEARCH_RADIUS_PIXELS = 6;
const MIN_COVERAGE_RATIO = 0.9;
const MAX_RESIDUAL = 0.004;
const MIN_CONFIDENCE = 0.85;
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

const FocusFixtureSchema = z
  .object({
    expectedWarningCodes: z.array(z.string().min(1)),
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
    if (sourceIndexes.size !== fixture.sourceFrames.length) {
      context.addIssue({
        code: 'custom',
        message: 'sourceFrame sourceIndex values must be unique.',
        path: ['sourceFrames'],
      });
    }

    const referenceFrame = fixture.sourceFrames[0];
    if (
      fixture.sourceFrames.some(
        (sourceFrame) => sourceFrame.width !== referenceFrame.width || sourceFrame.height !== referenceFrame.height,
      )
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Translation smoke requires equal frame dimensions inside a fixture.',
        path: ['sourceFrames'],
      });
    }
  });

const FocusFixtureManifestSchema = z
  .object({
    fixtures: z.array(FocusFixtureSchema).min(1),
    issue: z.literal(1059),
    schemaVersion: z.literal(1),
  })
  .passthrough();

function fail(message, detail) {
  console.error(message);
  if (detail !== undefined) {
    console.error(JSON.stringify(detail, null, 2));
  }
  process.exit(1);
}

function stableNoise(seed, x, y) {
  let value = 2166136261;
  const input = `${seed}:${x}:${y}`;
  for (let index = 0; index < input.length; index += 1) {
    value ^= input.charCodeAt(index);
    value = Math.imul(value, 16777619) >>> 0;
  }
  return (value % 41) / 255;
}

function basePixel(seed, width, height, x, y) {
  const diagonal = ((x * 7 + y * 11) % 29) / 255;
  const checker = ((Math.floor(x / 3) + Math.floor(y / 5)) % 2) * 0.18;
  const gradient = (x / width) * 0.13 + (y / height) * 0.09;
  return Math.min(1, Math.max(0, 0.24 + gradient + checker + diagonal + stableNoise(seed, x, y)));
}

function createTranslatedScene(fixture, sourceFrame) {
  const pixels = new Float32Array(sourceFrame.width * sourceFrame.height);
  for (let y = 0; y < sourceFrame.height; y += 1) {
    for (let x = 0; x < sourceFrame.width; x += 1) {
      const baseX = x - sourceFrame.expectedTranslationX;
      const baseY = y - sourceFrame.expectedTranslationY;
      pixels[y * sourceFrame.width + x] =
        baseX >= 0 && baseX < sourceFrame.width && baseY >= 0 && baseY < sourceFrame.height
          ? basePixel(fixture.generator.seed, sourceFrame.width, sourceFrame.height, baseX, baseY)
          : 0;
    }
  }
  return pixels;
}

function expectedAlignmentTranslation(referenceFrame, candidateFrame) {
  return {
    dx: referenceFrame.expectedTranslationX - candidateFrame.expectedTranslationX,
    dy: referenceFrame.expectedTranslationY - candidateFrame.expectedTranslationY,
  };
}

function assertEqual(actual, expected, label, fixtureId) {
  if (actual !== expected) {
    fail(`${fixtureId}: ${label} mismatch`, { actual, expected });
  }
}

function isPureTranslationFixture(fixture) {
  return fixture.sourceFrames.every((sourceFrame) => sourceFrame.expectedScale === 1);
}

function assertScaleFixturesAreNotPureTranslation(manifest) {
  const scaledFixtures = manifest.fixtures.filter((fixture) =>
    fixture.sourceFrames.some((sourceFrame) => sourceFrame.expectedScale !== 1),
  );
  if (scaledFixtures.length === 0) {
    fail('Missing scale-varied focus fixture for translation smoke guardrail.');
  }

  for (const fixture of scaledFixtures) {
    if (isPureTranslationFixture(fixture)) {
      fail(`${fixture.fixtureId}: scale-varied fixture was accepted as pure translation.`);
    }
    if (!fixture.expectedWarningCodes.includes('focus_breathing_detected')) {
      fail(`${fixture.fixtureId}: scale-varied fixture must carry focus_breathing_detected warning.`);
    }
  }

  return scaledFixtures.map((fixture) => fixture.fixtureId);
}

function assertWarningPath(fixture, referenceFrame) {
  const reference = createTranslatedScene(fixture, referenceFrame);
  const flatCandidate = new Float32Array(reference.length);
  flatCandidate.fill(0.5);

  const result = estimateFocusStackAlignmentV1({
    frames: [
      {
        height: referenceFrame.height,
        pixels: reference,
        sourceIndex: referenceFrame.sourceIndex,
        width: referenceFrame.width,
      },
      {
        height: referenceFrame.height,
        pixels: flatCandidate,
        sourceIndex: 99,
        width: referenceFrame.width,
      },
    ],
    maxResidual: MAX_RESIDUAL,
    minConfidence: MIN_CONFIDENCE,
    minCoverageRatio: MIN_COVERAGE_RATIO,
    referenceSourceIndex: referenceFrame.sourceIndex,
    searchRadiusPx: SEARCH_RADIUS_PIXELS,
  });

  const candidateDiagnostic = result.diagnostics.find((diagnostic) => diagnostic.sourceIndex === 99);
  if (candidateDiagnostic === undefined) {
    fail(`${fixture.fixtureId}: missing flat candidate diagnostic`, result);
  }
  if (
    !candidateDiagnostic.warningCodes.includes('alignment_high_residual') ||
    !candidateDiagnostic.warningCodes.includes('alignment_low_confidence') ||
    !candidateDiagnostic.blockCodes.includes('alignment_high_residual') ||
    candidateDiagnostic.status !== 'blocked' ||
    !result.blocked
  ) {
    fail(`${fixture.fixtureId}: high-residual warning path did not trigger`, result);
  }
}

const startedAt = performance.now();
const manifestJson = JSON.parse(await readFile(MANIFEST_PATH, 'utf8'));
const manifest = FocusFixtureManifestSchema.parse(manifestJson);
const scaledFixtureIds = assertScaleFixturesAreNotPureTranslation(manifest);

const reports = [];
for (const fixture of manifest.fixtures.filter(isPureTranslationFixture)) {
  const referenceFrame = fixture.sourceFrames.find((sourceFrame) => sourceFrame.sourceIndex === 0);
  if (referenceFrame === undefined) {
    fail(`${fixture.fixtureId}: missing source index 0 reference`);
  }

  const alignment = estimateFocusStackAlignmentV1({
    frames: fixture.sourceFrames.map((sourceFrame) => ({
      height: sourceFrame.height,
      pixels: createTranslatedScene(fixture, sourceFrame),
      sourceIndex: sourceFrame.sourceIndex,
      width: sourceFrame.width,
    })),
    maxResidual: MAX_RESIDUAL,
    minConfidence: MIN_CONFIDENCE,
    minCoverageRatio: MIN_COVERAGE_RATIO,
    referenceSourceIndex: referenceFrame.sourceIndex,
    searchRadiusPx: SEARCH_RADIUS_PIXELS,
  });
  assertEqual(alignment.referenceSource.sourceIndex, referenceFrame.sourceIndex, 'reference source', fixture.fixtureId);
  assertEqual(alignment.referenceSource.reason, 'requested_source_index', 'reference reason', fixture.fixtureId);
  if (alignment.blocked) {
    fail(`${fixture.fixtureId}: pure translation fixture was blocked`, alignment);
  }

  const results = [];
  for (const sourceFrame of fixture.sourceFrames) {
    const result = alignment.diagnostics.find((diagnostic) => diagnostic.sourceIndex === sourceFrame.sourceIndex);
    if (result === undefined) {
      fail(`${fixture.fixtureId}: missing source ${sourceFrame.sourceIndex} diagnostic`, alignment);
    }
    const expected = expectedAlignmentTranslation(referenceFrame, sourceFrame);

    assertEqual(result.translation.dx, expected.dx, `source ${sourceFrame.sourceIndex} dx`, fixture.fixtureId);
    assertEqual(result.translation.dy, expected.dy, `source ${sourceFrame.sourceIndex} dy`, fixture.fixtureId);
    if (result.warningCodes.length > 0) {
      fail(`${fixture.fixtureId}: unexpected alignment warnings`, result);
    }
    results.push(result);
  }

  assertWarningPath(fixture, referenceFrame);
  reports.push({
    fixtureId: fixture.fixtureId,
    maxResidual: Math.max(...results.map((result) => result.residual)),
    minConfidence: Math.min(...results.map((result) => result.confidence)),
  });
}

if (reports.length === 0) {
  fail('No pure translation focus fixtures were available for alignment smoke.');
}

const elapsedMs = performance.now() - startedAt;
if (elapsedMs > TIER_1_BUDGET_MS) {
  fail('Focus translation alignment smoke exceeded Tier 1 budget', {
    budgetMs: TIER_1_BUDGET_MS,
    elapsedMs: Number(elapsedMs.toFixed(3)),
  });
}

console.log(`Validated ${reports.length} focus translation alignment smoke fixtures in ${Math.round(elapsedMs)}ms.`);
for (const report of reports) {
  console.log(
    `${report.fixtureId}: minConfidence=${report.minConfidence.toFixed(3)} maxResidual=${report.maxResidual.toFixed(4)}`,
  );
}
console.log(`Skipped ${scaledFixtureIds.length} scale-varied fixtures: ${scaledFixtureIds.join(', ')}`);
