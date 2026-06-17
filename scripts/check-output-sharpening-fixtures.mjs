#!/usr/bin/env bun

import {
  estimateOutputSharpeningPasses,
  outputSharpeningRecipeSchema,
  parseOutputSharpeningRecipe,
} from '../src/schemas/outputSharpeningSchemas.ts';
import { expectInvalidCases, finishFixtureCheck, readJson } from './lib/fixture-checks.mjs';

const recipes = await readJson('fixtures/detail/output-sharpening-recipes.json');
const invalidCases = await readJson('fixtures/detail/invalid-output-sharpening-recipes.json');
const failures = [];

let totalPasses = 0;
for (const recipeValue of recipes) {
  const recipe = parseOutputSharpeningRecipe(recipeValue);
  totalPasses += estimateOutputSharpeningPasses(recipe);
}

expectInvalidCases({
  failures,
  getPayload: (invalidCase) => invalidCase.recipe,
  invalidCases,
  label: 'output sharpening recipe',
  schema: outputSharpeningRecipeSchema,
});

if (totalPasses !== 3) {
  failures.push(`Expected 3 output sharpening passes across fixtures, got ${totalPasses}.`);
}

finishFixtureCheck({
  failures,
  invalidCount: invalidCases.length,
  label: 'output sharpening recipes',
  validCount: recipes.length,
});
