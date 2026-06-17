#!/usr/bin/env bun

import { z } from 'zod';

import { expectInvalidCases, finishFixtureCheck, readJson } from './lib/fixture-checks.ts';
import {
  buildWaveletDetailPreviewPlan,
  estimateWaveletDetailPasses,
  parseWaveletDetailRecipe,
  waveletDetailPreviewPlanSchema,
  waveletDetailRecipeSchema,
} from '../src/schemas/waveletDetailSchemas.ts';

const invalidCaseSchema = z.object({ case: z.string().min(1), recipe: z.unknown() }).strict();

const recipes = z.array(z.unknown()).parse(await readJson('fixtures/detail/wavelet-detail-recipes.json'));
const invalidCases = z
  .array(invalidCaseSchema)
  .parse(await readJson('fixtures/detail/invalid-wavelet-detail-recipes.json'));
const failures: string[] = [];

let totalPasses = 0;
let previewEnabledCount = 0;
for (const recipeValue of recipes) {
  const recipe = parseWaveletDetailRecipe(recipeValue);
  const plan = waveletDetailPreviewPlanSchema.parse(buildWaveletDetailPreviewPlan(recipe));
  totalPasses += plan.passCount;
  if (plan.previewEnabled) previewEnabledCount += 1;

  if (plan.passCount > 0 && estimateWaveletDetailPasses(recipe) !== plan.passCount + 1) {
    failures.push(`${recipe.id}: preview plan pass count does not match runtime estimate.`);
  }

  if (plan.passCount === 0 && plan.previewMode !== 'off') {
    failures.push(`${recipe.id}: disabled preview plan must use off mode.`);
  }
}

expectInvalidCases({
  failures,
  getPayload: (invalidCase) => invalidCase.recipe,
  invalidCases,
  label: 'wavelet detail recipe',
  schema: waveletDetailRecipeSchema,
});

if (totalPasses !== 5) {
  failures.push(`Expected 5 active wavelet detail preview passes across fixtures, got ${totalPasses}.`);
}

if (previewEnabledCount !== 2) {
  failures.push(`Expected 2 enabled wavelet detail preview plans, got ${previewEnabledCount}.`);
}

finishFixtureCheck({
  failures,
  invalidCount: invalidCases.length,
  label: 'wavelet detail recipes',
  validCount: recipes.length,
});
