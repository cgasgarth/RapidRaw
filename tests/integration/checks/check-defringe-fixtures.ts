#!/usr/bin/env bun

import { z } from 'zod';

import {
  addDuplicateFieldFailures,
  expectInvalidCases,
  finishFixtureCheck,
  readJson,
} from '../../../scripts/lib/fixture-checks.ts';
import { defringeFixtureSchema, parseDefringeFixtures } from '../../../src/schemas/defringeSchemas.ts';

const fixtures = parseDefringeFixtures(await readJson('fixtures/detail/defringe-fixtures.json'));
const invalidCases = z
  .array(z.object({ case: z.string().min(1), fixture: z.unknown() }).strict())
  .parse(await readJson('fixtures/detail/invalid-defringe-fixtures.json'));
const failures: string[] = [];

addDuplicateFieldFailures({
  failures,
  getId: (fixture) => fixture.fixtureId,
  items: fixtures,
  label: 'defringe fixture id',
});

const coveredTargets = new Set(fixtures.flatMap((fixture) => fixture.settings.ranges.map((range) => range.target)));
for (const target of ['purple', 'green']) {
  if (!coveredTargets.has(target)) {
    failures.push(`Missing defringe target coverage: ${target}.`);
  }
}

if (!fixtures.some((fixture) => fixture.kind === 'false_positive_color_patch')) {
  failures.push('Missing false-positive color patch guard fixture.');
}

expectInvalidCases({
  failures,
  getPayload: (invalidCase) => invalidCase.fixture,
  invalidCases,
  label: 'defringe fixture',
  schema: defringeFixtureSchema,
});

finishFixtureCheck({
  failures,
  invalidCount: invalidCases.length,
  label: 'defringe fixtures',
  validCount: fixtures.length,
});
