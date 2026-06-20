#!/usr/bin/env bun

import { z } from 'zod';

import { expectInvalidCases, finishFixtureCheck, readJson } from '../../../scripts/lib/fixture-checks.ts';
import {
  buildWaveletDetailPreviewManifest,
  buildWaveletDetailPreviewPlan,
  estimateWaveletDetailPasses,
  parseWaveletDetailRecipe,
  waveletDetailPreviewManifestSchema,
  waveletDetailPreviewPlanSchema,
  waveletDetailRecipeSchema,
} from '../../../src/schemas/waveletDetailSchemas.ts';

const invalidCaseSchema = z.object({ case: z.string().min(1), recipe: z.unknown() }).strict();

const recipes = z.array(z.unknown()).parse(await readJson('fixtures/detail/wavelet-detail-recipes.json'));
const invalidCases = z
  .array(invalidCaseSchema)
  .parse(await readJson('fixtures/detail/invalid-wavelet-detail-recipes.json'));
const failures: string[] = [];

let totalPasses = 0;
let previewArtifactCount = 0;
let previewEnabledCount = 0;
let readyManifestCount = 0;
for (const recipeValue of recipes) {
  const recipe = parseWaveletDetailRecipe(recipeValue);
  const plan = waveletDetailPreviewPlanSchema.parse(buildWaveletDetailPreviewPlan(recipe));
  const manifest = waveletDetailPreviewManifestSchema.parse(
    buildWaveletDetailPreviewManifest({
      recipe,
      sourceImageId: `fixture.raw.${recipe.id}`,
    }),
  );
  totalPasses += plan.passCount;
  if (plan.previewEnabled) previewEnabledCount += 1;
  if (plan.previewArtifact !== null) previewArtifactCount += 1;
  if (manifest.status === 'ready') readyManifestCount += 1;

  if (plan.passCount > 0 && estimateWaveletDetailPasses(recipe) !== plan.passCount + 1) {
    failures.push(`${recipe.id}: preview plan pass count does not match runtime estimate.`);
  }

  if (plan.passCount === 0 && plan.previewMode !== 'off') {
    failures.push(`${recipe.id}: disabled preview plan must use off mode.`);
  }

  if (plan.previewEnabled && plan.previewArtifact?.artifactId !== `wavelet_detail.preview.${recipe.id}`) {
    failures.push(`${recipe.id}: preview artifact id is unstable.`);
  }

  if (plan.previewArtifact !== null && !plan.previewArtifact.contentHash.startsWith('fnv1a32:')) {
    failures.push(`${recipe.id}: preview artifact content hash missing deterministic hash prefix.`);
  }

  if (manifest.plan.id !== plan.id) failures.push(`${recipe.id}: preview manifest plan mismatch.`);
  if (manifest.status === 'ready' && manifest.selectedArtifactId !== plan.previewArtifact?.artifactId) {
    failures.push(`${recipe.id}: ready preview manifest selected artifact mismatch.`);
  }
  if (manifest.status === 'disabled' && manifest.selectedArtifactId !== null) {
    failures.push(`${recipe.id}: disabled preview manifest should not select an artifact.`);
  }
  if (!manifest.limitations.includes('no_pixel_wavelet_render')) {
    failures.push(`${recipe.id}: preview manifest must disclose deferred pixel rendering.`);
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

if (previewArtifactCount !== previewEnabledCount) {
  failures.push(`Expected preview artifacts to match enabled previews, got ${previewArtifactCount}.`);
}

if (readyManifestCount !== previewEnabledCount) {
  failures.push(`Expected ready preview manifests to match enabled previews, got ${readyManifestCount}.`);
}

finishFixtureCheck({
  failures,
  invalidCount: invalidCases.length,
  label: 'wavelet detail recipes',
  validCount: recipes.length,
});
