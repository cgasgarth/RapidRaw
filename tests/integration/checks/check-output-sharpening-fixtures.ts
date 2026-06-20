#!/usr/bin/env bun

import { z } from 'zod';

import { expectInvalidCases, finishFixtureCheck, readJson } from '../../../scripts/lib/fixture-checks.ts';
import {
  estimateOutputSharpeningPasses,
  outputSharpeningRecipeSchema,
  parseOutputSharpeningRecipe,
} from '../../../src/schemas/outputSharpeningSchemas.ts';

const invalidCaseSchema = z.object({ case: z.string().min(1), recipe: z.unknown() }).strict();

const recipes = z.array(z.unknown()).parse(await readJson('fixtures/detail/output-sharpening-recipes.json'));
const invalidCases = z
  .array(invalidCaseSchema)
  .parse(await readJson('fixtures/detail/invalid-output-sharpening-recipes.json'));
const failures: string[] = [];

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
