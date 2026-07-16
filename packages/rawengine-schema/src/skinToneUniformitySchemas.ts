import { z } from 'zod';

export const skinToneUniformityParamsV1Schema = z
  .object({
    enabled: z.boolean(),
    hueUniformity: z.number().min(0).max(0.75),
    luminanceUniformity: z.number().min(0).max(0.75),
    maxHueShiftDegrees: z.number().min(0).max(30),
    saturationUniformity: z.number().min(0).max(0.75),
    targetHueDegrees: z.number().min(0).lt(360),
    targetLuminance: z.number().min(0).max(1),
    targetSaturation: z.number().min(0).max(1),
  })
  .strict();

export const SKIN_TONE_UNIFORMITY_PARAMS_V1_DEFAULTS = {
  enabled: false,
  hueUniformity: 0.42,
  luminanceUniformity: 0.18,
  maxHueShiftDegrees: 16,
  saturationUniformity: 0.31,
  targetHueDegrees: 24,
  targetLuminance: 0.56,
  targetSaturation: 0.38,
} as const;

export const SKIN_TONE_UNIFORMITY_PARAMS_V1_FIELDS = ['skinToneUniformity'] as const;

export type SkinToneUniformityParamsV1 = z.infer<typeof skinToneUniformityParamsV1Schema>;
