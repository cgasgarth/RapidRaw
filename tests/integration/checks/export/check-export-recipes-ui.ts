#!/usr/bin/env bun

import { readFile } from 'node:fs/promises';

import { z } from 'zod';

import { CLIENT_PROOF_TIFF_EXPORT_RECIPE_ID } from '../../../../src/schemas/export/exportRecipeIds.ts';
import {
  buildExportRecipeUiRows,
  exportRecipeUiRowSchema,
} from '../../../../src/schemas/export/exportRecipeUiSchemas.ts';

const recipesJson: unknown = JSON.parse(await readFile('fixtures/export/export-recipes.json', 'utf8'));
const recipes = z.array(z.unknown()).parse(recipesJson);
const rows = buildExportRecipeUiRows(recipes);
const failures = [];
const localeJson: unknown = JSON.parse(await readFile('src/i18n/locales/en.json', 'utf8'));
const localeRoot = z
  .object({ ui: z.object({ exportPresets: z.unknown() }).loose() })
  .loose()
  .safeParse(localeJson);
const exportPresetLocale = z
  .object({
    builtInRecipeCount_one: z.string(),
    builtInRecipeCount_other: z.string(),
    recipeCount_one: z.string(),
    recipeCount_other: z.string(),
    validRecipeCount_one: z.string(),
    validRecipeCount_other: z.string(),
  })
  .safeParse(localeRoot.success ? localeRoot.data.ui.exportPresets : undefined);
const componentSource = await readFile('src/components/panel/right/export/ExportPresetsList.tsx', 'utf8');

if (rows.length !== recipes.length) {
  failures.push(`Expected ${recipes.length} UI rows, got ${rows.length}.`);
}

if (!rows.some((row) => row.isBuiltIn && row.id === CLIENT_PROOF_TIFF_EXPORT_RECIPE_ID)) {
  failures.push('Client proof TIFF built-in recipe must be visible.');
}

if (rows.filter((row) => row.isValidRecipe).length !== recipes.length) {
  failures.push('All fixture export recipes must parse as valid UI recipes.');
}

if (!exportPresetLocale.success) {
  failures.push('Export recipe readiness locale keys must be present.');
}

for (const marker of [
  'data-testid="export-recipe-readiness-summary"',
  'data-recipe-count={recipeRows.length}',
  'data-valid-recipe-count={validRecipeCount}',
  'data-built-in-recipe-count={builtInRecipeCount}',
  'ui.exportPresets.validRecipeCount',
]) {
  if (!componentSource.includes(marker)) {
    failures.push(`Export recipe readiness marker missing: ${marker}`);
  }
}

for (const row of rows) {
  const parsed = exportRecipeUiRowSchema.safeParse(row);
  if (!parsed.success) {
    failures.push(`${row.id} failed UI row schema validation.`);
  }
}

if (failures.length > 0) {
  console.error('Export recipe UI validation failed.');
  console.error(failures.join('\n'));
  process.exit(1);
}

console.log(`export recipe UI ok rows=${rows.length}`);
