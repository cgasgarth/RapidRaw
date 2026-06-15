#!/usr/bin/env bun

import { readFile } from 'node:fs/promises';

import { parseChannelMixerSettings } from '../src/schemas/channelMixerSchemas.ts';
import {
  ADJUSTMENT_GROUPS,
  ADJUSTMENT_SECTIONS,
  ColorAdjustment,
  INITIAL_ADJUSTMENTS,
} from '../src/utils/adjustments.ts';

const readJson = async (path) => JSON.parse(await readFile(path, 'utf8'));
const identityRows = {
  blue: { red: 0, green: 0, blue: 100, constant: 0 },
  green: { red: 0, green: 100, blue: 0, constant: 0 },
  red: { red: 100, green: 0, blue: 0, constant: 0 },
};
const outputKeys = ['red', 'green', 'blue'];
const fixtures = await readJson('fixtures/color/channel-mixer.json');
const invalidCases = await readJson('fixtures/color/invalid-channel-mixer.json');
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
