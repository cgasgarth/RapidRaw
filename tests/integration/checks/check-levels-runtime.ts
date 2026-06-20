#!/usr/bin/env bun

import { readFile } from 'node:fs/promises';

import { z } from 'zod';

import { parseLevelsSettings } from '../../../src/schemas/levelsSchemas.ts';
import {
  ADJUSTMENT_GROUPS,
  ADJUSTMENT_SECTIONS,
  ColorAdjustment,
  INITIAL_ADJUSTMENTS,
} from '../../../src/utils/adjustments.ts';
import { applyLumaLevelsToRgbPixel } from '../../../src/utils/levelsRuntime.ts';

const readJson = async (path: string): Promise<unknown> => JSON.parse(await readFile(path, 'utf8'));

const rgbPixelSchema = z
  .object({
    blue: z.number().min(0).max(1),
    green: z.number().min(0).max(1),
    red: z.number().min(0).max(1),
  })
  .strict();
const fixtureSchema = z
  .object({
    case: z.string().trim().min(1),
    expectedRgb: rgbPixelSchema,
    input: z.unknown(),
    inputRgb: rgbPixelSchema,
    tolerance: z.number().positive().max(0.000001),
  })
  .strict();
const invalidCaseSchema = z
  .object({
    case: z.string().trim().min(1),
    input: z.unknown(),
  })
  .strict();

const fixtures = z
  .array(fixtureSchema)
  .min(1)
  .parse(await readJson('fixtures/color/levels.json'));
const invalidCases = z
  .array(invalidCaseSchema)
  .min(1)
  .parse(await readJson('fixtures/color/invalid-levels.json'));
const failures: string[] = [];
const outputKeys = ['red', 'green', 'blue'] as const;

for (const fixture of fixtures) {
  const settings = parseLevelsSettings(fixture.input);
  const actualRgb = applyLumaLevelsToRgbPixel(fixture.inputRgb, settings);
  for (const output of outputKeys) {
    const delta = Math.abs(actualRgb[output] - fixture.expectedRgb[output]);
    if (delta > fixture.tolerance) {
      failures.push(`${fixture.case}: ${output} expected ${fixture.expectedRgb[output]}, got ${actualRgb[output]}.`);
    }
  }
}

for (const invalidCase of invalidCases) {
  try {
    parseLevelsSettings(invalidCase.input);
    failures.push(`${invalidCase.case}: expected invalid settings to fail.`);
  } catch (_error) {
    // Expected invalid fixture.
  }
}

if (INITIAL_ADJUSTMENTS.levels.enabled) {
  failures.push('Initial levels must be disabled.');
}

if (!ADJUSTMENT_GROUPS['color']?.some((group) => group.keys.includes(ColorAdjustment.Levels))) {
  failures.push('Copy/paste color groups must include levels.');
}

if (!ADJUSTMENT_SECTIONS.color.includes(ColorAdjustment.Levels)) {
  failures.push('Color adjustment section must include levels.');
}

if (failures.length > 0) {
  console.error('Levels runtime validation failed:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`Validated ${fixtures.length} levels runtime cases and ${invalidCases.length} invalid cases.`);
