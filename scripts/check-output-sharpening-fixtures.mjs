#!/usr/bin/env bun

import { readFile } from 'node:fs/promises';

import {
  estimateOutputSharpeningPasses,
  outputSharpeningRecipeSchema,
  parseOutputSharpeningRecipe,
} from '../src/schemas/outputSharpeningSchemas.ts';

const readJson = async (path) => JSON.parse(await readFile(path, 'utf8'));

const recipes = await readJson('fixtures/detail/output-sharpening-recipes.json');
const invalidCases = await readJson('fixtures/detail/invalid-output-sharpening-recipes.json');
const failures = [];

let totalPasses = 0;
for (const recipeValue of recipes) {
  const recipe = parseOutputSharpeningRecipe(recipeValue);
  totalPasses += estimateOutputSharpeningPasses(recipe);
}

for (const invalidCase of invalidCases) {
  const result = outputSharpeningRecipeSchema.safeParse(invalidCase.recipe);
  if (result.success) {
    failures.push(`${invalidCase.case} unexpectedly passed.`);
  }
}

if (totalPasses !== 3) {
  failures.push(`Expected 3 output sharpening passes across fixtures, got ${totalPasses}.`);
}

if (failures.length > 0) {
  console.error('Output sharpening fixture validation failed.');
  console.error(failures.join('\n'));
  process.exit(1);
}

console.log(`Validated ${recipes.length} output sharpening recipes and ${invalidCases.length} invalid cases.`);
