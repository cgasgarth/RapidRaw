import { z } from 'zod';

const normalizedScalarSchema = z.number().min(0).max(1);

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

export const waveletDetailPreviewPlanSchema = z
  .object({
    colorSpace: waveletDetailRecipeSchema.shape.colorSpace,
    edgeThreshold: normalizedScalarSchema,
    haloSuppression: normalizedScalarSchema,
    id: z.string().trim().min(1),
    passCount: z.number().int().nonnegative(),
    passes: z.array(waveletDetailPreviewPassSchema),
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
  });

export type WaveletDetailRecipe = z.infer<typeof waveletDetailRecipeSchema>;
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
    previewEnabled,
    previewMode: previewEnabled ? recipe.previewMode : 'off',
    schemaVersion: 1,
  });
}
