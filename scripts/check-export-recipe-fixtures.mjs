#!/usr/bin/env bun

import { readFile } from 'node:fs/promises';

import { exportRecipeSchema, parseExportRecipes } from '../src/schemas/exportRecipeSchemas.ts';

const validFixturePath = 'fixtures/export/export-recipes.json';
const invalidFixturePath = 'fixtures/export/invalid-export-recipes.json';

const readJson = async (path) => JSON.parse(await readFile(path, 'utf8'));

const rawValidRecipes = await readJson(validFixturePath);
const validRecipes = parseExportRecipes(rawValidRecipes);
const invalidCases = await readJson(invalidFixturePath);

const failures = [];
const ids = new Set();

for (const [index, recipe] of validRecipes.entries()) {
  const rawRecipe = rawValidRecipes[index];
  if (!recipe.colorProfile) {
    failures.push(`${recipe.id} must declare colorProfile`);
  }
  if (!rawRecipe || typeof rawRecipe.colorProfile !== 'string') {
    failures.push(`${recipe.id} fixture must explicitly declare colorProfile`);
  }

  if (ids.has(recipe.id)) {
    failures.push(`Duplicate export recipe id: ${recipe.id}`);
  }
  ids.add(recipe.id);

  if (!recipe.filenameTemplate.includes('{original_filename}')) {
    failures.push(`${recipe.id} filenameTemplate must include {original_filename}`);
  }
}

for (const invalidCase of invalidCases) {
  const result = exportRecipeSchema.safeParse(invalidCase.recipe);
  if (result.success) {
    failures.push(`${invalidCase.case} unexpectedly passed`);
  }
}

if (failures.length > 0) {
  console.error('Export recipe fixture validation failed.');
  console.error(failures.join('\n'));
  process.exit(1);
}

console.log(`Validated ${validRecipes.length} export recipes and ${invalidCases.length} invalid cases.`);
