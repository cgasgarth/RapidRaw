import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { z } from 'zod';

import { parseLevelsSettings } from '../../src/schemas/levelsSchemas.ts';
import {
  ADJUSTMENT_GROUPS,
  ADJUSTMENT_SECTIONS,
  ColorAdjustment,
  INITIAL_ADJUSTMENTS,
} from '../../src/utils/adjustments.ts';
import { applyLumaLevelsToRgbPixel } from '../../src/utils/levelsRuntime.ts';

const readJson = (path: string): unknown => JSON.parse(readFileSync(path, 'utf8'));

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

const fixtures = z.array(fixtureSchema).min(1).parse(readJson('fixtures/color/levels.json'));
const invalidCases = z.array(invalidCaseSchema).min(1).parse(readJson('fixtures/color/invalid-levels.json'));

describe('levels runtime', () => {
  test.each(fixtures)('matches fixture output for $case', (fixture) => {
    const settings = parseLevelsSettings(fixture.input);
    const actualRgb = applyLumaLevelsToRgbPixel(fixture.inputRgb, settings);

    expect(Math.abs(actualRgb.red - fixture.expectedRgb.red)).toBeLessThanOrEqual(fixture.tolerance);
    expect(Math.abs(actualRgb.green - fixture.expectedRgb.green)).toBeLessThanOrEqual(fixture.tolerance);
    expect(Math.abs(actualRgb.blue - fixture.expectedRgb.blue)).toBeLessThanOrEqual(fixture.tolerance);
  });

  test.each(invalidCases)('rejects invalid fixture $case', (invalidCase) => {
    expect(() => parseLevelsSettings(invalidCase.input)).toThrow();
  });

  test('is wired into the color adjustment surface', () => {
    expect(INITIAL_ADJUSTMENTS.levels.enabled).toBe(false);
    expect(ADJUSTMENT_GROUPS.color?.some((group) => group.keys.includes(ColorAdjustment.Levels))).toBe(true);
    expect(ADJUSTMENT_SECTIONS.color).toContain(ColorAdjustment.Levels);
  });
});
