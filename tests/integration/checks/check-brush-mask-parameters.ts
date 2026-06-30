#!/usr/bin/env bun

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';

import { brushMaskParametersSchema } from '../../../src/schemas/maskParameterSchemas.ts';
import { appendBrushStroke, setFlowBrushFlow } from '../../../src/utils/mask/brushMaskParameters.ts';

const strokeSchema = z
  .object({
    feather: z.number(),
    points: z
      .array(
        z
          .object({
            pressure: z.number().optional(),
            x: z.number(),
            y: z.number(),
          })
          .strict(),
      )
      .min(1),
    size: z.number(),
    tool: z.enum(['brush', 'eraser']),
  })
  .strict();

const operationSchema = z.discriminatedUnion('type', [
  z
    .object({
      stroke: strokeSchema,
      type: z.literal('appendStroke'),
    })
    .strict(),
  z
    .object({
      flow: z.number(),
      type: z.literal('setFlow'),
    })
    .strict(),
]);

const fixtureSchema = z
  .object({
    expected: z.unknown(),
    id: z.string().trim().min(1),
    initial: z.unknown(),
    operation: operationSchema,
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
  .parse(JSON.parse(readFileSync(resolve('fixtures/masks/brush/brush-mask-parameters.json'), 'utf8')));
const invalidFixtures = z
  .array(invalidFixtureSchema)
  .min(1)
  .parse(JSON.parse(readFileSync(resolve('fixtures/masks/invalid/invalid-brush-mask-parameters.json'), 'utf8')));

function stableStringify(value) {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, childValue]) => `${JSON.stringify(key)}:${stableStringify(childValue)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function applyOperation(initial, operation) {
  switch (operation.type) {
    case 'appendStroke':
      return appendBrushStroke(initial, operation.stroke);
    case 'setFlow':
      return setFlowBrushFlow(initial, operation.flow);
  }
}

for (const fixture of fixtures) {
  const actual = applyOperation(fixture.initial, fixture.operation);
  if (stableStringify(actual) !== stableStringify(fixture.expected)) {
    console.error(`${fixture.id}: brush mask parameter mismatch`);
    console.error('Expected:', JSON.stringify(fixture.expected, null, 2));
    console.error('Actual:', JSON.stringify(actual, null, 2));
    process.exit(1);
  }
}

for (const fixture of invalidFixtures) {
  const result = brushMaskParametersSchema.safeParse(fixture.payload);
  if (result.success) {
    console.error(`${fixture.id}: expected brush schema rejection`);
    process.exit(1);
  }
}

console.log(`Validated ${fixtures.length} brush mask fixtures and ${invalidFixtures.length} invalid cases.`);
