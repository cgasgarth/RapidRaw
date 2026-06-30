#!/usr/bin/env bun

import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { z } from 'zod';

import {
  encodeSyntheticPanoramaPpmV1,
  renderSyntheticPanoramaStitchV1,
} from '../../../../packages/rawengine-schema/src/panorama/panoramaSyntheticStitch.ts';

const FixtureStatusSchema = z.enum(['active_metadata_only', 'active_generated_asset', 'planned']);
const WarningCodeSchema = z.enum([
  'excluded_sources',
  'high_memory_estimate',
  'legacy_full_frame_render',
  'memory_budget_exceeded',
  'tiled_render_required',
]);

const SourceFrameSchema = z
  .object({
    expectedOffsetX: z.number().int().nonnegative().nullable(),
    expectedOffsetY: z.number().int().nullable(),
    height: z.number().int().positive(),
    sourceIndex: z.number().int().nonnegative(),
    width: z.number().int().positive(),
  })
  .strict();

const ExpectedOutputSchema = z
  .object({
    excludedSourceCount: z.number().int().nonnegative(),
    height: z.number().int().positive(),
    stitchedSourceCount: z.number().int().positive(),
    width: z.number().int().positive(),
  })
  .strict();

const ExpectedMatchGraphSchema = z
  .object({
    expectedConnectedSourceIndices: z.array(z.number().int().nonnegative()).min(1),
    expectedExcludedSourceIndices: z.array(z.number().int().nonnegative()),
    minimumConnectedComponents: z.number().int().positive(),
  })
  .strict();

const PanoramaFixtureSchema = z
  .object({
    expectedMatchGraph: ExpectedMatchGraphSchema,
    expectedOutput: ExpectedOutputSchema,
    expectedWarningCodes: z.array(WarningCodeSchema),
    fixtureId: z.string().regex(/^panorama\.[a-z0-9.-]+\.v[0-9]+$/u),
    generator: z
      .object({
        id: z.string().min(1),
        seed: z.string().min(1),
        version: z.number().int().positive(),
      })
      .strict(),
    memoryBudgetBytes: z.number().int().positive(),
    sourceFrames: z.array(SourceFrameSchema).min(2),
    status: FixtureStatusSchema,
  })
  .passthrough();

const PanoramaFixtureManifestSchema = z
  .object({
    fixtures: z.array(PanoramaFixtureSchema).min(1),
    issue: z.literal(182),
    schemaVersion: z.literal(1),
  })
  .passthrough();

const MANIFEST_PATH = resolve('fixtures/panorama/panorama-fixture-manifest.json');
const OUTPUT_DIR = resolve('artifacts/panorama-synthetic-parity');
const MAX_SYNTHETIC_SOURCE_PIXELS = 1_000_000;

function fail(message, detail) {
  console.error(message);
  if (detail !== undefined) {
    console.error(JSON.stringify(detail, null, 2));
  }
  process.exit(1);
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

function createPpmFrame(fixture, sourceFrame) {
  const header = `P6\n${sourceFrame.width} ${sourceFrame.height}\n255\n`;
  const pixels = new Uint8Array(sourceFrame.width * sourceFrame.height * 3);
  let cursor = 0;
  for (let y = 0; y < sourceFrame.height; y += 1) {
    for (let x = 0; x < sourceFrame.width; x += 1) {
      const stripe = Math.floor((x + Math.max(sourceFrame.expectedOffsetX ?? 0, 0)) / 20) % 2;
      pixels[cursor] = stableByte(fixture.generator.seed, sourceFrame.sourceIndex, x, y, stripe);
      pixels[cursor + 1] = stableByte(fixture.generator.seed, sourceFrame.sourceIndex, x, y, 1);
      pixels[cursor + 2] = stableByte(fixture.generator.seed, sourceFrame.sourceIndex, x, y, 2);
      cursor += 3;
    }
  }
  return Buffer.concat([Buffer.from(header), Buffer.from(pixels)]);
}

async function writeGeneratedSources(tempDir, fixture) {
  const writtenSources = [];
  for (const sourceFrame of fixture.sourceFrames) {
    const pixelCount = sourceFrame.width * sourceFrame.height;
    if (pixelCount > MAX_SYNTHETIC_SOURCE_PIXELS) {
      continue;
    }

    const filePath = join(tempDir, `${fixture.fixtureId}.source-${sourceFrame.sourceIndex}.ppm`);
    await writeFile(filePath, createPpmFrame(fixture, sourceFrame));
    writtenSources.push({ filePath, sourceIndex: sourceFrame.sourceIndex });
  }
  return writtenSources;
}

async function hashGeneratedSources(sources) {
  const hasher = new Bun.CryptoHasher('sha256');
  for (const source of sources) {
    hasher.update(`${source.sourceIndex}:`);
    hasher.update(await readFile(source.filePath));
  }
  return hasher.digest('hex');
}

function deriveLegacyParityReport(fixture, generatedSources) {
  return {
    generatedSourceCount: generatedSources.length,
    minimumConnectedComponents: fixture.expectedMatchGraph.minimumConnectedComponents,
    ...renderSyntheticPanoramaStitchV1({
      connectedSourceIndices: fixture.expectedMatchGraph.expectedConnectedSourceIndices,
      expectedWarningCodes: fixture.expectedWarningCodes,
      fixtureId: fixture.fixtureId,
      memoryBudgetBytes: fixture.memoryBudgetBytes,
      seed: fixture.generator.seed,
      sourceFrames: fixture.sourceFrames,
    }),
  };
}

function assertEqual(actual, expected, label, fixtureId) {
  if (actual !== expected) {
    fail(`${fixtureId}: ${label} mismatch`, { actual, expected });
  }
}

function assertArrayEqual(actual, expected, label, fixtureId) {
  const sortedActual = [...actual].sort();
  const sortedExpected = [...expected].sort();
  if (JSON.stringify(sortedActual) !== JSON.stringify(sortedExpected)) {
    fail(`${fixtureId}: ${label} mismatch`, { actual: sortedActual, expected: sortedExpected });
  }
}

const manifestJson = JSON.parse(await readFile(MANIFEST_PATH, 'utf8'));
const manifest = PanoramaFixtureManifestSchema.parse(manifestJson);
const tempDir = await mkdtemp(join(tmpdir(), 'rawengine-panorama-parity-'));
await mkdir(OUTPUT_DIR, { recursive: true });

try {
  const parityResults = [];
  for (const fixture of manifest.fixtures) {
    if (!fixture.fixtureId.startsWith('panorama.synthetic.')) {
      continue;
    }

    const generatedSources = await writeGeneratedSources(tempDir, fixture);
    const parityReport = deriveLegacyParityReport(fixture, generatedSources);

    assertEqual(
      parityReport.stitchedSourceCount,
      fixture.expectedOutput.stitchedSourceCount,
      'stitched source count',
      fixture.fixtureId,
    );
    assertEqual(
      parityReport.excludedSourceCount,
      fixture.expectedOutput.excludedSourceCount,
      'excluded source count',
      fixture.fixtureId,
    );
    assertEqual(parityReport.output.width, fixture.expectedOutput.width, 'output width', fixture.fixtureId);
    assertEqual(parityReport.output.height, fixture.expectedOutput.height, 'output height', fixture.fixtureId);
    assertEqual(parityReport.output.projection, 'rectilinear', 'projection', fixture.fixtureId);
    assertEqual(
      parityReport.minimumConnectedComponents,
      fixture.expectedMatchGraph.minimumConnectedComponents,
      'minimum connected components',
      fixture.fixtureId,
    );
    assertArrayEqual(parityReport.warningCodes, fixture.expectedWarningCodes, 'warning codes', fixture.fixtureId);

    const outputArtifactPath = join(OUTPUT_DIR, `${fixture.fixtureId}.stitched.ppm`);
    let outputHash = null;
    if (parityReport.outputPixels !== null) {
      const outputBytes = encodeSyntheticPanoramaPpmV1(
        parityReport.outputPixels,
        parityReport.output.width,
        parityReport.output.height,
      );
      await writeFile(outputArtifactPath, outputBytes);
      outputHash = new Bun.CryptoHasher('sha256').update(outputBytes).digest('hex');
    }

    parityResults.push({
      fixtureId: fixture.fixtureId,
      generatedSourceCount: generatedSources.length,
      outputArtifactPath: parityReport.outputPixels === null ? null : outputArtifactPath,
      outputHash,
      sourceHash: await hashGeneratedSources(generatedSources),
    });
  }

  if (parityResults.length !== 3) {
    fail('Expected three synthetic panorama parity fixtures.', parityResults);
  }

  console.log(`Validated ${parityResults.length} synthetic panorama parity fixtures.`);
  for (const result of parityResults) {
    console.log(
      `${result.fixtureId}: generated=${result.generatedSourceCount} sourceSha256=${result.sourceHash} outputSha256=${result.outputHash ?? 'plan-only'}`,
    );
  }
} finally {
  await rm(tempDir, { force: true, recursive: true });
}
