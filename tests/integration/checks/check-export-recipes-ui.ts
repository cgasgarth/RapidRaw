#!/usr/bin/env bun

import { readFile } from 'node:fs/promises';

import { z } from 'zod';

import { CLIENT_PROOF_TIFF_EXPORT_RECIPE_ID } from '../../../src/schemas/exportRecipeIds.ts';
import { buildExportRecipeUiRows, exportRecipeUiRowSchema } from '../../../src/schemas/exportRecipeUiSchemas.ts';

const recipesJson: unknown = JSON.parse(await readFile('fixtures/export/export-recipes.json', 'utf8'));
const recipes = z.array(z.unknown()).parse(recipesJson);
const rows = buildExportRecipeUiRows(recipes);
const failures = [];

if (rows.length !== recipes.length) {
  failures.push(`Expected ${recipes.length} UI rows, got ${rows.length}.`);
}

if (!rows.some((row) => row.isBuiltIn && row.id === CLIENT_PROOF_TIFF_EXPORT_RECIPE_ID)) {
  failures.push('Client proof TIFF built-in recipe must be visible.');
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
