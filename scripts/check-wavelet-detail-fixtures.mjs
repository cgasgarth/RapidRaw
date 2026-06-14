#!/usr/bin/env bun

import { readFile } from 'node:fs/promises';

import {
  estimateWaveletDetailPasses,
  parseWaveletDetailRecipe,
  waveletDetailRecipeSchema,
} from '../src/schemas/waveletDetailSchemas.ts';

const readJson = async (path) => JSON.parse(await readFile(path, 'utf8'));

const recipes = await readJson('fixtures/detail/wavelet-detail-recipes.json');
const invalidCases = await readJson('fixtures/detail/invalid-wavelet-detail-recipes.json');
const failures = [];

let totalPasses = 0;
for (const recipeValue of recipes) {
  const recipe = parseWaveletDetailRecipe(recipeValue);
  totalPasses += estimateWaveletDetailPasses(recipe);
}

for (const invalidCase of invalidCases) {
  const result = waveletDetailRecipeSchema.safeParse(invalidCase.recipe);
  if (result.success) {
    failures.push(`${invalidCase.case} unexpectedly passed.`);
  }
}

if (totalPasses !== 7) {
  failures.push(`Expected 7 wavelet detail passes across fixtures, got ${totalPasses}.`);
}

if (failures.length > 0) {
  console.error('Wavelet detail fixture validation failed.');
  console.error(failures.join('\n'));
  process.exit(1);
}

console.log(`Validated ${recipes.length} wavelet detail recipes and ${invalidCases.length} invalid cases.`);
