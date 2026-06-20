#!/usr/bin/env bun

import { readFile } from 'node:fs/promises';

import { z } from 'zod';

import {
  noiseSeparationFixtureSchema,
  parseNoiseSeparationFixtures,
} from '../../../src/schemas/noiseSeparationSchemas.ts';

const readJson = async (path: string): Promise<unknown> => JSON.parse(await readFile(path, 'utf8'));

const fixtures = parseNoiseSeparationFixtures(await readJson('fixtures/detail/noise-separation-fixtures.json'));
const invalidCases = z
  .array(z.object({ case: z.string().min(1), fixture: z.unknown() }).strict())
  .parse(await readJson('fixtures/detail/invalid-noise-separation-fixtures.json'));
const failures: string[] = [];
const fixtureIds = new Set<string>();

for (const fixture of fixtures) {
  if (fixtureIds.has(fixture.fixtureId)) {
    failures.push(`Duplicate noise separation fixture id: ${fixture.fixtureId}`);
  }
  fixtureIds.add(fixture.fixtureId);
}

const requiredKinds = new Set(['flat_shadow', 'edge_with_chroma_noise', 'fine_texture_high_iso']);
const coveredKinds = new Set(fixtures.map((fixture) => fixture.kind));
for (const kind of requiredKinds) {
  if (!coveredKinds.has(kind)) {
    failures.push(`Missing required noise separation fixture kind: ${kind}.`);
  }
}

for (const invalidCase of invalidCases) {
  const result = noiseSeparationFixtureSchema.safeParse(invalidCase.fixture);
  if (result.success) {
    failures.push(`${invalidCase.case} unexpectedly passed.`);
  }
}

if (failures.length > 0) {
  console.error('Noise separation fixture validation failed.');
  console.error(failures.join('\n'));
  process.exit(1);
}

console.log(`Validated ${fixtures.length} noise separation fixtures and ${invalidCases.length} invalid cases.`);
