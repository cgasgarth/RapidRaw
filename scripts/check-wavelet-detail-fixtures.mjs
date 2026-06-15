#!/usr/bin/env bun

import { readFile } from 'node:fs/promises';

import {
  estimateWaveletDetailPasses,
  parseWaveletDetailRecipe,
  waveletDetailRecipeSchema,
} from '../src/schemas/waveletDetailSchemas.ts';
import { ADJUSTMENT_GROUPS, DetailsAdjustment, INITIAL_ADJUSTMENTS } from '../src/utils/adjustments.ts';

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

if (INITIAL_ADJUSTMENTS.waveletDetailEnabled !== false) {
  failures.push('Wavelet detail controls must be disabled by default.');
}

if (INITIAL_ADJUSTMENTS.waveletDetailHaloSuppression !== 50) {
  failures.push('Wavelet detail halo suppression default must stay at 50.');
}

const detailGroupKeys = new Set(ADJUSTMENT_GROUPS.details.flatMap((group) => group.keys));
for (const key of [
  DetailsAdjustment.WaveletDetailEnabled,
  DetailsAdjustment.WaveletDetailFine,
  DetailsAdjustment.WaveletDetailMedium,
  DetailsAdjustment.WaveletDetailCoarse,
  DetailsAdjustment.WaveletDetailHaloSuppression,
]) {
  if (!detailGroupKeys.has(key)) {
    failures.push(`${key} must be included in detail copy/paste groups.`);
  }
}

if (failures.length > 0) {
  console.error('Wavelet detail fixture validation failed.');
  console.error(failures.join('\n'));
  process.exit(1);
}

console.log(`Validated ${recipes.length} wavelet detail recipes and ${invalidCases.length} invalid cases.`);
