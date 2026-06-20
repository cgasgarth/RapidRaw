#!/usr/bin/env bun

import { readFile } from 'node:fs/promises';
import { z } from 'zod';

import {
  applyColorStylePresetPatch,
  listColorStylePresetAdjustmentKeys,
  parseColorStylePresetCatalog,
} from '../../../src/schemas/colorStylePresetSchemas.ts';
import { COLOR_STYLE_PRESET_CATALOG } from '../../../src/utils/colorStylePresetCatalog.ts';
import { applyColorStylePresetToRgbPixel } from '../../../src/utils/colorStyleRuntime.ts';

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
    presetId: z.string().min(1),
    tolerance: z.number().positive().max(0.001),
  })
  .strict();
const fixtureSchema = z
  .object({
    defaultPresetId: z.string().nullable(),
    presets: z.array(z.unknown()).min(1),
    runtimeExpectations: z.array(runtimeExpectationSchema).optional(),
    version: z.literal(1),
  })
  .strict();

const fixture = fixtureSchema.parse(await readJson('fixtures/color/color-style-presets.json'));
const catalog = parseColorStylePresetCatalog({
  defaultPresetId: fixture.defaultPresetId,
  presets: fixture.presets,
  version: fixture.version,
});
const invalidCases = await readJson('fixtures/color/invalid-color-style-presets.json');
const failures = [];

const sourceCatalog = parseColorStylePresetCatalog(COLOR_STYLE_PRESET_CATALOG);
const sourceIds = sourceCatalog.presets.map((preset) => preset.id).join(',');
const fixtureIds = catalog.presets.map((preset) => preset.id).join(',');
if (sourceCatalog.defaultPresetId !== catalog.defaultPresetId || sourceIds !== fixtureIds) {
  failures.push('source catalog must match color-style fixture ids.');
}

for (const preset of catalog.presets) {
  const keys = listColorStylePresetAdjustmentKeys(preset);
  if (keys.length === 0) {
    failures.push(`${preset.id}: expected at least one color adjustment key.`);
  }

  const applied = applyColorStylePresetPatch({ exposure: 0, saturation: 0, temperature: 0 }, preset);
  if (applied['exposure'] !== 0) {
    failures.push(`${preset.id}: color style patch changed non-color exposure baseline.`);
  }
}

for (const expectation of fixture.runtimeExpectations ?? []) {
  const preset = catalog.presets.find((candidate) => candidate.id === expectation.presetId);
  if (!preset) {
    failures.push(`${expectation.presetId}: runtime expectation references missing preset.`);
    continue;
  }

  const actual = applyColorStylePresetToRgbPixel(expectation.inputRgb, preset).outputRgb;
  for (const channel of ['red', 'green', 'blue']) {
    const delta = Math.abs(actual[channel] - expectation.expectedRgb[channel]);
    if (delta > expectation.tolerance) {
      failures.push(
        `${expectation.presetId}: expected ${channel}=${expectation.expectedRgb[channel]}, got ${actual[channel]}.`,
      );
    }
  }
}

for (const invalidCase of invalidCases) {
  try {
    parseColorStylePresetCatalog(invalidCase.catalog);
    failures.push(`${invalidCase.case}: expected invalid catalog to fail.`);
  } catch (_error) {
    // Expected invalid fixture.
  }
}

if (failures.length > 0) {
  console.error('Color style preset validation failed:');
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log(`Validated ${catalog.presets.length} color style presets and ${invalidCases.length} invalid cases.`);
