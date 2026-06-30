import { z } from 'zod';

export const localContrastModeSchema = z.enum(['classic', 'edge_protected', 'midtone_masked']);

export const localContrastSettingsSchema = z
  .object({
    amount: z.number().min(-100).max(100),
    haloGuard: z.number().int().min(0).max(100),
    midtoneMask: z.number().int().min(0).max(100),
    mode: localContrastModeSchema,
    radiusPx: z.number().int().min(4).max(96),
  })
  .strict()
  .superRefine((settings, context) => {
    if (settings.mode === 'edge_protected' && settings.haloGuard < 35) {
      context.addIssue({
        code: 'custom',
        message: 'Edge-protected local contrast requires halo guard >= 35.',
        path: ['haloGuard'],
      });
    }

    if (settings.mode === 'midtone_masked' && settings.midtoneMask < 40) {
      context.addIssue({
        code: 'custom',
        message: 'Midtone-masked local contrast requires midtone mask >= 40.',
        path: ['midtoneMask'],
      });
    }
  });

export const localContrastFixtureSchema = z
  .object({
    cases: z.array(localContrastSettingsSchema).min(3),
    validationStatus: z.literal('ui_control_contract'),
  })
  .strict();

export type LocalContrastSettings = z.infer<typeof localContrastSettingsSchema>;
