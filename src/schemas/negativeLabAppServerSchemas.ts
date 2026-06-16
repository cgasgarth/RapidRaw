import { z } from 'zod';

import { negativeLabFrameHealthReportSchema } from './negativeLabFrameHealthSchemas';
import {
  negativeLabBaseFogSampleRectSchema,
  negativeLabPresetIdSchema,
  negativeLabPresetParamsSchema,
} from './negativeLabPresetCatalogSchemas';

export const negativeLabConversionPlanCommandNameSchema = z.literal('negative.lab.build_conversion_plan');
export const negativeLabFrameHealthCommandNameSchema = z.literal('negative.lab.build_frame_health_report');
export const negativeLabAppServerCommandNameSchema = z.union([
  negativeLabConversionPlanCommandNameSchema,
  negativeLabFrameHealthCommandNameSchema,
]);
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

export const negativeLabFrameHealthAppServerCommandSchema = z
  .object({
    activePathIndex: z.number().int().nonnegative(),
    baseFogConfidence: z.number().min(0).max(1).nullable(),
    includedPaths: z.array(z.string().trim().min(1)).min(1),
    previewReady: z.boolean(),
    targetPaths: z.array(z.string().trim().min(1)).min(1),
  })
  .strict();

export const negativeLabConversionPlanRouteSchema = z
  .object({
    commandName: negativeLabConversionPlanCommandNameSchema,
    inputSchemaName: z.literal('NegativeLabAppServerCommandV1'),
    outputSchemaName: z.literal('NegativeLabConversionPlanResultV1'),
    reason: z.string().trim().min(1),
    status: z.literal('mapped'),
  })
  .strict();

export const negativeLabFrameHealthRouteSchema = z
  .object({
    commandName: negativeLabFrameHealthCommandNameSchema,
    inputSchemaName: z.literal('NegativeLabFrameHealthAppServerCommandV1'),
    outputSchemaName: z.literal('NegativeLabFrameHealthReportV1'),
    reason: z.string().trim().min(1),
    status: z.literal('mapped'),
  })
  .strict();

export const negativeLabAppServerRouteSchema = z.union([
  negativeLabConversionPlanRouteSchema,
  negativeLabFrameHealthRouteSchema,
]);

export const negativeLabAppServerRouteManifestSchema = z
  .object({
    routes: z.array(negativeLabAppServerRouteSchema).min(1),
    schemaVersion: z.literal(1),
  })
  .strict();

export const negativeLabConversionPlanResultSchema = z
  .object({
    commandName: negativeLabConversionPlanCommandNameSchema,
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

export const negativeLabFrameHealthAppServerResultSchema = negativeLabFrameHealthReportSchema;

export type NegativeLabAppServerCommand = z.infer<typeof negativeLabAppServerCommandSchema>;
export type NegativeLabConversionPlanResult = z.infer<typeof negativeLabConversionPlanResultSchema>;
export type NegativeLabFrameHealthAppServerCommand = z.infer<typeof negativeLabFrameHealthAppServerCommandSchema>;
export type NegativeLabFrameHealthAppServerResult = z.infer<typeof negativeLabFrameHealthAppServerResultSchema>;
