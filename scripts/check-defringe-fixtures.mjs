#!/usr/bin/env bun

import { readFile } from 'node:fs/promises';

import { defringeFixtureSchema, parseDefringeFixtures } from '../src/schemas/defringeSchemas.ts';

const readJson = async (path) => JSON.parse(await readFile(path, 'utf8'));

const fixtures = parseDefringeFixtures(await readJson('fixtures/detail/defringe-fixtures.json'));
const invalidCases = await readJson('fixtures/detail/invalid-defringe-fixtures.json');
const failures = [];
const fixtureIds = new Set();

for (const fixture of fixtures) {
  if (fixtureIds.has(fixture.fixtureId)) {
    failures.push(`Duplicate defringe fixture id: ${fixture.fixtureId}`);
  }
  fixtureIds.add(fixture.fixtureId);
}

const coveredTargets = new Set(fixtures.flatMap((fixture) => fixture.settings.ranges.map((range) => range.target)));
for (const target of ['purple', 'green']) {
  if (!coveredTargets.has(target)) {
    failures.push(`Missing defringe target coverage: ${target}.`);
  }
}

if (!fixtures.some((fixture) => fixture.kind === 'false_positive_color_patch')) {
  failures.push('Missing false-positive color patch guard fixture.');
}

for (const invalidCase of invalidCases) {
  const result = defringeFixtureSchema.safeParse(invalidCase.fixture);
  if (result.success) {
    failures.push(`${invalidCase.case} unexpectedly passed.`);
  }
}

if (failures.length > 0) {
  console.error('Defringe fixture validation failed.');
  console.error(failures.join('\n'));
  process.exit(1);
}

console.log(`Validated ${fixtures.length} defringe fixtures and ${invalidCases.length} invalid cases.`);
