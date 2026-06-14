#!/usr/bin/env bun

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { z } from 'zod';

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

const PanoramaFixtureSchema = z
  .object({
    class: z.enum(['synthetic', 'public_sample', 'project_owned', 'local_only']),
    expectedOutput: ExpectedOutputSchema,
    expectedWarningCodes: z.array(WarningCodeSchema),
    fixtureId: z.string().regex(/^panorama\.[a-z0-9.-]+\.v[0-9]+$/u),
    memoryBudgetBytes: z.number().int().positive(),
    sourceFrames: z.array(SourceFrameSchema).min(2),
    status: z.enum(['active_metadata_only', 'active_generated_asset', 'planned']),
  })
  .passthrough();

const PanoramaFixtureManifestSchema = z
  .object({
    fixtures: z.array(PanoramaFixtureSchema).min(1),
    issue: z.literal(182),
    schemaVersion: z.literal(1),
  })
  .passthrough();

const PerformanceFixtureSchema = z
  .object({
    ciMode: z.enum(['required-pr-metadata', 'manual-local', 'scheduled-nightly']),
    fixtureId: z.string().regex(/^panorama\.[a-z0-9.-]+\.v[0-9]+$/u),
    maxLongEdgePx: z.number().int().positive(),
    maxOutputPixels: z.number().int().positive(),
    maxSourceFrames: z.number().int().positive(),
    measurementMode: z.enum(['estimated', 'reported', 'observed']),
    memoryBudgetBytes: z.number().int().positive(),
    requiredWarningCodes: z.array(WarningCodeSchema),
    runtimeBudgetMs: z.number().int().positive(),
    tier: z.enum(['tier0-metadata-contract', 'tier1-tiny-smoke', 'tier2-representative-local', 'tier3-heavy-nightly']),
    validationPurpose: z.string().min(1),
  })
  .strict();

const PerformanceManifestSchema = z
  .object({
    $schema: z.string().url(),
    issue: z.literal(185),
    performanceFixtures: z.array(PerformanceFixtureSchema).min(1),
    policy: z.literal('metadata_only_pr_ci'),
    schemaVersion: z.literal(1),
    snapshotDate: z.string().date(),
  })
  .strict()
  .superRefine((manifest, context) => {
    const fixtureIds = manifest.performanceFixtures.map((fixture) => fixture.fixtureId);
    if (new Set(fixtureIds).size !== fixtureIds.length) {
      context.addIssue({
        code: 'custom',
        message: 'Panorama performance fixture IDs must be unique.',
        path: ['performanceFixtures'],
      });
    }

    const requiredPrFixtures = manifest.performanceFixtures.filter(
      (fixture) => fixture.ciMode === 'required-pr-metadata',
    );
    if (requiredPrFixtures.length < 2) {
      context.addIssue({
        code: 'custom',
        message: 'At least two required PR metadata performance fixtures are required.',
        path: ['performanceFixtures'],
      });
    }

    const hasNightlyTilingFixture = manifest.performanceFixtures.some(
      (fixture) =>
        fixture.ciMode === 'scheduled-nightly' &&
        fixture.requiredWarningCodes.includes('memory_budget_exceeded') &&
        fixture.requiredWarningCodes.includes('tiled_render_required'),
    );
    if (!hasNightlyTilingFixture) {
      context.addIssue({
        code: 'custom',
        message: 'At least one scheduled/nightly tiling sentinel fixture is required.',
        path: ['performanceFixtures'],
      });
    }
  });

const manifestPath = resolve('fixtures/panorama/panorama-fixture-manifest.json');
const performanceManifestPath = resolve('fixtures/panorama/panorama-performance-fixtures.json');

const fixtureManifest = PanoramaFixtureManifestSchema.parse(JSON.parse(await readFile(manifestPath, 'utf8')));
const performanceManifest = PerformanceManifestSchema.parse(
  JSON.parse(await readFile(performanceManifestPath, 'utf8')),
);

const fixturesById = new Map(fixtureManifest.fixtures.map((fixture) => [fixture.fixtureId, fixture]));
const failures = [];

for (const performanceFixture of performanceManifest.performanceFixtures) {
  const fixture = fixturesById.get(performanceFixture.fixtureId);
  if (!fixture) {
    failures.push(`${performanceFixture.fixtureId}: referenced panorama fixture does not exist.`);
    continue;
  }

  const sourceCount = fixture.sourceFrames.length;
  const maxLongEdgePx = Math.max(...fixture.sourceFrames.flatMap((source) => [source.width, source.height]));
  const outputPixels = fixture.expectedOutput.width * fixture.expectedOutput.height;

  if (sourceCount > performanceFixture.maxSourceFrames) {
    failures.push(
      `${performanceFixture.fixtureId}: source count ${sourceCount} exceeds budget ${performanceFixture.maxSourceFrames}.`,
    );
  }

  if (maxLongEdgePx > performanceFixture.maxLongEdgePx) {
    failures.push(
      `${performanceFixture.fixtureId}: long edge ${maxLongEdgePx}px exceeds budget ${performanceFixture.maxLongEdgePx}px.`,
    );
  }

  if (outputPixels > performanceFixture.maxOutputPixels) {
    failures.push(
      `${performanceFixture.fixtureId}: output pixels ${outputPixels} exceeds budget ${performanceFixture.maxOutputPixels}.`,
    );
  }

  if (performanceFixture.memoryBudgetBytes > fixture.memoryBudgetBytes) {
    failures.push(
      `${performanceFixture.fixtureId}: performance memory budget exceeds fixture memory budget ${fixture.memoryBudgetBytes}.`,
    );
  }

  for (const warningCode of performanceFixture.requiredWarningCodes) {
    if (!fixture.expectedWarningCodes.includes(warningCode)) {
      failures.push(`${performanceFixture.fixtureId}: fixture is missing required warning code ${warningCode}.`);
    }
  }

  if (performanceFixture.ciMode === 'required-pr-metadata') {
    if (fixture.status !== 'active_metadata_only') {
      failures.push(`${performanceFixture.fixtureId}: required PR performance fixtures must remain metadata-only.`);
    }

    if (fixture.class === 'local_only') {
      failures.push(`${performanceFixture.fixtureId}: required PR performance fixtures cannot be local-only.`);
    }

    if (performanceFixture.tier !== 'tier1-tiny-smoke' && performanceFixture.tier !== 'tier0-metadata-contract') {
      failures.push(`${performanceFixture.fixtureId}: required PR performance fixtures must stay in tier 0 or tier 1.`);
    }

    if (performanceFixture.memoryBudgetBytes > 256_000_000) {
      failures.push(`${performanceFixture.fixtureId}: required PR metadata memory budget must stay under 256 MB.`);
    }

    if (performanceFixture.runtimeBudgetMs > 10_000) {
      failures.push(`${performanceFixture.fixtureId}: required PR runtime budget must stay under 10 seconds.`);
    }
  }
}

if (failures.length > 0) {
  console.error('Panorama performance fixture validation failed:');
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log(`Validated ${performanceManifest.performanceFixtures.length} panorama performance fixture budgets.`);
