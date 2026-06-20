#!/usr/bin/env bun

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';

import { luminanceRangeMaskParametersSchema } from '../../../src/schemas/maskParameterSchemas.ts';
import {
  evaluateLuminanceRangeWeight,
  normalizeLuminanceRangeParameters,
} from '../../../src/utils/luminanceRangeMaskParameters.ts';

const looseRangeSchema = z
  .object({
    maxLuma: z.number(),
    minLuma: z.number(),
    softness: z.number(),
  })
  .strict();

const sampleSchema = z
  .object({
    luma: z.number(),
    weight: z.number().min(0).max(1),
  })
  .strict();

const fixtureSchema = z
  .object({
    expected: luminanceRangeMaskParametersSchema,
    id: z.string().trim().min(1),
    input: looseRangeSchema,
    samples: z.array(sampleSchema).min(1),
  })
  .strict();

const invalidFixtureSchema = z
  .object({
    id: z.string().trim().min(1),
    payload: z.unknown(),
  })
  .strict();

const fixtures = z
  .array(fixtureSchema)
  .min(1)
  .parse(JSON.parse(readFileSync(resolve('fixtures/masks/luminance-range-mask-parameters.json'), 'utf8')));
const invalidFixtures = z
  .array(invalidFixtureSchema)
  .min(1)
  .parse(JSON.parse(readFileSync(resolve('fixtures/masks/invalid-luminance-range-mask-parameters.json'), 'utf8')));

for (const fixture of fixtures) {
  const actual = normalizeLuminanceRangeParameters(fixture.input);
  if (JSON.stringify(actual) !== JSON.stringify(fixture.expected)) {
    console.error(`${fixture.id}: luminance range normalization mismatch`);
    console.error('Expected:', JSON.stringify(fixture.expected, null, 2));
    console.error('Actual:', JSON.stringify(actual, null, 2));
    process.exit(1);
  }

  for (const sample of fixture.samples) {
    const actualWeight = evaluateLuminanceRangeWeight(sample.luma, actual);
    if (Math.abs(actualWeight - sample.weight) > 0.000001) {
      console.error(`${fixture.id}: expected luma ${sample.luma} weight ${sample.weight}, got ${actualWeight}`);
      process.exit(1);
    }
  }
}

for (const fixture of invalidFixtures) {
  const result = luminanceRangeMaskParametersSchema.safeParse(fixture.payload);
  if (result.success) {
    console.error(`${fixture.id}: expected luminance range schema rejection`);
    process.exit(1);
  }
}

console.log(`Validated ${fixtures.length} luminance range fixtures and ${invalidFixtures.length} invalid cases.`);
