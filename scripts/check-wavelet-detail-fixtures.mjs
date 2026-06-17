#!/usr/bin/env bun

import {
  estimateWaveletDetailPasses,
  parseWaveletDetailRecipe,
  waveletDetailRecipeSchema,
} from '../src/schemas/waveletDetailSchemas.ts';
import { expectInvalidCases, finishFixtureCheck, readJson } from './lib/fixture-checks.mjs';

const recipes = await readJson('fixtures/detail/wavelet-detail-recipes.json');
const invalidCases = await readJson('fixtures/detail/invalid-wavelet-detail-recipes.json');
const failures = [];

let totalPasses = 0;
for (const recipeValue of recipes) {
  const recipe = parseWaveletDetailRecipe(recipeValue);
  totalPasses += estimateWaveletDetailPasses(recipe);
}

expectInvalidCases({
  failures,
  getPayload: (invalidCase) => invalidCase.recipe,
  invalidCases,
  label: 'wavelet detail recipe',
  schema: waveletDetailRecipeSchema,
});

if (totalPasses !== 7) {
  failures.push(`Expected 7 wavelet detail passes across fixtures, got ${totalPasses}.`);
}

finishFixtureCheck({
  failures,
  invalidCount: invalidCases.length,
  label: 'wavelet detail recipes',
  validCount: recipes.length,
});
