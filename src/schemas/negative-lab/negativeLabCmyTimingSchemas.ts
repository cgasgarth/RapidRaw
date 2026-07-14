import { z } from 'zod';

export const negativeLabCmyTimingParamsSchema = z
  .object({
    algorithm_version: z.literal(1),
    enabled: z.boolean(),
    global_c: z.number().min(-1).max(1),
    global_m: z.number().min(-1).max(1),
    global_y: z.number().min(-1).max(1),
    shadow_c: z.number().min(-1).max(1),
    shadow_m: z.number().min(-1).max(1),
    shadow_y: z.number().min(-1).max(1),
    highlight_c: z.number().min(-1).max(1),
    highlight_m: z.number().min(-1).max(1),
    highlight_y: z.number().min(-1).max(1),
    transition_width: z.number().min(0.02).max(0.5),
    source: z.string().trim().min(1),
    sign_convention: z.literal('positive_density_reduces_channel_exposure_v1'),
  })
  .strict();

export const negativeLabCmyTimingMetricsSchema = z
  .object({
    changedPixelRatio: z.number().min(0).max(1),
    shadowMaskRatio: z.number().min(0).max(1),
    highlightMaskRatio: z.number().min(0).max(1),
    maxDensityDelta: z.number().nonnegative(),
  })
  .strict();
