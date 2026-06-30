#!/usr/bin/env bun

import { readFile } from 'node:fs/promises';

import { z } from 'zod';

import { createSelectiveColorMaskSelection } from '../../../src/utils/selectiveColorMask.ts';

const FIXTURE_PATH = 'fixtures/color/selective-color/selective-color-mask-fixtures.json';

const rangeKeySchema = z.enum(['reds', 'oranges', 'yellows', 'greens', 'aquas', 'blues', 'purples', 'magentas']);

const optionsSchema = z
  .object({
    feather: z.number().optional(),
    maxLuma: z.number().optional(),
    maxSaturation: z.number().optional(),
    minLuma: z.number().optional(),
    minSaturation: z.number().optional(),
  })
  .strict();

const selectionSchema = z
  .object({
    centerHueDegrees: z.number().min(0).lt(360),
    feather: z.number().min(0).max(1),
    hueToleranceDegrees: z.number().positive().max(180),
    maxLuma: z.number().min(0).max(1),
    maxSaturation: z.number().min(0).max(1),
    minLuma: z.number().min(0).max(1),
    minSaturation: z.number().min(0).max(1),
    rangeKind: z.literal('color'),
    sourceRangeKey: rangeKeySchema,
  })
  .strict()
  .superRefine((selection, context) => {
    if (selection.minSaturation >= selection.maxSaturation) {
      context.addIssue({ code: 'custom', message: 'minSaturation must be below maxSaturation.' });
    }
    if (selection.minLuma >= selection.maxLuma) {
      context.addIssue({ code: 'custom', message: 'minLuma must be below maxLuma.' });
    }
  });

const caseSchema = z
  .object({
    expected: selectionSchema,
    id: z.string().regex(/^color\.mask\.[a-z0-9.-]+\.v[0-9]+$/u),
    options: optionsSchema.optional(),
    rangeKey: rangeKeySchema,
  })
  .strict();

const manifestSchema = z
  .object({
    $schema: z.string().url(),
    cases: z.array(caseSchema).min(1),
    issue: z.literal(99),
    schemaVersion: z.literal(1),
    snapshotDate: z.string().date(),
  })
  .strict();

const manifest = manifestSchema.parse(JSON.parse(await readFile(FIXTURE_PATH, 'utf8')));
const failures = [];

for (const testCase of manifest.cases) {
  const actual = createSelectiveColorMaskSelection(testCase.rangeKey, testCase.options);
  const expected = testCase.expected;
  for (const key of Object.keys(expected)) {
    if (actual[key] !== expected[key]) {
      failures.push(`${testCase.id}.${key}: expected ${expected[key]}, got ${actual[key]}.`);
    }
  }
}

if (failures.length > 0) {
  console.error('Selective color mask validation failed:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`Validated ${manifest.cases.length} selective color mask fixture cases.`);
