#!/usr/bin/env bun

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { z } from 'zod';

import { calculateDeltaE00, labColorSchema } from '../../../src/utils/deltaE00.ts';

const DeltaEFixtureSchema = z
  .object({
    expectedDeltaE00: z.number().nonnegative(),
    fixtureId: z.string().regex(/^deltae\.[a-z0-9.-]+\.v[0-9]+$/u),
    labA: labColorSchema,
    labB: labColorSchema,
    notes: z.string().trim().min(1),
    tolerance: z.number().positive().max(0.01),
  })
  .strict();

const DeltaEFixtureManifestSchema = z
  .object({
    $schema: z.string().url(),
    fixtures: z.array(DeltaEFixtureSchema).min(1),
    issue: z.literal(89),
    schemaVersion: z.literal(1),
    snapshotDate: z.string().date(),
  })
  .strict()
  .superRefine((manifest, context) => {
    const fixtureIds = manifest.fixtures.map((fixture) => fixture.fixtureId);
    if (new Set(fixtureIds).size !== fixtureIds.length) {
      context.addIssue({
        code: 'custom',
        message: 'DeltaE fixture IDs must be unique.',
        path: ['fixtures'],
      });
    }

    const requiredIds = [
      'deltae.identity-neutral.v1',
      'deltae.sharma-blue-01.v1',
      'deltae.sharma-blue-02.v1',
      'deltae.sharma-blue-03.v1',
    ];
    if (JSON.stringify([...fixtureIds].sort()) !== JSON.stringify(requiredIds)) {
      context.addIssue({
        code: 'custom',
        message: `DeltaE manifest must contain: ${requiredIds.join(', ')}.`,
        path: ['fixtures'],
      });
    }
  });

const manifestPath = resolve('fixtures/color/reference/deltae-reference-fixtures.json');
const manifest = DeltaEFixtureManifestSchema.parse(JSON.parse(await readFile(manifestPath, 'utf8')));
const failures = [];

for (const fixture of manifest.fixtures) {
  const actual = calculateDeltaE00(fixture.labA, fixture.labB);
  const error = Math.abs(actual - fixture.expectedDeltaE00);
  if (error > fixture.tolerance) {
    failures.push(
      `${fixture.fixtureId}: expected ${fixture.expectedDeltaE00}, got ${actual.toFixed(6)}, error ${error.toFixed(
        6,
      )}.`,
    );
  }
}

if (failures.length > 0) {
  console.error('DeltaE fixture validation failed:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`Validated ${manifest.fixtures.length} DeltaE00 reference fixtures.`);
