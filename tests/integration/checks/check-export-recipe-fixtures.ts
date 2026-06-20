#!/usr/bin/env bun

import { readFile } from 'node:fs/promises';

import {
  exportRecipeCatalogV1Schema,
  exportRecipeV1Schema,
  parseExportRecipesV1,
  upsertExportRecipeV1,
} from '../../../packages/rawengine-schema/src/exportRecipeSchemas.ts';

const validFixturePath = 'fixtures/export/export-recipes.json';
const invalidFixturePath = 'fixtures/export/invalid-export-recipes.json';

const readJson = async (path) => JSON.parse(await readFile(path, 'utf8'));

const rawValidRecipes = await readJson(validFixturePath);
const validRecipes = parseExportRecipesV1(rawValidRecipes);
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
  const result = exportRecipeV1Schema.safeParse(invalidCase.recipe);
  if (result.success) {
    failures.push(`${invalidCase.case} unexpectedly passed`);
  }
}

const catalog = exportRecipeCatalogV1Schema.parse({
  recipeRevision: 'recipes:fixture:1',
  recipes: validRecipes,
});
const upsertRecipe = {
  ...validRecipes[0],
  colorProfile: 'adobeRgb1998',
  enableResize: true,
  fileFormat: 'jpeg',
  id: 'client-proof-jpeg-v2',
  name: 'Client Proof JPEG v2',
  resizeMode: 'longEdge',
  resizeValue: 3600,
};
const dryRun = upsertExportRecipeV1(catalog, {
  commandId: 'command_export_recipe_fixture_dry_run',
  commandType: 'exportRecipe.upsert',
  dryRun: true,
  expectedRecipeRevision: catalog.recipeRevision,
  recipe: upsertRecipe,
});
if (dryRun.result.mutates || dryRun.catalog.recipes.length !== catalog.recipes.length) {
  failures.push('Export recipe dry-run upsert must not mutate the catalog.');
}

const applied = upsertExportRecipeV1(catalog, {
  commandId: 'command_export_recipe_fixture_apply',
  commandType: 'exportRecipe.upsert',
  dryRun: false,
  expectedRecipeRevision: catalog.recipeRevision,
  recipe: upsertRecipe,
});
const persistedRecipe = applied.catalog.recipes.find((recipe) => recipe.id === upsertRecipe.id);
if (!applied.result.mutates) failures.push('Export recipe apply upsert must report mutation.');
if (persistedRecipe?.resizeValue !== 3600) failures.push('Export recipe apply must persist resize settings.');
if (persistedRecipe?.fileFormat !== 'jpeg') failures.push('Export recipe apply must persist file format.');
if (persistedRecipe?.colorProfile !== 'adobeRgb1998') {
  failures.push('Export recipe apply must persist color profile.');
}

if (failures.length > 0) {
  console.error('Export recipe fixture validation failed.');
  console.error(failures.join('\n'));
  process.exit(1);
}

console.log(`Validated ${validRecipes.length} export recipes and ${invalidCases.length} invalid cases.`);
