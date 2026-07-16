import { z } from 'zod';

export const rawProcessingModeV1Schema = z.enum(['fast', 'balanced', 'maximum']);
export const rawProcessingModeOverrideV1Schema = rawProcessingModeV1Schema.nullable();

export const sourceDecodeParamsV1Schema = z
  .object({ rawProcessingModeOverride: rawProcessingModeOverrideV1Schema })
  .strict();

export const SOURCE_DECODE_PARAMS_V1_DEFAULTS = { rawProcessingModeOverride: null } as const;
export const SOURCE_DECODE_PARAMS_V1_FIELDS = ['rawProcessingModeOverride'] as const;

export type RawProcessingModeV1 = z.infer<typeof rawProcessingModeV1Schema>;
export type RawProcessingModeOverrideV1 = z.infer<typeof rawProcessingModeOverrideV1Schema>;
export type SourceDecodeParamsV1 = z.infer<typeof sourceDecodeParamsV1Schema>;
