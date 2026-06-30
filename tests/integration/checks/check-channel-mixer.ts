#!/usr/bin/env bun

import { readFile } from 'node:fs/promises';

import { z } from 'zod';

import { parseChannelMixerSettings } from '../../../src/schemas/channelMixerSchemas.ts';
import {
  ADJUSTMENT_GROUPS,
  ADJUSTMENT_SECTIONS,
  ColorAdjustment,
  INITIAL_ADJUSTMENTS,
} from '../../../src/utils/adjustments.ts';
import { applyChannelMixerToRgbPixel } from '../../../src/utils/color/runtime/channelMixerRuntime.ts';

const readJson = async (path) => JSON.parse(await readFile(path, 'utf8'));
const identityRows = {
  blue: { red: 0, green: 0, blue: 100, constant: 0 },
  green: { red: 0, green: 100, blue: 0, constant: 0 },
  red: { red: 100, green: 0, blue: 0, constant: 0 },
};
const outputKeys = ['red', 'green', 'blue'];
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
    expectedChangedOutputs: z.array(z.enum(['red', 'green', 'blue'])),
    expectedRgb: rgbPixelSchema,
    input: z.unknown(),
    inputRgb: rgbPixelSchema,
    tolerance: z.number().positive().max(0.000001),
  })
  .strict();
const fixtures = z
  .array(fixtureSchema)
  .min(1)
  .parse(await readJson('fixtures/color/adjustments/channel-mixer.json'));
const invalidCases = await readJson('fixtures/color/adjustments/invalid/invalid-channel-mixer.json');
const failures = [];

for (const fixture of fixtures) {
  const settings = parseChannelMixerSettings(fixture.input);
  const changedOutputs = outputKeys.filter(
    (output) => JSON.stringify(settings[output]) !== JSON.stringify(identityRows[output]),
  );
  for (const expectedOutput of fixture.expectedChangedOutputs) {
    if (!changedOutputs.includes(expectedOutput)) {
      failures.push(`${fixture.case}: expected changed ${expectedOutput} output.`);
    }
  }

  const actualRgb = applyChannelMixerToRgbPixel(fixture.inputRgb, settings);
  for (const output of outputKeys) {
    const delta = Math.abs(actualRgb[output] - fixture.expectedRgb[output]);
    if (delta > fixture.tolerance) {
      failures.push(`${fixture.case}: ${output} expected ${fixture.expectedRgb[output]}, got ${actualRgb[output]}.`);
    }
  }
}

for (const invalidCase of invalidCases) {
  try {
    parseChannelMixerSettings(invalidCase.input);
    failures.push(`${invalidCase.case}: expected invalid settings to fail.`);
  } catch (_error) {
    // Expected invalid fixture.
  }
}

if (INITIAL_ADJUSTMENTS.channelMixer.enabled !== false) {
  failures.push('Initial channelMixer must be disabled.');
}

if (!ADJUSTMENT_GROUPS['color']?.some((group) => group.keys.includes(ColorAdjustment.ChannelMixer))) {
  failures.push('Copy/paste color groups must include channelMixer.');
}

if (!ADJUSTMENT_SECTIONS.color.includes(ColorAdjustment.ChannelMixer)) {
  failures.push('Color adjustment section must include channelMixer.');
}

if (failures.length > 0) {
  console.error('Channel mixer validation failed:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`Validated ${fixtures.length} channel mixer cases and ${invalidCases.length} invalid cases.`);
