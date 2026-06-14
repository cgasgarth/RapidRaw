#!/usr/bin/env bun

import { readFile } from 'node:fs/promises';

import { z } from 'zod';

import { adaptXyzBradford, chromaticAdaptationInputSchema, xyzColorSchema } from '../src/utils/chromaticAdaptation.ts';

const fixtureSchema = z
  .array(
    z
      .object({
        case: z.string().min(1),
        expectedXyz: xyzColorSchema,
        input: chromaticAdaptationInputSchema,
        tolerance: z.number().positive(),
      })
      .strict(),
  )
  .min(1);

const readJson = async (path) => JSON.parse(await readFile(path, 'utf8'));

const fixtures = fixtureSchema.parse(await readJson('fixtures/color/chromatic-adaptation-fixtures.json'));
const failures = [];

for (const fixture of fixtures) {
  const actual = adaptXyzBradford(fixture.input);
  for (const [index, expected] of fixture.expectedXyz.entries()) {
    const delta = Math.abs((actual[index] ?? Number.NaN) - expected);
    if (delta > fixture.tolerance) {
      failures.push(`${fixture.case} channel ${index}: expected ${expected}, got ${actual[index]}.`);
    }
  }
}

if (failures.length > 0) {
  console.error('Chromatic adaptation fixture validation failed.');
  console.error(failures.join('\n'));
  process.exit(1);
}

console.log(`Validated ${fixtures.length} chromatic adaptation fixtures.`);
