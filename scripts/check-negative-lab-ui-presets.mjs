#!/usr/bin/env bun
// @ts-check

import { NEGATIVE_LAB_BUILT_IN_UI_PRESET_CATALOG } from '../src/utils/negativeLabPresetCatalog.ts';
import { parseNegativeLabBuiltInUiPresetCatalog } from '../src/schemas/negativeLabPresetCatalogSchemas.ts';

const unsafeClaims =
  /\b(?:adobe|capture one|dehancer|ektachrome|ektar|exact|fujifilm|fuji|gold|ilford|kodak|lightroom|mastin|negative lab pro|nlp|official|portra|rni|tri-x|t-max|vsco)\b/iu;

const failures = [];
const ids = new Set();
parseNegativeLabBuiltInUiPresetCatalog(NEGATIVE_LAB_BUILT_IN_UI_PRESET_CATALOG);

for (const preset of NEGATIVE_LAB_BUILT_IN_UI_PRESET_CATALOG.presets) {
  ids.add(preset.presetId);

  const text = `${preset.presetId} ${preset.displayName}`;
  if (unsafeClaims.test(text)) {
    failures.push(`${preset.presetId}: generic preset contains unsafe stock or brand claim`);
  }
}

if (!ids.has(NEGATIVE_LAB_BUILT_IN_UI_PRESET_CATALOG.defaultPresetId)) {
  failures.push('default preset id is missing from catalog');
}

if (failures.length > 0) {
  console.error('Negative Lab UI preset validation failed:');
  console.error(failures.join('\n'));
  process.exit(1);
}

console.log(`negative lab UI presets ok (${NEGATIVE_LAB_BUILT_IN_UI_PRESET_CATALOG.presets.length})`);
