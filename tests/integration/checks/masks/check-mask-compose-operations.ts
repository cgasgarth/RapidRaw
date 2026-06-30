#!/usr/bin/env bun

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';

import { maskComposeModeSchema } from '../../../../src/schemas/masks/maskRenderSchemas.ts';
import { composeMaskWeights } from '../../../../src/utils/mask/maskComposition.ts';

const operationSchema = z
  .object({
    mode: maskComposeModeSchema,
    opacity: z.number(),
    weight: z.number(),
  })
  .strict();

const fixtureSchema = z
  .object({
    expectedWeight: z.number().min(0).max(1),
    id: z.string().trim().min(1),
    operations: z.array(operationSchema).min(1),
  })
  .strict();

const invalidFixtureSchema = z
  .object({
    id: z.string().trim().min(1),
    operations: z.unknown(),
  })
  .strict();

const fixtures = z
  .array(fixtureSchema)
  .min(1)
  .parse(JSON.parse(readFileSync(resolve('fixtures/masks/compose/mask-compose-operations.json'), 'utf8')));
const invalidFixtures = z
  .array(invalidFixtureSchema)
  .min(1)
  .parse(JSON.parse(readFileSync(resolve('fixtures/masks/invalid/invalid-mask-compose-operations.json'), 'utf8')));

for (const fixture of fixtures) {
  const actualWeight = composeMaskWeights(fixture.operations);
  if (Math.abs(actualWeight - fixture.expectedWeight) > 0.000001) {
    console.error(`${fixture.id}: expected composed weight ${fixture.expectedWeight}, got ${actualWeight}`);
    process.exit(1);
  }
}

for (const fixture of invalidFixtures) {
  const result = z.array(operationSchema).min(1).safeParse(fixture.operations);
  if (result.success) {
    console.error(`${fixture.id}: expected mask compose schema rejection`);
    process.exit(1);
  }
}

console.log(`Validated ${fixtures.length} mask compose fixtures and ${invalidFixtures.length} invalid cases.`);
