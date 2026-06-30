#!/usr/bin/env bun

import { readFile } from 'node:fs/promises';

import { z } from 'zod';

import {
  applyWhiteBalanceToRgbPixel,
  calculateWhiteBalancePickerAdjustment,
  whiteBalancePickerInputSchema,
} from '../../../src/utils/whiteBalancePicker.ts';

const fixtureSchema = z
  .array(
    z
      .object({
        case: z.string().min(1),
        expectedRgb: z
          .object({
            blue: z.number().min(0).max(1),
            green: z.number().min(0).max(1),
            red: z.number().min(0).max(1),
          })
          .strict()
          .optional(),
        input: whiteBalancePickerInputSchema,
        inputRgb: z
          .object({
            blue: z.number().min(0).max(1),
            green: z.number().min(0).max(1),
            red: z.number().min(0).max(1),
          })
          .strict()
          .optional(),
        expected: z
          .object({
            deltaTemperature: z.number(),
            deltaTint: z.number(),
            temperature: z.number().min(-100).max(100),
            tint: z.number().min(-100).max(100),
          })
          .strict(),
        tolerance: z.number().positive(),
      })
      .strict(),
  )
  .min(1);

const readJson = async (path) => JSON.parse(await readFile(path, 'utf8'));

const fixtures = fixtureSchema.parse(await readJson('fixtures/color/adjustments/white-balance-picker-fixtures.json'));
const failures = [];

const assertClose = (name, actual, expected, tolerance) => {
  if (Math.abs(actual - expected) > tolerance) {
    failures.push(`${name}: expected ${expected}, got ${actual}.`);
  }
};

for (const fixture of fixtures) {
  const result = calculateWhiteBalancePickerAdjustment(fixture.input);
  assertClose(
    `${fixture.case} deltaTemperature`,
    result.deltaTemperature,
    fixture.expected.deltaTemperature,
    fixture.tolerance,
  );
  assertClose(`${fixture.case} deltaTint`, result.deltaTint, fixture.expected.deltaTint, fixture.tolerance);
  assertClose(`${fixture.case} temperature`, result.temperature, fixture.expected.temperature, fixture.tolerance);
  assertClose(`${fixture.case} tint`, result.tint, fixture.expected.tint, fixture.tolerance);

  if (fixture.inputRgb && fixture.expectedRgb) {
    const actualRgb = applyWhiteBalanceToRgbPixel(fixture.inputRgb, result.temperature, result.tint).outputRgb;
    assertClose(`${fixture.case} red`, actualRgb.red, fixture.expectedRgb.red, fixture.tolerance);
    assertClose(`${fixture.case} green`, actualRgb.green, fixture.expectedRgb.green, fixture.tolerance);
    assertClose(`${fixture.case} blue`, actualRgb.blue, fixture.expectedRgb.blue, fixture.tolerance);
  }
}

if (failures.length > 0) {
  console.error('White balance picker fixture validation failed.');
  console.error(failures.join('\n'));
  process.exit(1);
}

console.log(`Validated ${fixtures.length} white balance picker fixtures.`);
