#!/usr/bin/env bun

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';

import { format, resolveConfig } from 'prettier';
import { z } from 'zod';

import { negativeLabFixtureManifestV1Schema } from '../../../packages/rawengine-schema/src/rawEngineSchemas.ts';
import {
  assertRenderEligibleRealFixture,
  buildPromotedRealFixture,
} from '../../../scripts/lib/negative-lab-validation.ts';

const manifestUrl = new URL('../../../fixtures/negative-lab/negative-lab-real-fixture-manifest.json', import.meta.url);
const sampleGridUrl = new URL(
  '../../../fixtures/negative-lab/public/110-format-ericht-negative-cc0-samples.json',
  import.meta.url,
);
const renderProofUrl = new URL(
  '../../../docs/validation/negative-lab-real-render-proof-2026-06-17.json',
  import.meta.url,
);
const manifest = negativeLabFixtureManifestV1Schema.parse(JSON.parse(await readFile(manifestUrl, 'utf8')));
const args = new Set(process.argv.slice(2));
const shouldUpdate = args.has('--update');

const requiredSlots = [
  'negative_lab.real.pending.c41_color_negative_001',
  'negative_lab.real.pending.bw_silver_negative_001',
  'negative_lab.real.pending.c41_dense_thin_roll_001',
  'negative_lab.real.pending.c41_mixed_lighting_001',
];

const publicRenderFixtureId = 'negative_lab.real.public.cc0_110_ericht_negative_001';
const entriesById = new Map(manifest.entries.map((entry) => [entry.fixtureId, entry]));
const rgbTripletSchema = z.tuple([z.number().min(0).max(1), z.number().min(0).max(1), z.number().min(0).max(1)]);
const sampleGridSchema = z
  .object({
    fixtureId: z.literal(publicRenderFixtureId),
    sampleGrid: z.array(z.array(rgbTripletSchema).min(1)).min(1),
    schemaVersion: z.literal(1),
    sourceImagePath: z.literal('fixtures/negative-lab/public/110-format-ericht-negative-cc0-320.jpg'),
    sourceImageSha256: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
  })
  .strict();
const renderProofSchema = z
  .object({
    changedPixelCount: z.number().int().positive(),
    fixtureId: z.literal(publicRenderFixtureId),
    inputSha256: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
    meanAbsInputDelta: z.number().min(0).max(1),
    metrics: z
      .object({
        changedPixelCount: z.number().int().positive(),
        changedSampleRatio: z.number().min(0).max(1),
        meanAbsInputDelta: z.number().min(0).max(1),
        warningCount: z.number().int().positive(),
      })
      .strict(),
    outputIntent: z.literal('public_fixture_negative_conversion_smoke'),
    provenance: z
      .object({
        commandName: z.literal('negative.lab.public_fixture_render_smoke'),
        fixtureSourceUrl: z.url(),
        licenseName: z.literal('CC0 1.0 Universal Public Domain Dedication'),
        noStockOrProfileClaim: z.literal(true),
        sourceFixtureId: z.literal(publicRenderFixtureId),
      })
      .strict(),
    renderedSampleGrid: z.array(z.array(rgbTripletSchema).min(1)).min(1),
    schemaVersion: z.literal(1),
    validationMode: z.literal('public_fixture_negative_conversion_smoke'),
    warningCodes: z.array(z.string().min(1)).min(1),
  })
  .strict()
  .superRefine((proof, context) => {
    if (proof.meanAbsInputDelta < 0.2) {
      context.addIssue({
        code: 'custom',
        message: 'Real Negative Lab render proof must materially modify sampled public negative pixels.',
        path: ['meanAbsInputDelta'],
      });
    }
  });

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));
const calculateSha256 = (bytes: Buffer) => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;

const meanAbsDelta = (left: number[][][], right: number[][][]) => {
  let count = 0;
  let sum = 0;

  for (const [rowIndex, row] of left.entries()) {
    const rightRow = right[rowIndex];
    if (rightRow === undefined) throw new Error(`Missing comparison row ${rowIndex}.`);

    for (const [pixelIndex, pixel] of row.entries()) {
      const rightPixel = rightRow[pixelIndex];
      if (rightPixel === undefined) throw new Error(`Missing comparison pixel ${rowIndex}:${pixelIndex}.`);

      for (const [channelIndex, channel] of pixel.entries()) {
        const rightChannel = rightPixel[channelIndex];
        if (rightChannel === undefined) throw new Error(`Missing comparison channel ${rowIndex}:${pixelIndex}.`);
        sum += Math.abs(channel - rightChannel);
        count += 1;
      }
    }
  }

  return sum / count;
};

const renderPositiveSampleGrid = (sampleGrid: number[][][]) => {
  const baseFog = sampleGrid[0]?.[0];
  if (baseFog === undefined) throw new Error('Public real fixture sample grid requires a base/fog sample.');

  return sampleGrid.map((row) =>
    row.map((pixel) =>
      pixel.map((channel, channelIndex) => {
        const baseChannel = baseFog[channelIndex];
        if (baseChannel === undefined) throw new Error(`Missing base/fog channel ${channelIndex}.`);
        const normalizedNegative = channel / Math.max(baseChannel, 0.001);
        const positive = 1 - normalizedNegative;

        return Number(clamp01(positive * 1.08 + 0.02).toFixed(6));
      }),
    ),
  );
};

const assertPromotionGate = () => {
  assertRenderEligibleRealFixture(buildPromotedRealFixture(manifest.entries[0]));

  for (const [label, fixture] of [
    ['missing hash', buildPromotedRealFixture(manifest.entries[0], { contentHash: undefined })],
    ['metadata only', buildPromotedRealFixture(manifest.entries[0], { payloadAccess: 'metadata_only' })],
    ['no base sample', buildPromotedRealFixture(manifest.entries[0], { baseFogSampleRegions: [] })],
    [
      'unknown scanner settings',
      buildPromotedRealFixture(manifest.entries[0], { scannerSoftwareSettingsKnown: false }),
    ],
    [
      'blocked render use',
      buildPromotedRealFixture(manifest.entries[0], {
        allowedValidationUses: ['schema_roundtrip'],
        disallowedValidationUses: ['density_math_reference', 'warning_stability', 'profile_measurement'],
      }),
    ],
  ]) {
    try {
      assertRenderEligibleRealFixture(fixture);
      throw new Error(`Real Negative Lab promotion gate accepted invalid fixture: ${label}`);
    } catch (error) {
      if (
        error instanceof Error &&
        error.message === `Real Negative Lab promotion gate accepted invalid fixture: ${label}`
      ) {
        throw error;
      }
    }
  }
};

for (const fixtureId of requiredSlots) {
  const entry = entriesById.get(fixtureId);
  if (entry === undefined) {
    throw new Error(`Missing real Negative Lab fixture slot: ${fixtureId}`);
  }

  if (entry.payloadAccess !== 'metadata_only' || entry.contentHash !== undefined) {
    throw new Error(
      `Pending real Negative Lab fixture must stay metadata-only until payload proof lands: ${fixtureId}`,
    );
  }

  for (const blockedUse of ['density_math_reference', 'roll_consistency', 'profile_measurement']) {
    if (!entry.disallowedValidationUses.includes(blockedUse)) {
      throw new Error(`Pending real Negative Lab fixture must block ${blockedUse}: ${fixtureId}`);
    }
  }

  if (!entry.expectedFixtureWarningCodes.includes('fixture_payload_not_public')) {
    throw new Error(`Pending real Negative Lab fixture must declare missing payload warning: ${fixtureId}`);
  }
}

assertPromotionGate();

const publicRenderFixture = entriesById.get(publicRenderFixtureId);
if (publicRenderFixture === undefined) {
  throw new Error(`Missing public render Negative Lab fixture: ${publicRenderFixtureId}`);
}
assertRenderEligibleRealFixture(publicRenderFixture);

const sampleGrid = sampleGridSchema.parse(JSON.parse(await readFile(sampleGridUrl, 'utf8')));
const imageBytes = readFileSync(sampleGrid.sourceImagePath);
const sourceImageSha256 = calculateSha256(imageBytes);
if (sampleGrid.sourceImageSha256 !== sourceImageSha256 || publicRenderFixture.contentHash !== sourceImageSha256) {
  throw new Error('Public Negative Lab fixture image hash does not match manifest/sample metadata.');
}

const renderedSampleGrid = renderPositiveSampleGrid(sampleGrid.sampleGrid);
const flattenedInputGrid = sampleGrid.sampleGrid.flat();
const changedPixelCount = renderedSampleGrid.flat().filter((pixel, pixelIndex) => {
  const sourcePixel = flattenedInputGrid[pixelIndex];
  if (sourcePixel === undefined) throw new Error(`Missing source pixel ${pixelIndex}.`);

  return pixel.some((channel, channelIndex) => Math.abs(channel - sourcePixel[channelIndex]) > 0.01);
}).length;
const meanAbsInputDelta = meanAbsDelta(renderedSampleGrid, sampleGrid.sampleGrid);
const renderProof = renderProofSchema.parse({
  changedPixelCount,
  fixtureId: publicRenderFixture.fixtureId,
  inputSha256: sourceImageSha256,
  meanAbsInputDelta,
  metrics: {
    changedPixelCount,
    changedSampleRatio: changedPixelCount / flattenedInputGrid.length,
    meanAbsInputDelta,
    warningCount: publicRenderFixture.expectedNegativeWarningCodes.length,
  },
  outputIntent: 'public_fixture_negative_conversion_smoke',
  provenance: {
    commandName: 'negative.lab.public_fixture_render_smoke',
    fixtureSourceUrl: publicRenderFixture.source.sourceUrl,
    licenseName: publicRenderFixture.source.licenseName,
    noStockOrProfileClaim: true,
    sourceFixtureId: publicRenderFixture.fixtureId,
  },
  renderedSampleGrid,
  schemaVersion: 1,
  validationMode: 'public_fixture_negative_conversion_smoke',
  warningCodes: publicRenderFixture.expectedNegativeWarningCodes,
});
const prettierConfig = (await resolveConfig(renderProofUrl.pathname)) ?? {};
const formattedRenderProof = await format(JSON.stringify(renderProof), {
  ...prettierConfig,
  filepath: renderProofUrl.pathname,
  parser: 'json',
});

if (shouldUpdate) {
  await Bun.write(renderProofUrl, formattedRenderProof);
  console.log('negative lab real render proof updated');
  process.exit(0);
}

if ((await readFile(renderProofUrl, 'utf8')) !== formattedRenderProof) {
  throw new Error('docs/validation/negative-lab-real-render-proof-2026-06-17.json is stale.');
}

const metadataOnlyCount = manifest.entries.filter((entry) => entry.payloadAccess === 'metadata_only').length;
console.log(
  `negative lab real fixtures ok (${metadataOnlyCount} metadata-only slots, ${renderProof.changedPixelCount} public render samples)`,
);
