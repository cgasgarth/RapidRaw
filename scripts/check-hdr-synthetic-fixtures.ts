#!/usr/bin/env bun

import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { format, resolveConfig } from 'prettier';
import { z } from 'zod';

const MANIFEST_PATH = resolve('fixtures/hdr/hdr-synthetic-bracket-fixtures.json');
const MAX_LONG_EDGE_PX = 512;
const BYTES_PER_PIXEL_RGB = 3;

const FixtureStatusSchema = z.enum(['active_generated_asset', 'planned']);
const FixtureClassSchema = z.enum(['synthetic']);
const WarningCodeSchema = z.enum([
  'alignment_translation_required',
  'clipped_highlight_recovery',
  'deghosting_required',
  'exposure_gap_too_large',
  'missing_short_exposure',
]);
const GhostRiskSchema = z.enum(['low', 'medium', 'high']);

const GeneratorSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9-]+$/u),
    seed: z.string().min(1),
    version: z.number().int().positive(),
  })
  .strict();

const SourceFrameSchema = z
  .object({
    expectedTranslationX: z.number().int(),
    expectedTranslationY: z.number().int(),
    exposureEv: z.number().int().min(-6).max(6),
    height: z.number().int().positive().max(MAX_LONG_EDGE_PX),
    sourceIndex: z.number().int().nonnegative(),
    width: z.number().int().positive().max(MAX_LONG_EDGE_PX),
  })
  .strict();

const RegionSchema = z
  .object({
    height: z.number().int().positive(),
    regionId: z.string().regex(/^[a-z0-9-]+$/u),
    width: z.number().int().positive(),
    x: z.number().int().nonnegative(),
    y: z.number().int().nonnegative(),
  })
  .strict();

const HighlightRecoveryRegionSchema = RegionSchema.extend({
  requiresShortExposure: z.boolean(),
}).strict();

const MotionRegionSchema = RegionSchema.extend({
  expectedGhostRisk: GhostRiskSchema,
}).strict();

const HdrFixtureSchema = z
  .object({
    class: FixtureClassSchema,
    expectedGeneratedSha256: z.string().regex(/^(pending|[a-f0-9]{64})$/u),
    expectedWarningCodes: z.array(WarningCodeSchema),
    fixtureId: z.string().regex(/^hdr\.synthetic\.[a-z0-9.-]+\.v[0-9]+$/u),
    generator: GeneratorSchema,
    highlightRecoveryRegions: z.array(HighlightRecoveryRegionSchema).min(1),
    memoryBudgetBytes: z.number().int().positive(),
    motionRegions: z.array(MotionRegionSchema),
    notes: z.string().min(1),
    sourceFrames: z.array(SourceFrameSchema).length(3),
    status: FixtureStatusSchema,
    validationPurpose: z.string().min(1),
  })
  .strict()
  .superRefine((fixture, context) => {
    const sourceIndexes = fixture.sourceFrames.map((sourceFrame) => sourceFrame.sourceIndex);
    if (new Set(sourceIndexes).size !== sourceIndexes.length) {
      context.addIssue({
        code: 'custom',
        message: 'HDR sourceFrame sourceIndex values must be unique.',
        path: ['sourceFrames'],
      });
    }

    const exposureValues = fixture.sourceFrames
      .map((sourceFrame) => sourceFrame.exposureEv)
      .sort((left, right) => left - right);
    if (
      new Set(exposureValues).size !== exposureValues.length ||
      exposureValues[0] >= 0 ||
      exposureValues.at(-1) <= 0
    ) {
      context.addIssue({
        code: 'custom',
        message: 'HDR fixtures require unique negative, middle, and positive exposure brackets.',
        path: ['sourceFrames'],
      });
    }

    if (Math.max(...exposureValues.slice(1).map((exposureEv, index) => exposureEv - exposureValues[index])) > 4) {
      context.addIssue({
        code: 'custom',
        message: 'HDR exposure gaps above 4 EV need an explicit exposure_gap_too_large warning.',
        path: ['expectedWarningCodes'],
      });
    }

    const referenceFrame = fixture.sourceFrames[0];
    for (const sourceFrame of fixture.sourceFrames) {
      if (sourceFrame.width !== referenceFrame.width || sourceFrame.height !== referenceFrame.height) {
        context.addIssue({
          code: 'custom',
          message: 'Synthetic HDR fixture frames must share dimensions.',
          path: ['sourceFrames', sourceFrame.sourceIndex],
        });
      }
    }

    const hasTranslation = fixture.sourceFrames.some(
      (sourceFrame) => sourceFrame.expectedTranslationX !== 0 || sourceFrame.expectedTranslationY !== 0,
    );
    if (hasTranslation && !fixture.expectedWarningCodes.includes('alignment_translation_required')) {
      context.addIssue({
        code: 'custom',
        message: 'Translated HDR fixtures must include alignment_translation_required.',
        path: ['expectedWarningCodes'],
      });
    }

    if (fixture.motionRegions.length > 0 && !fixture.expectedWarningCodes.includes('deghosting_required')) {
      context.addIssue({
        code: 'custom',
        message: 'HDR fixtures with motion regions must include deghosting_required.',
        path: ['expectedWarningCodes'],
      });
    }

    for (const region of [...fixture.highlightRecoveryRegions, ...fixture.motionRegions]) {
      if (region.x + region.width > referenceFrame.width || region.y + region.height > referenceFrame.height) {
        context.addIssue({
          code: 'custom',
          message: 'HDR validation regions must fit inside the fixture coordinate space.',
          path: ['region', region.regionId],
        });
      }
    }

    const sourceBytes = fixture.sourceFrames.reduce(
      (total, sourceFrame) => total + sourceFrame.width * sourceFrame.height * BYTES_PER_PIXEL_RGB,
      0,
    );
    if (sourceBytes > fixture.memoryBudgetBytes) {
      context.addIssue({
        code: 'custom',
        message: 'Synthetic HDR fixture exceeds its declared memory budget.',
        path: ['memoryBudgetBytes'],
      });
    }
  });

const HdrFixtureManifestSchema = z
  .object({
    $schema: z.string().url(),
    fixtures: z.array(HdrFixtureSchema).length(3),
    issue: z.literal(169),
    schemaVersion: z.literal(1),
    snapshotDate: z.string().date(),
  })
  .strict()
  .superRefine((manifest, context) => {
    const fixtureIds = manifest.fixtures.map((fixture) => fixture.fixtureId);
    if (new Set(fixtureIds).size !== fixtureIds.length) {
      context.addIssue({
        code: 'custom',
        message: 'HDR synthetic fixture IDs must be unique.',
        path: ['fixtures'],
      });
    }

    const expectedFixtureIds = [
      'hdr.synthetic.handheld-motion.v1',
      'hdr.synthetic.highlight-clipping.v1',
      'hdr.synthetic.static-window.v1',
    ];
    if (JSON.stringify([...fixtureIds].sort()) !== JSON.stringify(expectedFixtureIds)) {
      context.addIssue({
        code: 'custom',
        message: `HDR fixture manifest must contain the expected fixture IDs: ${expectedFixtureIds.join(', ')}.`,
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

function sceneRadiance(fixture, sourceFrame, x, y, channel) {
  const baseGradient = 0.08 + (x / sourceFrame.width) * 0.22 + (y / sourceFrame.height) * 0.16;
  const texture = (stableByte(fixture.generator.seed, sourceFrame.sourceIndex, x, y, channel) / 255) * 0.08;
  const highlightBoost = fixture.highlightRecoveryRegions.reduce(
    (total, region) => total + regionInfluence(region, sourceFrame, x, y) * 1.6,
    0,
  );
  const motionBoost = fixture.motionRegions.reduce((total, region) => {
    const shiftedRegion = {
      ...region,
      x: region.x + sourceFrame.sourceIndex * 7,
      y: region.y + (sourceFrame.sourceIndex % 2) * 3,
    };
    return total + regionInfluence(shiftedRegion, sourceFrame, x, y) * 0.55;
  }, 0);
  return Math.max(0, baseGradient + texture + highlightBoost + motionBoost + channel * 0.015);
}

function createHdrFrame(fixture, sourceFrame) {
  const header = `P6\n${sourceFrame.width} ${sourceFrame.height}\n255\n`;
  const pixels = new Uint8Array(sourceFrame.width * sourceFrame.height * 3);
  const exposureMultiplier = 2 ** sourceFrame.exposureEv;
  let cursor = 0;

  for (let y = 0; y < sourceFrame.height; y += 1) {
    for (let x = 0; x < sourceFrame.width; x += 1) {
      for (let channel = 0; channel < 3; channel += 1) {
        const radiance = sceneRadiance(fixture, sourceFrame, x, y, channel);
        pixels[cursor] = Math.max(0, Math.min(255, Math.round(radiance * exposureMultiplier * 255)));
        cursor += 1;
      }
    }
  }

  return Buffer.concat([Buffer.from(header), Buffer.from(pixels)]);
}

async function writeGeneratedSources(tempDir, fixture) {
  const writtenSources = [];
  for (const sourceFrame of fixture.sourceFrames) {
    const filePath = join(tempDir, `${fixture.fixtureId}.source-${sourceFrame.sourceIndex}.ppm`);
    await writeFile(filePath, createHdrFrame(fixture, sourceFrame));
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

function assertHighlightRecoveryFixture(fixture) {
  const shortestExposure = fixture.sourceFrames.reduce((current, sourceFrame) =>
    sourceFrame.exposureEv < current.exposureEv ? sourceFrame : current,
  );
  const longestExposure = fixture.sourceFrames.reduce((current, sourceFrame) =>
    sourceFrame.exposureEv > current.exposureEv ? sourceFrame : current,
  );

  for (const region of fixture.highlightRecoveryRegions) {
    const centerX = Math.floor(region.x + region.width / 2);
    const centerY = Math.floor(region.y + region.height / 2);
    const shortRadiance =
      sceneRadiance(fixture, shortestExposure, centerX, centerY, 0) * 2 ** shortestExposure.exposureEv;
    const longRadiance = sceneRadiance(fixture, longestExposure, centerX, centerY, 0) * 2 ** longestExposure.exposureEv;
    if (region.requiresShortExposure && shortRadiance >= 1) {
      throw new Error(`${fixture.fixtureId}: short exposure clips highlight recovery region ${region.regionId}.`);
    }
    if (longRadiance < 1) {
      throw new Error(
        `${fixture.fixtureId}: long exposure does not clip highlight recovery region ${region.regionId}.`,
      );
    }
  }
}

const manifestJson = JSON.parse(await readFile(MANIFEST_PATH, 'utf8'));
const manifest = HdrFixtureManifestSchema.parse(manifestJson);
const tempDir = await mkdtemp(join(tmpdir(), 'rawengine-hdr-fixtures-'));

try {
  for (const fixture of manifest.fixtures) {
    const generatedSources = await writeGeneratedSources(tempDir, fixture);
    const generatedSha256 = await hashGeneratedSources(generatedSources);
    assertGeneratedHash(fixture, generatedSha256);
    assertHighlightRecoveryFixture(fixture);
    console.log(`${fixture.fixtureId}: generated=3 sha256=${generatedSha256}`);
  }
} finally {
  await rm(tempDir, { force: true, recursive: true });
}

if (shouldUpdate) {
  const prettierOptions = (await resolveConfig(MANIFEST_PATH)) ?? {};
  const formattedManifest = await format(JSON.stringify(manifest, null, 2), {
    ...prettierOptions,
    filepath: MANIFEST_PATH,
    parser: 'json',
  });
  await writeFile(MANIFEST_PATH, formattedManifest);
}

console.log(`Validated ${manifest.fixtures.length} synthetic HDR bracket fixtures.`);
