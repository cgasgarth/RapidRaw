#!/usr/bin/env bun

import { readFile } from 'node:fs/promises';

import { z } from 'zod';

import { parseBlackWhiteMixerSettings } from '../src/schemas/blackWhiteMixerSchemas.ts';
import { applyBlackWhiteMixerToRgbPixel } from '../src/utils/blackWhiteMixerRuntime.ts';
import {
  ADJUSTMENT_GROUPS,
  ADJUSTMENT_SECTIONS,
  ColorAdjustment,
  INITIAL_ADJUSTMENTS,
} from '../src/utils/adjustments.ts';

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
    expectedActiveChannels: z.array(z.string().min(1)),
    input: z.unknown(),
    runtimeExpectation: runtimeExpectationSchema.optional(),
  })
  .strict();

const fixtures = z.array(fixtureSchema).parse(await readJson('fixtures/color/black-white-mixer.json'));
const invalidCases = await readJson('fixtures/color/invalid-black-white-mixer.json');
const failures = [];

for (const fixture of fixtures) {
  const settings = parseBlackWhiteMixerSettings(fixture.input);
  const positiveChannels = Object.entries(settings.weights)
    .filter(([, value]) => value > 0)
    .map(([channel]) => channel);
  for (const expectedChannel of fixture.expectedActiveChannels) {
    if (!positiveChannels.includes(expectedChannel)) {
      failures.push(`${fixture.case}: expected positive ${expectedChannel} contribution.`);
    }
  }

  if (fixture.runtimeExpectation) {
    const result = applyBlackWhiteMixerToRgbPixel(fixture.runtimeExpectation.inputRgb, settings);
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
    parseBlackWhiteMixerSettings(invalidCase.input);
    failures.push(`${invalidCase.case}: expected invalid settings to fail.`);
  } catch (_error) {
    // Expected invalid fixture.
  }
}

if (INITIAL_ADJUSTMENTS.blackWhiteMixer.enabled !== false) {
  failures.push('Initial blackWhiteMixer must be disabled.');
}

if (!ADJUSTMENT_GROUPS['color']?.some((group) => group.keys.includes(ColorAdjustment.BlackWhiteMixer))) {
  failures.push('Copy/paste color groups must include blackWhiteMixer.');
}

if (!ADJUSTMENT_SECTIONS.color.includes(ColorAdjustment.BlackWhiteMixer)) {
  failures.push('Color adjustment section must include blackWhiteMixer.');
}

if (failures.length > 0) {
  console.error('Black and white mixer validation failed:');
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log(`Validated ${fixtures.length} black and white mixer cases and ${invalidCases.length} invalid cases.`);
