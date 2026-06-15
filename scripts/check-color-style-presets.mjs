#!/usr/bin/env bun

import { readFile } from 'node:fs/promises';
import {
  applyColorStylePresetPatch,
  listColorStylePresetAdjustmentKeys,
  parseColorStylePresetCatalog,
} from '../src/schemas/colorStylePresetSchemas.ts';
import { COLOR_STYLE_PRESET_CATALOG } from '../src/utils/colorStylePresetCatalog.ts';

const readJson = async (path) => JSON.parse(await readFile(path, 'utf8'));

const catalog = parseColorStylePresetCatalog(await readJson('fixtures/color/color-style-presets.json'));
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
