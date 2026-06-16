import { z } from 'zod';

import {
  negativeLabBatchDryRunSummarySchema,
  negativeLabFrameHealthReportSchema,
} from './negativeLabFrameHealthSchemas';
import {
  negativeBaseFogDensitometerReadoutSchema,
  negativeBaseFogEstimateSchema,
  negativeLabBaseFogSampleRectSchema,
  negativeLabPresetIdSchema,
  negativeLabPresetParamsSchema,
} from './negativeLabPresetCatalogSchemas';

export const negativeLabConversionPlanCommandNameSchema = z.literal('negative.lab.build_conversion_plan');
export const negativeLabBatchSummaryCommandNameSchema = z.literal('negative.lab.build_batch_dry_run_summary');
export const negativeLabDensitometerCommandNameSchema = z.literal('negative.lab.build_densitometer_readout');
export const negativeLabFrameHealthCommandNameSchema = z.literal('negative.lab.build_frame_health_report');
export const negativeLabAppServerCommandNameSchema = z.union([
  negativeLabBatchSummaryCommandNameSchema,
  negativeLabConversionPlanCommandNameSchema,
  negativeLabDensitometerCommandNameSchema,
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

export const negativeLabBatchSummaryAppServerCommandSchema = negativeLabFrameHealthAppServerCommandSchema;

export const negativeLabDensitometerAppServerCommandSchema = z
  .object({
    baseFogEstimate: negativeBaseFogEstimateSchema,
  })
  .strict();

export const negativeLabBatchSummaryRouteSchema = z
  .object({
    commandName: negativeLabBatchSummaryCommandNameSchema,
    inputSchemaName: z.literal('NegativeLabBatchSummaryAppServerCommandV1'),
    outputSchemaName: z.literal('NegativeLabBatchDryRunSummaryV1'),
    reason: z.string().trim().min(1),
    status: z.literal('mapped'),
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

export const negativeLabDensitometerRouteSchema = z
  .object({
    commandName: negativeLabDensitometerCommandNameSchema,
    inputSchemaName: z.literal('NegativeLabDensitometerAppServerCommandV1'),
    outputSchemaName: z.literal('NegativeBaseFogDensitometerReadoutV1'),
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
  negativeLabBatchSummaryRouteSchema,
  negativeLabConversionPlanRouteSchema,
  negativeLabDensitometerRouteSchema,
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
export const negativeLabBatchSummaryAppServerResultSchema = negativeLabBatchDryRunSummarySchema;
export const negativeLabDensitometerAppServerResultSchema = negativeBaseFogDensitometerReadoutSchema;

export type NegativeLabAppServerCommand = z.infer<typeof negativeLabAppServerCommandSchema>;
export type NegativeLabBatchSummaryAppServerCommand = z.infer<typeof negativeLabBatchSummaryAppServerCommandSchema>;
export type NegativeLabBatchSummaryAppServerResult = z.infer<typeof negativeLabBatchSummaryAppServerResultSchema>;
export type NegativeLabConversionPlanResult = z.infer<typeof negativeLabConversionPlanResultSchema>;
export type NegativeLabDensitometerAppServerCommand = z.infer<typeof negativeLabDensitometerAppServerCommandSchema>;
export type NegativeLabDensitometerAppServerResult = z.infer<typeof negativeLabDensitometerAppServerResultSchema>;
export type NegativeLabFrameHealthAppServerCommand = z.infer<typeof negativeLabFrameHealthAppServerCommandSchema>;
export type NegativeLabFrameHealthAppServerResult = z.infer<typeof negativeLabFrameHealthAppServerResultSchema>;
