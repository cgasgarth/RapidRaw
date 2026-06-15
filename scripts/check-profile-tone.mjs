#!/usr/bin/env bun

import { readFile } from 'node:fs/promises';

import { parseProfileToneSettings } from '../src/schemas/profileToneSchemas.ts';
import {
  ADJUSTMENT_GROUPS,
  ADJUSTMENT_SECTIONS,
  ColorAdjustment,
  INITIAL_ADJUSTMENTS,
} from '../src/utils/adjustments.ts';
import { TONE_CURVE_PARAMETRIC_PRESETS } from '../src/utils/profileTonePresets.ts';

const readJson = async (path) => JSON.parse(await readFile(path, 'utf8'));
const fixtures = await readJson('fixtures/color/profile-tone.json');
const invalidCases = await readJson('fixtures/color/invalid-profile-tone.json');
const failures = [];

for (const fixture of fixtures) {
  const settings = parseProfileToneSettings(fixture.input);
  if (settings.cameraProfile !== fixture.expectedProfile) {
    failures.push(`${fixture.case}: expected profile ${fixture.expectedProfile}.`);
  }
  if (settings.toneCurve !== fixture.expectedToneCurve) {
    failures.push(`${fixture.case}: expected tone curve ${fixture.expectedToneCurve}.`);
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
