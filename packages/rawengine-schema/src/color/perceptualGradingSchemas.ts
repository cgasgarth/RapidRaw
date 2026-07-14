import { z } from 'zod';

export const perceptualGradingRangeV1Schema = z
  .object({
    brilliance: z.number().finite().min(-1).max(1),
    chroma: z.number().finite().min(-1).max(1),
    hueDegrees: z.number().finite().min(-360).max(360),
    luminanceEv: z.number().finite().min(-4).max(4),
    saturation: z.number().finite().min(-2).max(2),
  })
  .strict();

export const perceptualGradingSettingsV1Schema = z
  .object({
    balance: z.number().finite().min(-1).max(1),
    blending: z.number().finite().min(0).max(1),
    falloff: z.number().finite().min(0.1).max(4),
    global: perceptualGradingRangeV1Schema,
    highlightFulcrumEv: z.number().finite().min(-4).max(12),
    highlights: perceptualGradingRangeV1Schema,
    midtones: perceptualGradingRangeV1Schema,
    neutralProtection: z.number().finite().min(0).max(1),
    perceptualModel: z.literal('oklab_d65_from_acescg_v1'),
    shadowFulcrumEv: z.number().finite().min(-12).max(4),
    shadows: perceptualGradingRangeV1Schema,
    skinProtection: z.number().finite().min(0).max(1),
  })
  .strict()
  .refine((settings) => settings.shadowFulcrumEv < settings.highlightFulcrumEv, {
    message: 'shadowFulcrumEv must be below highlightFulcrumEv',
  });

export type PerceptualGradingRangeV1 = z.infer<typeof perceptualGradingRangeV1Schema>;
export type PerceptualGradingSettingsV1 = z.infer<typeof perceptualGradingSettingsV1Schema>;
