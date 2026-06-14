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

export type WaveletDetailRecipe = z.infer<typeof waveletDetailRecipeSchema>;
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
