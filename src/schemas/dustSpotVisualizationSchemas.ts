import { z } from 'zod';

export const dustSpotVisualizationModeSchema = z.enum(['off', 'candidate_overlay', 'edge_guard']);

export const dustSpotVisualizationSettingsSchema = z
  .object({
    candidateCount: z.number().int().min(0).max(500),
    falsePositiveGuards: z.array(z.enum(['edge_texture', 'film_grain', 'highlight_specular'])).min(1),
    minRadiusPx: z.number().min(0.5).max(12),
    mode: dustSpotVisualizationModeSchema,
    sensitivity: z.number().int().min(0).max(100),
  })
  .strict()
  .superRefine((settings, context) => {
    if (settings.mode === 'off' && settings.candidateCount !== 0) {
      context.addIssue({
        code: 'custom',
        message: 'Disabled dust visualization must not report candidates.',
        path: ['candidateCount'],
      });
    }

    if (settings.mode !== 'off' && settings.sensitivity === 0) {
      context.addIssue({
        code: 'custom',
        message: 'Active dust visualization requires nonzero sensitivity.',
        path: ['sensitivity'],
      });
    }
  });

export const dustSpotVisualizationFixtureSchema = z
  .object({
    cases: z.array(dustSpotVisualizationSettingsSchema).min(2),
    notes: z.string().min(1),
    validationStatus: z.literal('ui_overlay_contract'),
  })
  .strict();

export type DustSpotVisualizationSettings = z.infer<typeof dustSpotVisualizationSettingsSchema>;
