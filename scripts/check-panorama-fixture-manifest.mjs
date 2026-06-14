#!/usr/bin/env bun

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { z } from 'zod';

const FixtureStatusSchema = z.enum(['active_metadata_only', 'active_generated_asset', 'planned']);
const FixtureClassSchema = z.enum(['synthetic', 'public_sample', 'project_owned', 'local_only']);
const WarningCodeSchema = z.enum([
  'excluded_sources',
  'high_memory_estimate',
  'legacy_full_frame_render',
  'memory_budget_exceeded',
  'tiled_render_required',
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
    class: FixtureClassSchema,
    expectedMatchGraph: ExpectedMatchGraphSchema,
    expectedOutput: ExpectedOutputSchema,
    expectedWarningCodes: z.array(WarningCodeSchema),
    fixtureId: z.string().regex(/^panorama\.[a-z0-9.-]+\.v[0-9]+$/u),
    generator: GeneratorSchema,
    memoryBudgetBytes: z.number().int().positive(),
    notes: z.string().min(1),
    sourceFrames: z.array(SourceFrameSchema).min(2),
    status: FixtureStatusSchema,
    validationPurpose: z.string().min(1),
  })
  .strict()
  .superRefine((fixture, context) => {
    const sourceIndices = fixture.sourceFrames.map((source) => source.sourceIndex);
    const uniqueSourceIndices = new Set(sourceIndices);
    if (uniqueSourceIndices.size !== sourceIndices.length) {
      context.addIssue({
        code: 'custom',
        message: 'Panorama fixture sourceFrame sourceIndex values must be unique.',
        path: ['sourceFrames'],
      });
    }

    const connected = new Set(fixture.expectedMatchGraph.expectedConnectedSourceIndices);
    const excluded = new Set(fixture.expectedMatchGraph.expectedExcludedSourceIndices);
    for (const sourceIndex of connected) {
      if (!uniqueSourceIndices.has(sourceIndex)) {
        context.addIssue({
          code: 'custom',
          message: 'Connected source index must reference a source frame.',
          path: ['expectedMatchGraph', 'expectedConnectedSourceIndices'],
        });
      }

      if (excluded.has(sourceIndex)) {
        context.addIssue({
          code: 'custom',
          message: 'A source cannot be both connected and excluded.',
          path: ['expectedMatchGraph'],
        });
      }
    }

    for (const sourceIndex of excluded) {
      if (!uniqueSourceIndices.has(sourceIndex)) {
        context.addIssue({
          code: 'custom',
          message: 'Excluded source index must reference a source frame.',
          path: ['expectedMatchGraph', 'expectedExcludedSourceIndices'],
        });
      }
    }

    if (fixture.expectedOutput.stitchedSourceCount !== connected.size) {
      context.addIssue({
        code: 'custom',
        message: 'stitchedSourceCount must match expectedConnectedSourceIndices length.',
        path: ['expectedOutput', 'stitchedSourceCount'],
      });
    }

    if (fixture.expectedOutput.excludedSourceCount !== excluded.size) {
      context.addIssue({
        code: 'custom',
        message: 'excludedSourceCount must match expectedExcludedSourceIndices length.',
        path: ['expectedOutput', 'excludedSourceCount'],
      });
    }

    if (
      fixture.expectedOutput.stitchedSourceCount + fixture.expectedOutput.excludedSourceCount !==
      sourceIndices.length
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Expected stitched plus excluded sources must cover every source frame.',
        path: ['expectedOutput'],
      });
    }

    const hasExcludedSources = fixture.expectedOutput.excludedSourceCount > 0;
    if (hasExcludedSources && !fixture.expectedWarningCodes.includes('excluded_sources')) {
      context.addIssue({
        code: 'custom',
        message: 'Fixtures with excluded sources must include the excluded_sources warning code.',
        path: ['expectedWarningCodes'],
      });
    }

    const hasMemoryExceeded = fixture.expectedWarningCodes.includes('memory_budget_exceeded');
    const hasTilingRequired = fixture.expectedWarningCodes.includes('tiled_render_required');
    if (hasMemoryExceeded && !hasTilingRequired) {
      context.addIssue({
        code: 'custom',
        message: 'Memory-budget-exceeded fixtures must also require tiled rendering.',
        path: ['expectedWarningCodes'],
      });
    }
  });

const PanoramaFixtureManifestSchema = z
  .object({
    $schema: z.string().url(),
    fixtures: z.array(PanoramaFixtureSchema).min(1),
    issue: z.literal(182),
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
        message: 'Panorama fixture IDs must be unique.',
        path: ['fixtures'],
      });
    }

    const expectedFixtureIds = [
      'panorama.synthetic.disconnected-source.v1',
      'panorama.synthetic.horizontal-translation.v1',
      'panorama.synthetic.large-plan-only.v1',
    ];
    const sortedFixtureIds = [...fixtureIds].sort();
    if (JSON.stringify(sortedFixtureIds) !== JSON.stringify(expectedFixtureIds)) {
      context.addIssue({
        code: 'custom',
        message: `Panorama fixture manifest must contain the expected fixture IDs: ${expectedFixtureIds.join(', ')}.`,
        path: ['fixtures'],
      });
    }
  });

const manifestPath = resolve('fixtures/panorama/panorama-fixture-manifest.json');
const manifestJson = JSON.parse(await readFile(manifestPath, 'utf8'));
const manifest = PanoramaFixtureManifestSchema.parse(manifestJson);

const activeFixtures = manifest.fixtures.filter((fixture) => fixture.status !== 'planned');
const metadataOnlyFixtures = activeFixtures.filter((fixture) => fixture.status === 'active_metadata_only');
if (metadataOnlyFixtures.length !== activeFixtures.length) {
  throw new Error('Panorama PR CI fixtures must remain metadata-only until generated assets are added deliberately.');
}

console.log(`Validated ${manifest.fixtures.length} panorama fixture definitions.`);
