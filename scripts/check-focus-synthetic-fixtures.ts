#!/usr/bin/env bun

import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { z } from 'zod';

const MANIFEST_PATH = resolve('fixtures/focus-stacking/focus-synthetic-bracket-fixtures.json');
const MAX_LONG_EDGE_PX = 512;
const BYTES_PER_PIXEL_RGBA = 4;

const FixtureStatusSchema = z.enum(['active_generated_asset', 'planned']);
const FixtureClassSchema = z.enum(['synthetic']);
const WarningCodeSchema = z.enum([
  'alignment_translation_required',
  'focus_breathing_detected',
  'focus_clipped_highlight_risk',
  'focus_exposure_mismatch',
  'focus_noise_penalty_applied',
  'focus_white_balance_mismatch',
]);

const GeneratorSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9-]+$/u),
    seed: z.string().min(1),
    version: z.number().int().positive(),
  })
  .strict();

const SourceFrameSchema = z
  .object({
    expectedScale: z.number().positive(),
    expectedTranslationX: z.number().int(),
    expectedTranslationY: z.number().int(),
    height: z.number().int().positive().max(MAX_LONG_EDGE_PX),
    sourceIndex: z.number().int().nonnegative(),
    width: z.number().int().positive().max(MAX_LONG_EDGE_PX),
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

const StaleSourceNegativeCaseSchema = z
  .object({
    expectedBlockCode: z.literal('stale_source_graph_revision'),
    originalGraphRevision: z.string().min(1),
    sourceIndex: z.number().int().nonnegative(),
    staleGraphRevision: z.string().min(1),
  })
  .strict()
  .refine((negativeCase) => negativeCase.originalGraphRevision !== negativeCase.staleGraphRevision, {
    message: 'staleGraphRevision must differ from originalGraphRevision.',
    path: ['staleGraphRevision'],
  });

const FocusFixtureSchema = z
  .object({
    class: FixtureClassSchema,
    expectedGeneratedSha256: z.string().regex(/^(pending|[a-f0-9]{64})$/u),
    expectedWarningCodes: z.array(WarningCodeSchema),
    expectedWinnerRegions: z.array(WinnerRegionSchema).min(3),
    fixtureId: z.string().regex(/^focus\.synthetic\.[a-z0-9.-]+\.v[0-9]+$/u),
    generator: GeneratorSchema,
    memoryBudgetBytes: z.number().int().positive(),
    notes: z.string().min(1),
    sourceFrames: z.array(SourceFrameSchema).length(3),
    staleSourceNegativeCase: StaleSourceNegativeCaseSchema.optional(),
    status: FixtureStatusSchema,
    validationPurpose: z.string().min(1),
  })
  .strict()
  .superRefine((fixture, context) => {
    const sourceIndices = fixture.sourceFrames.map((sourceFrame) => sourceFrame.sourceIndex);
    const uniqueSourceIndices = new Set(sourceIndices);
    if (uniqueSourceIndices.size !== sourceIndices.length) {
      context.addIssue({
        code: 'custom',
        message: 'sourceFrame sourceIndex values must be unique.',
        path: ['sourceFrames'],
      });
    }

    for (const region of fixture.expectedWinnerRegions) {
      if (!uniqueSourceIndices.has(region.expectedSourceIndex)) {
        context.addIssue({
          code: 'custom',
          message: 'Winner region expectedSourceIndex must reference a source frame.',
          path: ['expectedWinnerRegions'],
        });
      }

      const referenceFrame = fixture.sourceFrames[0];
      if (region.x + region.width > referenceFrame.width || region.y + region.height > referenceFrame.height) {
        context.addIssue({
          code: 'custom',
          message: 'Winner region must fit inside the fixture coordinate space.',
          path: ['expectedWinnerRegions', region.regionId],
        });
      }
    }

    if (
      fixture.sourceFrames.some(
        (sourceFrame) => sourceFrame.expectedTranslationX !== 0 || sourceFrame.expectedTranslationY !== 0,
      ) &&
      !fixture.expectedWarningCodes.includes('alignment_translation_required')
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Translated fixtures must include alignment_translation_required.',
        path: ['expectedWarningCodes'],
      });
    }

    if (
      fixture.sourceFrames.some((sourceFrame) => sourceFrame.expectedScale !== 1) &&
      !fixture.expectedWarningCodes.includes('focus_breathing_detected')
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Scale-varied fixtures must include focus_breathing_detected.',
        path: ['expectedWarningCodes'],
      });
    }

    if (fixture.staleSourceNegativeCase && !uniqueSourceIndices.has(fixture.staleSourceNegativeCase.sourceIndex)) {
      context.addIssue({
        code: 'custom',
        message: 'staleSourceNegativeCase sourceIndex must reference a source frame.',
        path: ['staleSourceNegativeCase', 'sourceIndex'],
      });
    }

    const sourcePixels = fixture.sourceFrames.reduce(
      (total, sourceFrame) => total + sourceFrame.width * sourceFrame.height,
      0,
    );
    const estimatedBytes = sourcePixels * BYTES_PER_PIXEL_RGBA;
    if (estimatedBytes > fixture.memoryBudgetBytes) {
      context.addIssue({
        code: 'custom',
        message: 'Synthetic focus fixture exceeds its declared memory budget.',
        path: ['memoryBudgetBytes'],
      });
    }
  });

const FocusFixtureManifestSchema = z
  .object({
    $schema: z.string().url(),
    fixtures: z.array(FocusFixtureSchema).length(3),
    issue: z.literal(1059),
    schemaVersion: z.literal(1),
    snapshotDate: z.string().date(),
  })
  .strict()
  .superRefine((manifest, context) => {
    const fixtureIds = manifest.fixtures.map((fixture) => fixture.fixtureId);
    const uniqueFixtureIds = new Set(fixtureIds);
    if (uniqueFixtureIds.size !== fixtureIds.length) {
      context.addIssue({
        code: 'custom',
        message: 'Focus synthetic fixture IDs must be unique.',
        path: ['fixtures'],
      });
    }

    const expectedFixtureIds = [
      'focus.synthetic.breathing-stale-source.v1',
      'focus.synthetic.three-plane.v1',
      'focus.synthetic.translated-three-plane.v1',
    ];
    const sortedFixtureIds = [...fixtureIds].sort();
    if (JSON.stringify(sortedFixtureIds) !== JSON.stringify(expectedFixtureIds)) {
      context.addIssue({
        code: 'custom',
        message: `Focus fixture manifest must contain the expected fixture IDs: ${expectedFixtureIds.join(', ')}.`,
        path: ['fixtures'],
      });
    }
  });

const shouldUpdate = process.argv.includes('--update');

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

function createFocusFrame(fixture, sourceFrame) {
  const header = `P6\n${sourceFrame.width} ${sourceFrame.height}\n255\n`;
  const pixels = new Uint8Array(sourceFrame.width * sourceFrame.height * 3);
  let cursor = 0;

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

      pixels[cursor] = Math.max(0, Math.min(255, value + breathingTint));
      pixels[cursor + 1] = Math.max(0, Math.min(255, value + sourceFrame.sourceIndex * 12));
      pixels[cursor + 2] = Math.max(0, Math.min(255, 255 - value + sourceFrame.sourceIndex * 18));
      cursor += 3;
    }
  }

  return Buffer.concat([Buffer.from(header), Buffer.from(pixels)]);
}

async function writeGeneratedSources(tempDir, fixture) {
  const writtenSources = [];
  for (const sourceFrame of fixture.sourceFrames) {
    const filePath = join(tempDir, `${fixture.fixtureId}.source-${sourceFrame.sourceIndex}.ppm`);
    await writeFile(filePath, createFocusFrame(fixture, sourceFrame));
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

function assertGeneratedHash(fixture, generatedSha256) {
  if (fixture.expectedGeneratedSha256 === 'pending') {
    if (!shouldUpdate) {
      throw new Error(`${fixture.fixtureId}: expectedGeneratedSha256 is pending; run with --update.`);
    }
    fixture.expectedGeneratedSha256 = generatedSha256;
    return;
  }

  if (fixture.expectedGeneratedSha256 !== generatedSha256) {
    throw new Error(
      `${fixture.fixtureId}: generated hash changed. expected=${fixture.expectedGeneratedSha256} actual=${generatedSha256}`,
    );
  }
}

const manifestJson = JSON.parse(await readFile(MANIFEST_PATH, 'utf8'));
const manifest = FocusFixtureManifestSchema.parse(manifestJson);
const tempDir = await mkdtemp(join(tmpdir(), 'rawengine-focus-fixtures-'));

try {
  for (const fixture of manifest.fixtures) {
    const generatedSources = await writeGeneratedSources(tempDir, fixture);
    const generatedSha256 = await hashGeneratedSources(generatedSources);
    assertGeneratedHash(fixture, generatedSha256);
    console.log(`${fixture.fixtureId}: generated=${generatedSources.length} sha256=${generatedSha256}`);
  }
} finally {
  await rm(tempDir, { force: true, recursive: true });
}

if (shouldUpdate) {
  await writeFile(MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`);
}

console.log(`Validated ${manifest.fixtures.length} synthetic focus bracket fixtures.`);
