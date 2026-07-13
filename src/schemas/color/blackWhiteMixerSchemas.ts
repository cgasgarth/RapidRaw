import { z } from 'zod';

export const blackWhiteMixerChannelSchema = z.enum([
  'reds',
  'oranges',
  'yellows',
  'greens',
  'aquas',
  'blues',
  'purples',
  'magentas',
]);

export const blackWhiteMixerWeightsSchema = z
  .object({
    aquas: z.number().min(-100).max(100),
    blues: z.number().min(-100).max(100),
    greens: z.number().min(-100).max(100),
    magentas: z.number().min(-100).max(100),
    oranges: z.number().min(-100).max(100),
    purples: z.number().min(-100).max(100),
    reds: z.number().min(-100).max(100),
    yellows: z.number().min(-100).max(100),
  })
  .strict();

export const monochromeProcessSchema = z.enum(['legacy_fixed_band_v1', 'neutral_panchromatic_v1']);

export const blackWhiteMixerSettingsSchema = z
  .object({
    enabled: z.boolean(),
    process: monochromeProcessSchema.default('legacy_fixed_band_v1'),
    weights: blackWhiteMixerWeightsSchema,
  })
  .strict()
  .superRefine((settings, context) => {
    const values = Object.values(settings.weights);
    const hasAdjustment = values.some((value) => value !== 0);
    if (settings.enabled && settings.process === 'legacy_fixed_band_v1' && !hasAdjustment) {
      context.addIssue({
        code: 'custom',
        message: 'Enabled black and white mixer requires at least one non-zero channel weight.',
        path: ['weights'],
      });
    }
  });

export type BlackWhiteMixerChannel = z.infer<typeof blackWhiteMixerChannelSchema>;
export type BlackWhiteMixerWeights = z.infer<typeof blackWhiteMixerWeightsSchema>;
export type BlackWhiteMixerSettings = z.infer<typeof blackWhiteMixerSettingsSchema>;

export const parseBlackWhiteMixerSettings = (value: unknown): BlackWhiteMixerSettings =>
  blackWhiteMixerSettingsSchema.parse(value);
