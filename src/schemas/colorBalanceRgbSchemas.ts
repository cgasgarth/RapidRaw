import { z } from 'zod';

export const colorBalanceRgbRangeSchema = z.enum(['shadows', 'midtones', 'highlights']);
export const colorBalanceRgbChannelSchema = z.enum(['red', 'green', 'blue']);

const colorBalanceRgbRangeSettingsSchema = z
  .object({
    blue: z.number().min(-100).max(100),
    green: z.number().min(-100).max(100),
    red: z.number().min(-100).max(100),
  })
  .strict();

export const colorBalanceRgbSettingsSchema = z
  .object({
    enabled: z.boolean(),
    highlights: colorBalanceRgbRangeSettingsSchema,
    midtones: colorBalanceRgbRangeSettingsSchema,
    preserveLuminance: z.boolean(),
    shadows: colorBalanceRgbRangeSettingsSchema,
  })
  .strict()
  .superRefine((settings, context) => {
    const values = [settings.shadows, settings.midtones, settings.highlights].flatMap((range) => Object.values(range));
    if (settings.enabled && values.every((value) => value === 0)) {
      context.addIssue({
        code: 'custom',
        message: 'Enabled RGB color balance requires at least one non-zero channel.',
        path: ['enabled'],
      });
    }
  });

export type ColorBalanceRgbRange = z.infer<typeof colorBalanceRgbRangeSchema>;
export type ColorBalanceRgbChannel = z.infer<typeof colorBalanceRgbChannelSchema>;
export type ColorBalanceRgbSettings = z.infer<typeof colorBalanceRgbSettingsSchema>;

export const parseColorBalanceRgbSettings = (value: unknown): ColorBalanceRgbSettings =>
  colorBalanceRgbSettingsSchema.parse(value);
