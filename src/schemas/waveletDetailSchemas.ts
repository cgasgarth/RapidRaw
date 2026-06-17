import { z } from 'zod';

const normalizedScalarSchema = z.number().min(0).max(1);
const artifactHashSchema = z.string().regex(/^fnv1a32:[a-f0-9]{8}$/u);

export const waveletDetailScaleSchema = z
  .object({
    amount: z.number().min(-100).max(100),
    enabled: z.boolean(),
    radiusPx: z.number().positive().max(128),
  })
  .strict()
  .superRefine((scale, context) => {
    if (!scale.enabled && scale.amount !== 0) {
      context.addIssue({
        code: 'custom',
        message: 'Disabled wavelet scales must use amount 0.',
        path: ['amount'],
      });
    }
  });

export const waveletDetailRecipeSchema = z
  .object({
    coarse: waveletDetailScaleSchema,
    colorSpace: z.enum(['linear_rec2020', 'display_p3', 'srgb']),
    edgeThreshold: normalizedScalarSchema,
    fine: waveletDetailScaleSchema,
    haloSuppression: normalizedScalarSchema,
    id: z.string().trim().min(1),
    medium: waveletDetailScaleSchema,
    previewMode: z.enum(['off', 'luma_detail', 'before_after']),
    schemaVersion: z.literal(1),
  })
  .strict()
  .superRefine((recipe, context) => {
    if (recipe.fine.radiusPx >= recipe.medium.radiusPx || recipe.medium.radiusPx >= recipe.coarse.radiusPx) {
      context.addIssue({
        code: 'custom',
        message: 'Wavelet detail radii must increase from fine to medium to coarse.',
        path: ['fine', 'radiusPx'],
      });
    }

    const activeScales = [recipe.fine, recipe.medium, recipe.coarse].filter(
      (scale) => scale.enabled && scale.amount !== 0,
    );
    if (activeScales.length === 0 && recipe.previewMode !== 'off') {
      context.addIssue({
        code: 'custom',
        message: 'Preview mode must be off when no wavelet scales are active.',
        path: ['previewMode'],
      });
    }
  });

export const waveletDetailPreviewPassSchema = z
  .object({
    amount: z.number().min(-100).max(100),
    radiusPx: z.number().positive().max(128),
    scale: z.enum(['fine', 'medium', 'coarse']),
  })
  .strict();

export const waveletDetailPreviewArtifactSchema = z
  .object({
    artifactId: z.string().regex(/^wavelet_detail\.preview\.[a-z0-9._-]+$/u),
    colorSpace: waveletDetailRecipeSchema.shape.colorSpace,
    contentHash: artifactHashSchema,
    kind: z.literal('luma_detail_preview'),
    passCount: z.number().int().positive(),
  })
  .strict();

export const waveletDetailPreviewPlanSchema = z
  .object({
    colorSpace: waveletDetailRecipeSchema.shape.colorSpace,
    edgeThreshold: normalizedScalarSchema,
    haloSuppression: normalizedScalarSchema,
    id: z.string().trim().min(1),
    passCount: z.number().int().nonnegative(),
    passes: z.array(waveletDetailPreviewPassSchema),
    previewArtifact: waveletDetailPreviewArtifactSchema.nullable(),
    previewEnabled: z.boolean(),
    previewMode: waveletDetailRecipeSchema.shape.previewMode,
    schemaVersion: z.literal(1),
  })
  .strict()
  .superRefine((plan, context) => {
    if (plan.passCount !== plan.passes.length) {
      context.addIssue({
        code: 'custom',
        message: 'Wavelet preview pass count must match passes length.',
        path: ['passCount'],
      });
    }

    if (!plan.previewEnabled && plan.previewMode !== 'off') {
      context.addIssue({
        code: 'custom',
        message: 'Disabled wavelet preview plans must use off preview mode.',
        path: ['previewMode'],
      });
    }

    if (plan.previewEnabled && plan.previewArtifact === null) {
      context.addIssue({
        code: 'custom',
        message: 'Enabled wavelet preview plans must include a preview artifact.',
        path: ['previewArtifact'],
      });
    }

    if (!plan.previewEnabled && plan.previewArtifact !== null) {
      context.addIssue({
        code: 'custom',
        message: 'Disabled wavelet preview plans must not include a preview artifact.',
        path: ['previewArtifact'],
      });
    }

    if (plan.previewArtifact !== null && plan.previewArtifact.passCount !== plan.passCount) {
      context.addIssue({
        code: 'custom',
        message: 'Wavelet preview artifact pass count must match plan pass count.',
        path: ['previewArtifact', 'passCount'],
      });
    }
  });

export const waveletDetailPreviewManifestSchema = z
  .object({
    artifacts: z.array(waveletDetailPreviewArtifactSchema),
    id: z.string().regex(/^wavelet_detail\.preview_manifest\.[a-z0-9._-]+$/u),
    limitations: z.array(z.enum(['metadata_manifest_only', 'no_pixel_wavelet_render'])).min(2),
    plan: waveletDetailPreviewPlanSchema,
    schemaVersion: z.literal(1),
    selectedArtifactId: waveletDetailPreviewArtifactSchema.shape.artifactId.nullable(),
    sourceImageId: z.string().trim().min(1),
    status: z.enum(['ready', 'disabled']),
  })
  .strict()
  .superRefine((manifest, context) => {
    const artifactIds = manifest.artifacts.map((artifact) => artifact.artifactId);

    if (new Set(artifactIds).size !== artifactIds.length) {
      context.addIssue({
        code: 'custom',
        message: 'Wavelet preview manifest artifact ids must be unique.',
        path: ['artifacts'],
      });
    }

    if (manifest.status === 'ready') {
      if (!manifest.plan.previewEnabled) {
        context.addIssue({
          code: 'custom',
          message: 'Ready wavelet preview manifests must reference an enabled preview plan.',
          path: ['plan', 'previewEnabled'],
        });
      }

      if (manifest.selectedArtifactId === null || !artifactIds.includes(manifest.selectedArtifactId)) {
        context.addIssue({
          code: 'custom',
          message: 'Ready wavelet preview manifests must select a listed artifact.',
          path: ['selectedArtifactId'],
        });
      }
    }

    if (manifest.status === 'disabled') {
      if (manifest.plan.previewEnabled) {
        context.addIssue({
          code: 'custom',
          message: 'Disabled wavelet preview manifests must reference a disabled preview plan.',
          path: ['plan', 'previewEnabled'],
        });
      }

      if (manifest.selectedArtifactId !== null || manifest.artifacts.length !== 0) {
        context.addIssue({
          code: 'custom',
          message: 'Disabled wavelet preview manifests must not include artifacts.',
          path: ['artifacts'],
        });
      }
    }
  });

export type WaveletDetailRecipe = z.infer<typeof waveletDetailRecipeSchema>;
export type WaveletDetailPreviewArtifact = z.infer<typeof waveletDetailPreviewArtifactSchema>;
export type WaveletDetailPreviewManifest = z.infer<typeof waveletDetailPreviewManifestSchema>;
export type WaveletDetailPreviewPass = z.infer<typeof waveletDetailPreviewPassSchema>;
export type WaveletDetailPreviewPlan = z.infer<typeof waveletDetailPreviewPlanSchema>;
export type WaveletDetailScale = z.infer<typeof waveletDetailScaleSchema>;

export function estimateWaveletDetailPasses(recipe: WaveletDetailRecipe): number {
  const activeScaleCount = [recipe.fine, recipe.medium, recipe.coarse].filter(
    (scale) => scale.enabled && scale.amount !== 0,
  ).length;
  return activeScaleCount === 0 ? 0 : activeScaleCount + 1;
}

export function parseWaveletDetailRecipe(value: unknown): WaveletDetailRecipe {
  return waveletDetailRecipeSchema.parse(value);
}

function fnv1a32(value: string): string {
  let hash = 0x811c9dc5;
  for (const character of value) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

function buildWaveletDetailPreviewArtifact(
  recipe: WaveletDetailRecipe,
  passes: readonly WaveletDetailPreviewPass[],
): WaveletDetailPreviewArtifact | null {
  if (passes.length === 0 || recipe.previewMode === 'off') {
    return null;
  }

  const signature = JSON.stringify({
    colorSpace: recipe.colorSpace,
    edgeThreshold: recipe.edgeThreshold,
    haloSuppression: recipe.haloSuppression,
    id: recipe.id,
    passes,
    previewMode: recipe.previewMode,
  });

  return waveletDetailPreviewArtifactSchema.parse({
    artifactId: `wavelet_detail.preview.${recipe.id}`,
    colorSpace: recipe.colorSpace,
    contentHash: `fnv1a32:${fnv1a32(signature)}`,
    kind: 'luma_detail_preview',
    passCount: passes.length,
  });
}

export function buildWaveletDetailPreviewPlan(recipe: WaveletDetailRecipe): WaveletDetailPreviewPlan {
  const scaleEntries = [
    ['fine', recipe.fine],
    ['medium', recipe.medium],
    ['coarse', recipe.coarse],
  ] as const;
  const passes: WaveletDetailPreviewPass[] = scaleEntries
    .filter(([, scale]) => scale.enabled && scale.amount !== 0)
    .map(([scale, settings]) => ({
      amount: settings.amount,
      radiusPx: settings.radiusPx,
      scale,
    }));
  const previewEnabled = passes.length > 0 && recipe.previewMode !== 'off';

  return waveletDetailPreviewPlanSchema.parse({
    colorSpace: recipe.colorSpace,
    edgeThreshold: recipe.edgeThreshold,
    haloSuppression: recipe.haloSuppression,
    id: `${recipe.id}.preview_plan`,
    passCount: passes.length,
    passes,
    previewArtifact: buildWaveletDetailPreviewArtifact(recipe, passes),
    previewEnabled,
    previewMode: previewEnabled ? recipe.previewMode : 'off',
    schemaVersion: 1,
  });
}

export function buildWaveletDetailPreviewManifest({
  recipe,
  sourceImageId,
}: {
  recipe: WaveletDetailRecipe;
  sourceImageId: string;
}): WaveletDetailPreviewManifest {
  const plan = buildWaveletDetailPreviewPlan(recipe);
  const artifacts = plan.previewArtifact === null ? [] : [plan.previewArtifact];

  return waveletDetailPreviewManifestSchema.parse({
    artifacts,
    id: `wavelet_detail.preview_manifest.${recipe.id}`,
    limitations: ['metadata_manifest_only', 'no_pixel_wavelet_render'],
    plan,
    schemaVersion: 1,
    selectedArtifactId: plan.previewArtifact?.artifactId ?? null,
    sourceImageId,
    status: plan.previewEnabled ? 'ready' : 'disabled',
  });
}
