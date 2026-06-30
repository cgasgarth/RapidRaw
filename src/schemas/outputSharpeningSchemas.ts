import { z } from 'zod';

import { OUTPUT_SHARPENING_FILE_FORMAT_IDS } from '../utils/export/exportFormatIds';

export const outputSharpeningTargetSchema = z.enum(['screen', 'print', 'custom']);

export const outputSharpeningSettingsSchema = z
  .object({
    amount: z.number().min(0).max(100),
    radiusPx: z.number().min(0.3).max(3),
    target: outputSharpeningTargetSchema,
    threshold: z.number().min(0).max(1),
  })
  .strict()
  .superRefine((settings, context) => {
    if (settings.target === 'print' && settings.amount > 0 && settings.radiusPx < 0.8) {
      context.addIssue({
        code: 'custom',
        message: 'Print output sharpening requires radiusPx >= 0.8.',
        path: ['radiusPx'],
      });
    }

    if (settings.amount === 0 && settings.threshold > 0) {
      context.addIssue({
        code: 'custom',
        message: 'Disabled output sharpening must use threshold 0.',
        path: ['threshold'],
      });
    }
  });

export const outputSharpeningRecipeSchema = z
  .object({
    format: z.enum(OUTPUT_SHARPENING_FILE_FORMAT_IDS),
    id: z.string().trim().min(1),
    outputSharpening: outputSharpeningSettingsSchema.nullable(),
    resize: z
      .object({
        longEdgePx: z.number().int().positive().max(100_000),
      })
      .strict()
      .nullable(),
    schemaVersion: z.literal(1),
  })
  .strict()
  .superRefine((recipe, context) => {
    if (recipe.outputSharpening?.target === 'print' && recipe.resize === null) {
      context.addIssue({
        code: 'custom',
        message: 'Print output sharpening requires an explicit output size.',
        path: ['resize'],
      });
    }
  });

export type OutputSharpeningRecipe = z.infer<typeof outputSharpeningRecipeSchema>;
export type OutputSharpeningSettings = z.infer<typeof outputSharpeningSettingsSchema>;

export function estimateOutputSharpeningPasses(recipe: OutputSharpeningRecipe): number {
  if (recipe.outputSharpening === null || recipe.outputSharpening.amount === 0) {
    return 0;
  }

  return recipe.outputSharpening.target === 'print' ? 2 : 1;
}

export function parseOutputSharpeningRecipe(value: unknown): OutputSharpeningRecipe {
  return outputSharpeningRecipeSchema.parse(value);
}
