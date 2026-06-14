#!/usr/bin/env bun

import { readFile } from 'node:fs/promises';

import {
  dustVisualizationFixtureSchema,
  parseDustVisualizationFixtures,
} from '../src/schemas/dustVisualizationSchemas.ts';

const readJson = async (path) => JSON.parse(await readFile(path, 'utf8'));

const fixtures = parseDustVisualizationFixtures(await readJson('fixtures/detail/dust-visualization-fixtures.json'));
const invalidCases = await readJson('fixtures/detail/invalid-dust-visualization-fixtures.json');
const failures = [];
const fixtureIds = new Set();

for (const fixture of fixtures) {
  if (fixtureIds.has(fixture.fixtureId)) {
    failures.push(`Duplicate dust visualization fixture id: ${fixture.fixtureId}`);
  }
  fixtureIds.add(fixture.fixtureId);
}

if (!fixtures.some((fixture) => fixture.candidates.some((candidate) => candidate.expectedFalsePositive))) {
  failures.push('Missing dust false-positive guard fixture.');
}

if (!fixtures.some((fixture) => fixture.candidates.some((candidate) => candidate.kind === 'scratch'))) {
  failures.push('Missing scratch visualization fixture.');
}

for (const invalidCase of invalidCases) {
  const result = dustVisualizationFixtureSchema.safeParse(invalidCase.fixture);
  if (result.success) {
    failures.push(`${invalidCase.case} unexpectedly passed.`);
  }
}

if (failures.length > 0) {
  console.error('Dust visualization fixture validation failed.');
  console.error(failures.join('\n'));
  process.exit(1);
}

console.log(`Validated ${fixtures.length} dust visualization fixtures and ${invalidCases.length} invalid cases.`);
