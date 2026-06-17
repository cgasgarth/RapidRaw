#!/usr/bin/env bun

import { z } from 'zod';

import { expectInvalidCases, finishFixtureCheck, readJson } from './lib/fixture-checks.ts';
import {
  estimateWaveletDetailPasses,
  parseWaveletDetailRecipe,
  waveletDetailRecipeSchema,
} from '../src/schemas/waveletDetailSchemas.ts';

const invalidCaseSchema = z.object({ case: z.string().min(1), recipe: z.unknown() }).strict();

const recipes = z.array(z.unknown()).parse(await readJson('fixtures/detail/wavelet-detail-recipes.json'));
const invalidCases = z
  .array(invalidCaseSchema)
  .parse(await readJson('fixtures/detail/invalid-wavelet-detail-recipes.json'));
const failures: string[] = [];

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
