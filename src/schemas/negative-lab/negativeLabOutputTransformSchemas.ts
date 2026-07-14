import { z } from 'zod';

export const negativeLabOutputTransformSchema = z
  .object({
    bitDepth: z.literal(8),
    implementationVersion: z.literal(1),
    inputColorDomain: z.literal('scene_linear_print_srgb_d65'),
    intent: z.literal('display_preview'),
    outputColorDomain: z.literal('srgb_display'),
    transformId: z.literal('scene_linear_to_srgb_gamma_v1'),
    transferFunction: z.literal('gamma_2_2_display_proof'),
  })
  .strict();

export const negativeLabSceneLinearStatsSchema = z
  .object({
    contentHash: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
    max: z.number().finite(),
    min: z.number().finite(),
    nonFiniteCount: z.number().int().nonnegative(),
  })
  .strict();

export type NegativeLabOutputTransform = z.infer<typeof negativeLabOutputTransformSchema>;
export type NegativeLabSceneLinearStats = z.infer<typeof negativeLabSceneLinearStatsSchema>;
