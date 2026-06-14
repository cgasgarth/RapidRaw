#!/usr/bin/env bun

import { readFile } from 'node:fs/promises';

import { localContrastFixtureSchema, parseLocalContrastFixtures } from '../src/schemas/localContrastSchemas.ts';

const readJson = async (path) => JSON.parse(await readFile(path, 'utf8'));

const fixtures = parseLocalContrastFixtures(await readJson('fixtures/detail/local-contrast-fixtures.json'));
const invalidCases = await readJson('fixtures/detail/invalid-local-contrast-fixtures.json');
const failures = [];
const fixtureIds = new Set();

for (const fixture of fixtures) {
  if (fixtureIds.has(fixture.fixtureId)) {
    failures.push(`Duplicate local contrast fixture id: ${fixture.fixtureId}`);
  }
  fixtureIds.add(fixture.fixtureId);

  if (fixture.maxAllowedHaloPx > fixture.settings.haloBudgetPx) {
    failures.push(`${fixture.fixtureId}: maxAllowedHaloPx exceeds settings haloBudgetPx.`);
  }
}

const requiredKinds = new Set(['slanted_edge', 'high_iso_noise', 'flat_gradient']);
const coveredKinds = new Set(fixtures.map((fixture) => fixture.kind));
for (const kind of requiredKinds) {
  if (!coveredKinds.has(kind)) {
    failures.push(`Missing required local contrast fixture kind: ${kind}.`);
  }
}

for (const invalidCase of invalidCases) {
  const result = localContrastFixtureSchema.safeParse(invalidCase.fixture);
  if (result.success) {
    failures.push(`${invalidCase.case} unexpectedly passed.`);
  }
}

if (failures.length > 0) {
  console.error('Local contrast fixture validation failed.');
  console.error(failures.join('\n'));
  process.exit(1);
}

console.log(`Validated ${fixtures.length} local contrast fixtures and ${invalidCases.length} invalid cases.`);
