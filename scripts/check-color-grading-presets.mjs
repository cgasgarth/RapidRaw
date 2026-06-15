#!/usr/bin/env bun

import { readFile } from 'node:fs/promises';

import { parseColorGradingPresetCatalog } from '../src/schemas/colorGradingPresetSchemas.ts';
import { COLOR_GRADING_PRESET_CATALOG } from '../src/utils/colorGradingPresets.ts';

const readJson = async (path) => JSON.parse(await readFile(path, 'utf8'));
const catalog = parseColorGradingPresetCatalog(await readJson('fixtures/color/color-grading-presets.json'));
const sourceCatalog = parseColorGradingPresetCatalog(COLOR_GRADING_PRESET_CATALOG);
const invalidCases = await readJson('fixtures/color/invalid-color-grading-presets.json');
const failures = [];

if (
  sourceCatalog.presets.map((preset) => preset.id).join(',') !== catalog.presets.map((preset) => preset.id).join(',')
) {
  failures.push('source color grading presets must match fixture ids.');
}

for (const preset of catalog.presets) {
  if (preset.blending < 35 || preset.blending > 70) {
    failures.push(`${preset.id}: blending should stay in a preview-safe creative range.`);
  }
}

for (const invalidCase of invalidCases) {
  try {
    parseColorGradingPresetCatalog(invalidCase.catalog);
    failures.push(`${invalidCase.case}: expected invalid catalog to fail.`);
  } catch (_error) {
    // Expected invalid fixture.
  }
}

if (failures.length > 0) {
  console.error('Color grading preset validation failed:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`Validated ${catalog.presets.length} color grading presets and ${invalidCases.length} invalid cases.`);
