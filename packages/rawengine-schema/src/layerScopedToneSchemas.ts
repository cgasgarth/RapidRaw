import { z } from 'zod';

export const layerScopedToneAdjustmentV1Schema = z
  .object({
    blackPoint: z.number().min(-100).max(100),
    clarity: z.number().min(-100).max(100),
    contrast: z.number().min(-100).max(100),
    exposureEv: z.number().min(-5).max(5),
    highlights: z.number().min(-100).max(100),
    saturation: z.number().min(-100).max(100),
    shadows: z.number().min(-100).max(100),
    whitePoint: z.number().min(-100).max(100),
  })
  .strict();

export const layerScopedAdjustmentStateV1Schema = z
  .object({
    toneColor: layerScopedToneAdjustmentV1Schema.optional(),
  })
  .strict();

export type LayerScopedToneAdjustmentV1 = z.infer<typeof layerScopedToneAdjustmentV1Schema>;
export type LayerScopedAdjustmentStateV1 = z.infer<typeof layerScopedAdjustmentStateV1Schema>;
