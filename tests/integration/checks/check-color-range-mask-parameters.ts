#!/usr/bin/env bun

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';

import { colorRangeMaskParametersSchema } from '../../../src/schemas/maskParameterSchemas.ts';
import {
  createColorRangeMaskParameters,
  evaluateColorRangeMaskWeight,
} from '../../../src/utils/colorRangeMaskParameters.ts';

const selectiveColorRangeKeySchema = z.enum([
  'reds',
  'oranges',
  'yellows',
  'greens',
  'aquas',
  'blues',
  'purples',
  'magentas',
]);

const sampleSchema = z
  .object({
    hueDegrees: z.number(),
    luma: z.number(),
    saturation: z.number(),
    weight: z.number().min(0).max(1),
  })
  .strict();

const fixtureSchema = z
  .object({
    expected: colorRangeMaskParametersSchema,
    id: z.string().trim().min(1),
    input: z
      .object({
        options: z
          .object({
            feather: z.number().optional(),
            hueToleranceDegrees: z.number().optional(),
            maxLuma: z.number().optional(),
            maxSaturation: z.number().optional(),
            minLuma: z.number().optional(),
            minSaturation: z.number().optional(),
          })
          .strict()
          .optional(),
        rangeKey: selectiveColorRangeKeySchema,
      })
      .strict(),
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
  .parse(JSON.parse(readFileSync(resolve('fixtures/masks/range/color-range-mask-parameters.json'), 'utf8')));
const invalidFixtures = z
  .array(invalidFixtureSchema)
  .min(1)
  .parse(JSON.parse(readFileSync(resolve('fixtures/masks/invalid/invalid-color-range-mask-parameters.json'), 'utf8')));

for (const fixture of fixtures) {
  const actual = createColorRangeMaskParameters(fixture.input.rangeKey, fixture.input.options);
  if (JSON.stringify(actual) !== JSON.stringify(fixture.expected)) {
    console.error(`${fixture.id}: color range parameter mismatch`);
    console.error('Expected:', JSON.stringify(fixture.expected, null, 2));
    console.error('Actual:', JSON.stringify(actual, null, 2));
    process.exit(1);
  }

  for (const sample of fixture.samples) {
    const actualWeight = evaluateColorRangeMaskWeight(sample, actual);
    if (Math.abs(actualWeight - sample.weight) > 0.000001) {
      console.error(`${fixture.id}: expected hue ${sample.hueDegrees} weight ${sample.weight}, got ${actualWeight}`);
      process.exit(1);
    }
  }
}

for (const fixture of invalidFixtures) {
  const result = colorRangeMaskParametersSchema.safeParse(fixture.payload);
  if (result.success) {
    console.error(`${fixture.id}: expected color range schema rejection`);
    process.exit(1);
  }
}

console.log(`Validated ${fixtures.length} color range fixtures and ${invalidFixtures.length} invalid cases.`);
