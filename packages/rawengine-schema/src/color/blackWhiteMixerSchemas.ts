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
    aquas: z.number().finite().min(-100).max(100),
    blues: z.number().finite().min(-100).max(100),
    greens: z.number().finite().min(-100).max(100),
    magentas: z.number().finite().min(-100).max(100),
    oranges: z.number().finite().min(-100).max(100),
    purples: z.number().finite().min(-100).max(100),
    reds: z.number().finite().min(-100).max(100),
    yellows: z.number().finite().min(-100).max(100),
  })
  .strict();

export const monochromeProcessSchema = z.enum(['neutral_panchromatic_v1', 'continuous_sensitivity_v1']);

export const monochromeSourceClassSchema = z.enum([
  'color_source',
  'monochrome_sensor',
  'encoded_grayscale',
  'already_monochrome_working',
]);

export const monochromePresetIdSchema = z.enum([
  'manual',
  'neutral_panchromatic',
  'yellow_filter',
  'orange_filter',
  'red_filter',
  'green_filter',
  'blue_filter',
]);

export const blackWhiteMixerSettingsSchema = z
  .object({
    enabled: z.boolean(),
    presetId: monochromePresetIdSchema.default('manual'),
    process: monochromeProcessSchema,
    sourceClass: monochromeSourceClassSchema.default('color_source'),
    weights: blackWhiteMixerWeightsSchema,
  })
  .strict();

export type BlackWhiteMixerChannel = z.infer<typeof blackWhiteMixerChannelSchema>;
export type BlackWhiteMixerSettings = z.infer<typeof blackWhiteMixerSettingsSchema>;
export type BlackWhiteMixerWeights = z.infer<typeof blackWhiteMixerWeightsSchema>;

export const parseBlackWhiteMixerSettings = (value: unknown): BlackWhiteMixerSettings =>
  blackWhiteMixerSettingsSchema.parse(value);
