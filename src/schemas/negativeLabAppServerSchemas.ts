import { z } from 'zod';

import {
  negativeLabBaseFogSampleRectSchema,
  negativeLabPresetIdSchema,
  negativeLabPresetParamsSchema,
} from './negativeLabPresetCatalogSchemas';

export const negativeLabAppServerCommandNameSchema = z.literal('negative.lab.build_conversion_plan');
export const negativeLabAppServerOutputFormatSchema = z.enum(['jpeg_proof', 'tiff16']);
export const negativeLabAppServerScopeSchema = z.enum(['active', 'all']);

export const negativeLabAppServerCommandSchema = z
  .object({
    outputFormat: negativeLabAppServerOutputFormatSchema,
    paths: z.array(z.string().trim().min(1)).min(1),
    presetId: negativeLabPresetIdSchema,
    sampleRect: negativeLabBaseFogSampleRectSchema.nullable(),
    scope: negativeLabAppServerScopeSchema,
    suffix: z.string().trim().min(1).max(40),
  })
  .strict();

export const negativeLabAppServerRouteSchema = z
  .object({
    commandName: negativeLabAppServerCommandNameSchema,
    inputSchemaName: z.literal('NegativeLabAppServerCommandV1'),
    outputSchemaName: z.literal('NegativeLabConversionPlanResultV1'),
    reason: z.string().trim().min(1),
    status: z.literal('mapped'),
  })
  .strict();

export const negativeLabAppServerRouteManifestSchema = z
  .object({
    routes: z.array(negativeLabAppServerRouteSchema).min(1),
    schemaVersion: z.literal(1),
  })
  .strict();

export const negativeLabConversionPlanResultSchema = z
  .object({
    commandName: negativeLabAppServerCommandNameSchema,
    outputFormat: negativeLabAppServerOutputFormatSchema,
    params: negativeLabPresetParamsSchema,
    paths: z.array(z.string().trim().min(1)).min(1),
    presetId: negativeLabPresetIdSchema,
    proof: z
      .object({
        deterministic: z.literal(true),
        generatedFrom: z.literal('src/utils/negativeLabPresetCatalog.ts'),
      })
      .strict(),
    sampleRect: negativeLabBaseFogSampleRectSchema.nullable(),
    scope: negativeLabAppServerScopeSchema,
    suffix: z.string().trim().min(1).max(40),
  })
  .strict();

export type NegativeLabAppServerCommand = z.infer<typeof negativeLabAppServerCommandSchema>;
export type NegativeLabConversionPlanResult = z.infer<typeof negativeLabConversionPlanResultSchema>;
