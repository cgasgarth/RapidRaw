#!/usr/bin/env bun

import { readFile } from 'node:fs/promises';

import { z } from 'zod';

import { parseProfileToneSettings } from '../../../src/schemas/color/profileToneSchemas.ts';
import {
  ADJUSTMENT_GROUPS,
  ADJUSTMENT_SECTIONS,
  ColorAdjustment,
  INITIAL_ADJUSTMENTS,
} from '../../../src/utils/adjustments.ts';
import { applyProfileToneToRgbPixel } from '../../../src/utils/color/runtime/profileToneRuntime.ts';
import { TONE_CURVE_PARAMETRIC_PRESETS } from '../../../src/utils/profileTonePresets.ts';

const readJson = async (path) => JSON.parse(await readFile(path, 'utf8'));
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
    expectedProfile: z.string().min(1),
    expectedToneCurve: z.string().min(1),
    input: z.unknown(),
    runtimeExpectation: runtimeExpectationSchema.optional(),
  })
  .strict();
const fixtures = z.array(fixtureSchema).parse(await readJson('fixtures/color/adjustments/profile-tone.json'));
const invalidCases = await readJson('fixtures/color/adjustments/invalid/invalid-profile-tone.json');
const failures = [];

for (const fixture of fixtures) {
  const settings = parseProfileToneSettings(fixture.input);
  if (settings.cameraProfile !== fixture.expectedProfile) {
    failures.push(`${fixture.case}: expected profile ${fixture.expectedProfile}.`);
  }
  if (settings.toneCurve !== fixture.expectedToneCurve) {
    failures.push(`${fixture.case}: expected tone curve ${fixture.expectedToneCurve}.`);
  }
  if (fixture.runtimeExpectation) {
    const result = applyProfileToneToRgbPixel(fixture.runtimeExpectation.inputRgb, settings);
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
    parseProfileToneSettings(invalidCase.input);
    failures.push(`${invalidCase.case}: expected invalid settings to fail.`);
  } catch (_error) {
    // Expected invalid fixture.
  }
}

if (INITIAL_ADJUSTMENTS.cameraProfile !== 'camera_standard') {
  failures.push('Initial cameraProfile must be camera_standard.');
}

if (INITIAL_ADJUSTMENTS.toneCurve !== 'auto_filmic') {
  failures.push('Initial toneCurve must be auto_filmic.');
}

if (TONE_CURVE_PARAMETRIC_PRESETS.linear.shadows !== 0 || TONE_CURVE_PARAMETRIC_PRESETS.linear.highlights !== 0) {
  failures.push('Linear tone curve preset must remain neutral.');
}

if (!ADJUSTMENT_GROUPS['color']?.some((group) => group.keys.includes(ColorAdjustment.CameraProfile))) {
  failures.push('Copy/paste color groups must include cameraProfile.');
}

if (!ADJUSTMENT_GROUPS['color']?.some((group) => group.keys.includes(ColorAdjustment.ToneCurve))) {
  failures.push('Copy/paste color groups must include toneCurve.');
}

if (!ADJUSTMENT_SECTIONS.color.includes(ColorAdjustment.CameraProfile)) {
  failures.push('Color adjustment section must include cameraProfile.');
}

if (!ADJUSTMENT_SECTIONS.color.includes(ColorAdjustment.ToneCurve)) {
  failures.push('Color adjustment section must include toneCurve.');
}

if (failures.length > 0) {
  console.error('Profile/tone validation failed:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`Validated ${fixtures.length} profile/tone cases and ${invalidCases.length} invalid cases.`);
