import { z } from 'zod';

export const levelsSettingsSchema = z
  .object({
    enabled: z.boolean(),
    gamma: z.number().min(0.1).max(5),
    inputBlack: z.number().min(0).max(1),
    inputWhite: z.number().min(0).max(1),
    outputBlack: z.number().min(0).max(1),
    outputWhite: z.number().min(0).max(1),
  })
  .strict()
  .superRefine((settings, context) => {
    if (settings.inputBlack >= settings.inputWhite) {
      context.addIssue({
        code: 'custom',
        message: 'Levels input black must be below input white.',
        path: ['inputBlack'],
      });
    }

    if (settings.outputBlack >= settings.outputWhite) {
      context.addIssue({
        code: 'custom',
        message: 'Levels output black must be below output white.',
        path: ['outputBlack'],
      });
    }
  });

export type LevelsSettings = z.infer<typeof levelsSettingsSchema>;

export const parseLevelsSettings = (value: unknown): LevelsSettings => levelsSettingsSchema.parse(value);
