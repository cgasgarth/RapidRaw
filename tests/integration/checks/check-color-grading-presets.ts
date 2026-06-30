#!/usr/bin/env bun

import { readFile } from 'node:fs/promises';

import { z } from 'zod';

import { parseColorGradingPresetCatalog } from '../../../src/schemas/colorGradingPresetSchemas.ts';
import { applyColorGradingPresetToRgbPixel } from '../../../src/utils/color/runtime/colorGradingRuntime.ts';
import { COLOR_GRADING_PRESET_CATALOG } from '../../../src/utils/colorGradingPresets.ts';

const readJson = async (path) => JSON.parse(await readFile(path, 'utf8'));
const readText = async (path) => readFile(path, 'utf8');
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
    tolerance: z.number().min(0).max(0.01),
  })
  .strict();
const fixtureSchema = z
  .object({
    presets: z.array(z.unknown()).min(1),
    runtimeExpectations: z.array(runtimeExpectationSchema).optional(),
    version: z.literal(1),
  })
  .strict();
const fixture = fixtureSchema.parse(await readJson('fixtures/color/adjustments/color-grading-presets.json'));
const catalog = parseColorGradingPresetCatalog({ presets: fixture.presets, version: fixture.version });
const sourceCatalog = parseColorGradingPresetCatalog(COLOR_GRADING_PRESET_CATALOG);
const invalidCases = await readJson('fixtures/color/adjustments/invalid/invalid-color-grading-presets.json');
const colorPanelSource = await readText('src/components/adjustments/Color.tsx');
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

for (const expectation of fixture.runtimeExpectations ?? []) {
  const preset = catalog.presets.find((candidate) => candidate.id === expectation.presetId);
  if (!preset) {
    failures.push(`${expectation.presetId}: runtime expectation references a missing preset.`);
    continue;
  }

  const result = applyColorGradingPresetToRgbPixel(expectation.inputRgb, preset);
  for (const channel of ['red', 'green', 'blue']) {
    const actual = result.outputRgb[channel];
    const expected = expectation.expectedRgb[channel];
    if (Math.abs(actual - expected) > expectation.tolerance) {
      failures.push(`${expectation.presetId}: expected ${channel}=${expected}, got ${actual}.`);
    }
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

for (const marker of [
  'data-testid="color-grading-preset-card"',
  'data-active={isActivePreset ?',
  'aria-pressed={isActivePreset}',
  'isColorGradingPresetApplied',
  'color-grading-preset-swatch-${key}',
  'adjustments.color.grading.applyPreset',
  'adjustments.color.grading.blendingValue',
  'adjustments.color.grading.balanceValue',
]) {
  if (!colorPanelSource.includes(marker)) {
    failures.push(`Color grading panel is missing UI marker: ${marker}.`);
  }
}

if (failures.length > 0) {
  console.error('Color grading preset validation failed:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`Validated ${catalog.presets.length} color grading presets and ${invalidCases.length} invalid cases.`);
