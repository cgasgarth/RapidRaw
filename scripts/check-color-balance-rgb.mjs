#!/usr/bin/env bun

import { readFile } from 'node:fs/promises';

import { z } from 'zod';

import { parseColorBalanceRgbSettings } from '../src/schemas/colorBalanceRgbSchemas.ts';
import { applyColorBalanceRgbToPixel } from '../src/utils/colorBalanceRgbRuntime.ts';
import {
  ADJUSTMENT_GROUPS,
  ADJUSTMENT_SECTIONS,
  ColorAdjustment,
  INITIAL_ADJUSTMENTS,
} from '../src/utils/adjustments.ts';

const readJson = async (path) => JSON.parse(await readFile(path, 'utf8'));
const ranges = ['shadows', 'midtones', 'highlights'];
const rgbPixelSchema = z
  .object({
    blue: z.number().min(0).max(1),
    green: z.number().min(0).max(1),
    red: z.number().min(0).max(1),
  })
  .strict();
const runtimeExpectationSchema = z
  .object({
    expectedRgb: rgbPixelSchema,
    inputRgb: rgbPixelSchema,
    tolerance: z.number().min(0).max(0.01),
  })
  .strict();
const fixtureSchema = z
  .object({
    case: z.string().min(1),
    expectedNonZeroRanges: z.array(z.string().min(1)),
    input: z.unknown(),
    runtimeExpectation: runtimeExpectationSchema.optional(),
  })
  .strict();
const fixtures = z.array(fixtureSchema).parse(await readJson('fixtures/color/color-balance-rgb.json'));
const invalidCases = await readJson('fixtures/color/invalid-color-balance-rgb.json');
const failures = [];

for (const fixture of fixtures) {
  const settings = parseColorBalanceRgbSettings(fixture.input);
  const nonZeroRanges = ranges.filter((range) => Object.values(settings[range]).some((value) => value !== 0));
  for (const expectedRange of fixture.expectedNonZeroRanges) {
    if (!nonZeroRanges.includes(expectedRange)) {
      failures.push(`${fixture.case}: expected non-zero ${expectedRange} controls.`);
    }
  }

  if (fixture.runtimeExpectation) {
    const result = applyColorBalanceRgbToPixel(fixture.runtimeExpectation.inputRgb, settings);
    for (const channel of ['red', 'green', 'blue']) {
      const actual = result.outputRgb[channel];
      const expected = fixture.runtimeExpectation.expectedRgb[channel];
      if (Math.abs(actual - expected) > fixture.runtimeExpectation.tolerance) {
        failures.push(`${fixture.case}: expected ${channel}=${expected}, got ${actual}.`);
      }
    }
  }
}

for (const invalidCase of invalidCases) {
  try {
    parseColorBalanceRgbSettings(invalidCase.input);
    failures.push(`${invalidCase.case}: expected invalid settings to fail.`);
  } catch (_error) {
    // Expected invalid fixture.
  }
}

if (INITIAL_ADJUSTMENTS.colorBalanceRgb.enabled !== false) {
  failures.push('Initial colorBalanceRgb must be disabled.');
}

if (!ADJUSTMENT_GROUPS['color']?.some((group) => group.keys.includes(ColorAdjustment.ColorBalanceRgb))) {
  failures.push('Copy/paste color groups must include colorBalanceRgb.');
}

if (!ADJUSTMENT_SECTIONS.color.includes(ColorAdjustment.ColorBalanceRgb)) {
  failures.push('Color adjustment section must include colorBalanceRgb.');
}

if (failures.length > 0) {
  console.error('RGB color balance validation failed:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`Validated ${fixtures.length} RGB color balance cases and ${invalidCases.length} invalid cases.`);
