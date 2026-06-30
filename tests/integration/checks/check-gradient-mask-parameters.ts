#!/usr/bin/env bun

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';

import {
  linearGradientMaskParametersSchema,
  radialGradientMaskParametersSchema,
} from '../../../src/schemas/maskParameterSchemas.ts';
import {
  normalizeLinearGradientParameters,
  normalizeRadialGradientParameters,
} from '../../../src/utils/gradientMaskParameters.ts';

const linearSchema = linearGradientMaskParametersSchema;
const radialSchema = radialGradientMaskParametersSchema;

const fixtureSchema = z.discriminatedUnion('type', [
  z
    .object({
      expected: linearSchema,
      id: z.string().trim().min(1),
      input: linearSchema.extend({ range: z.number() }),
      type: z.literal('linear'),
    })
    .strict(),
  z
    .object({
      expected: radialSchema,
      id: z.string().trim().min(1),
      input: radialSchema.extend({
        feather: z.number(),
        radiusX: z.number(),
        radiusY: z.number(),
        rotation: z.number(),
      }),
      type: z.literal('radial'),
    })
    .strict(),
]);

const invalidFixtureSchema = z
  .object({
    id: z.string().trim().min(1),
    payload: z.unknown(),
    type: z.enum(['linear', 'radial']),
  })
  .strict();

const fixtures = z
  .array(fixtureSchema)
  .min(1)
  .parse(JSON.parse(readFileSync(resolve('fixtures/masks/gradient/gradient-mask-parameters.json'), 'utf8')));
const invalidFixtures = z
  .array(invalidFixtureSchema)
  .min(1)
  .parse(JSON.parse(readFileSync(resolve('fixtures/masks/invalid/invalid-gradient-mask-parameters.json'), 'utf8')));

for (const fixture of fixtures) {
  const actual =
    fixture.type === 'linear'
      ? normalizeLinearGradientParameters(fixture.input)
      : normalizeRadialGradientParameters(fixture.input);

  if (JSON.stringify(actual) !== JSON.stringify(fixture.expected)) {
    console.error(`${fixture.id}: gradient parameter mismatch`);
    console.error('Expected:', JSON.stringify(fixture.expected, null, 2));
    console.error('Actual:', JSON.stringify(actual, null, 2));
    process.exit(1);
  }
}

for (const fixture of invalidFixtures) {
  const schema = fixture.type === 'linear' ? linearSchema : radialSchema;
  const result = schema.safeParse(fixture.payload);
  if (result.success) {
    console.error(`${fixture.id}: expected gradient schema rejection`);
    process.exit(1);
  }
}

console.log(`Validated ${fixtures.length} gradient mask fixtures and ${invalidFixtures.length} invalid cases.`);
