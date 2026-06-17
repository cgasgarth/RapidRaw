import { z } from 'zod';

import {
  negativeLabBatchDryRunSummarySchema,
  negativeLabFrameHealthReportSchema,
} from './negativeLabFrameHealthSchemas';
import {
  negativeLabResolvedRuntimeProfileSchema,
  negativeLabRuntimePresetIdSchema,
} from './negativeLabMeasuredProfileSchemas';
import {
  negativeBaseFogDensitometerReadoutSchema,
  negativeBaseFogEstimateSchema,
  negativeLabBaseFogSampleRectSchema,
  negativeLabPresetParamsSchema,
} from './negativeLabPresetCatalogSchemas';
import { negativeLabStockMetadataCatalogSchema } from './negativeLabStockMetadataCatalogSchemas';
import {
  negativeLabStockRegistryEntrySchema,
  negativeLabStockRegistryIdSchema,
  negativeLabStockRegistrySchema,
} from './negativeLabStockRegistrySchemas';
import { negativeLabQcProofReportSchema } from './negativeLabWorkspaceSchemas';

export const negativeLabConversionPlanCommandNameSchema = z.literal('negative.lab.build_conversion_plan');
export const negativeLabAcceptedBatchApplyCommandNameSchema = z.literal('negative.lab.build_accepted_batch_apply');
export const negativeLabAcceptBatchPlanCommandNameSchema = z.literal('negative.lab.accept_batch_dry_run_plan');
export const negativeLabBatchSummaryCommandNameSchema = z.literal('negative.lab.build_batch_dry_run_summary');
export const negativeLabDensitometerCommandNameSchema = z.literal('negative.lab.build_densitometer_readout');
export const negativeLabFrameHealthCommandNameSchema = z.literal('negative.lab.build_frame_health_report');
export const negativeLabQcProofCommandNameSchema = z.literal('negative.lab.build_qc_proof_report');
export const negativeLabStockMetadataCommandNameSchema = z.literal('negative.lab.list_stock_metadata');
export const negativeLabStockRegistryCommandNameSchema = z.literal('negative.lab.list_stock_registry');
export const negativeLabStockFamilyConversionCommandNameSchema = z.literal(
  'negative.lab.build_stock_family_conversion_plan',
);
export const negativeLabAppServerCommandNameSchema = z.union([
  negativeLabAcceptBatchPlanCommandNameSchema,
  negativeLabAcceptedBatchApplyCommandNameSchema,
  negativeLabBatchSummaryCommandNameSchema,
  negativeLabConversionPlanCommandNameSchema,
  negativeLabDensitometerCommandNameSchema,
  negativeLabFrameHealthCommandNameSchema,
  negativeLabQcProofCommandNameSchema,
  negativeLabStockMetadataCommandNameSchema,
  negativeLabStockFamilyConversionCommandNameSchema,
  negativeLabStockRegistryCommandNameSchema,
]);
export const negativeLabAppServerOutputFormatSchema = z.enum(['jpeg_proof', 'tiff16']);
export const negativeLabAppServerScopeSchema = z.enum(['active', 'all']);
export const negativeLabProfileProvenanceHashSchema = z.string().regex(/^fnv1a32:[a-f0-9]{8}$/u);

export const negativeLabAppServerCommandSchema = z
  .object({
    outputFormat: negativeLabAppServerOutputFormatSchema,
    paths: z.array(z.string().trim().min(1)).min(1),
    presetId: negativeLabRuntimePresetIdSchema,
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
export const negativeLabAcceptBatchPlanAppServerCommandSchema = negativeLabFrameHealthAppServerCommandSchema;
export const negativeLabQcProofAppServerCommandSchema = negativeLabFrameHealthAppServerCommandSchema;
export const negativeLabAcceptedBatchApplyAppServerCommandSchema = z
  .object({
    acceptedPlan: z.lazy(() => negativeLabAcceptedBatchPlanSchema),
    conversion: negativeLabAppServerCommandSchema.extend({
      scope: z.literal('all'),
    }),
    dryRun: negativeLabAcceptBatchPlanAppServerCommandSchema,
  })
  .strict();

export const negativeLabDensitometerAppServerCommandSchema = z
  .object({
    baseFogEstimate: negativeBaseFogEstimateSchema,
  })
  .strict();
export const negativeLabStockRegistryAppServerCommandSchema = z.object({}).strict();
export const negativeLabStockMetadataAppServerCommandSchema = z.object({}).strict();
export const negativeLabStockFamilyConversionAppServerCommandSchema = negativeLabAppServerCommandSchema
  .omit({ presetId: true })
  .extend({
    stockFamilyRegistryId: negativeLabStockRegistryIdSchema,
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

export const negativeLabAcceptBatchPlanRouteSchema = z
  .object({
    commandName: negativeLabAcceptBatchPlanCommandNameSchema,
    inputSchemaName: z.literal('NegativeLabAcceptBatchPlanAppServerCommandV1'),
    outputSchemaName: z.literal('NegativeLabAcceptedBatchPlanV1'),
    reason: z.string().trim().min(1),
    status: z.literal('mapped'),
  })
  .strict();

export const negativeLabAcceptedBatchApplyRouteSchema = z
  .object({
    commandName: negativeLabAcceptedBatchApplyCommandNameSchema,
    inputSchemaName: z.literal('NegativeLabAcceptedBatchApplyAppServerCommandV1'),
    outputSchemaName: z.literal('NegativeLabAcceptedBatchApplyPlanV1'),
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
export const negativeLabQcProofRouteSchema = z
  .object({
    commandName: negativeLabQcProofCommandNameSchema,
    inputSchemaName: z.literal('NegativeLabQcProofAppServerCommandV1'),
    outputSchemaName: z.literal('NegativeLabQcProofReportV1'),
    reason: z.string().trim().min(1),
    status: z.literal('mapped'),
  })
  .strict();
export const negativeLabStockRegistryRouteSchema = z
  .object({
    commandName: negativeLabStockRegistryCommandNameSchema,
    inputSchemaName: z.literal('NegativeLabStockRegistryAppServerCommandV1'),
    outputSchemaName: z.literal('NegativeLabStockRegistryAppServerResultV1'),
    reason: z.string().trim().min(1),
    status: z.literal('mapped'),
  })
  .strict();
export const negativeLabStockMetadataRouteSchema = z
  .object({
    commandName: negativeLabStockMetadataCommandNameSchema,
    inputSchemaName: z.literal('NegativeLabStockMetadataAppServerCommandV1'),
    outputSchemaName: z.literal('NegativeLabStockMetadataAppServerResultV1'),
    reason: z.string().trim().min(1),
    status: z.literal('mapped'),
  })
  .strict();
export const negativeLabStockFamilyConversionRouteSchema = z
  .object({
    commandName: negativeLabStockFamilyConversionCommandNameSchema,
    inputSchemaName: z.literal('NegativeLabStockFamilyConversionAppServerCommandV1'),
    outputSchemaName: z.literal('NegativeLabStockFamilyConversionResultV1'),
    reason: z.string().trim().min(1),
    status: z.literal('mapped'),
  })
  .strict();

export const negativeLabAppServerRouteSchema = z.union([
  negativeLabAcceptBatchPlanRouteSchema,
  negativeLabAcceptedBatchApplyRouteSchema,
  negativeLabBatchSummaryRouteSchema,
  negativeLabConversionPlanRouteSchema,
  negativeLabDensitometerRouteSchema,
  negativeLabFrameHealthRouteSchema,
  negativeLabQcProofRouteSchema,
  negativeLabStockFamilyConversionRouteSchema,
  negativeLabStockMetadataRouteSchema,
  negativeLabStockRegistryRouteSchema,
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
    presetId: negativeLabRuntimePresetIdSchema,
    profile: negativeLabResolvedRuntimeProfileSchema,
    profileProvenanceHash: negativeLabProfileProvenanceHashSchema,
    proof: z
      .object({
        deterministic: z.literal(true),
        generatedFrom: z.literal('src/utils/negativeLabMeasuredProfileRuntime.ts'),
      })
      .strict(),
    sampleRect: negativeLabBaseFogSampleRectSchema.nullable(),
    scope: negativeLabAppServerScopeSchema,
    suffix: z.string().trim().min(1).max(40),
  })
  .strict();

export const negativeLabAcceptedBatchPlanSchema = z
  .object({
    acceptedDryRunPlanHash: z.string().regex(/^fnv1a32:[a-f0-9]{8}$/u),
    acceptedDryRunPlanId: z.string().regex(/^negative_lab_batch_plan_[a-f0-9]{8}$/u),
    commandName: negativeLabAcceptBatchPlanCommandNameSchema,
    dryRunSummary: negativeLabBatchDryRunSummarySchema,
    proof: z
      .object({
        deterministic: z.literal(true),
        generatedFrom: z.literal('src/utils/negativeLabFrameHealth.ts'),
      })
      .strict(),
  })
  .strict()
  .superRefine((plan, context) => {
    if (plan.dryRunSummary.blocked) {
      context.addIssue({ code: 'custom', message: 'Blocked Negative Lab dry-runs cannot be accepted.' });
    }
  });

export const negativeLabAcceptedBatchApplyPlanSchema = z
  .object({
    acceptedDryRunPlanHash: z.string().regex(/^fnv1a32:[a-f0-9]{8}$/u),
    acceptedDryRunPlanId: z.string().regex(/^negative_lab_batch_plan_[a-f0-9]{8}$/u),
    apply: z
      .object({
        options: z
          .object({
            acceptedDryRunPlanHash: z.string().regex(/^fnv1a32:[a-f0-9]{8}$/u),
            acceptedDryRunPlanId: z.string().regex(/^negative_lab_batch_plan_[a-f0-9]{8}$/u),
            outputFormat: negativeLabAppServerOutputFormatSchema,
            profileProvenanceHash: negativeLabProfileProvenanceHashSchema,
            suffix: z.string().trim().min(1).max(40),
          })
          .strict(),
        params: negativeLabPresetParamsSchema,
        paths: z.array(z.string().trim().min(1)).min(1),
      })
      .strict(),
    commandName: negativeLabAcceptedBatchApplyCommandNameSchema,
    conversionPlan: negativeLabConversionPlanResultSchema,
    dryRunSummary: negativeLabBatchDryRunSummarySchema,
    proof: z
      .object({
        dryRunRequired: z.literal(true),
        generatedFrom: z.literal('src/utils/negativeLabAppServerRoutes.ts'),
        identityMatched: z.literal(true),
      })
      .strict(),
  })
  .strict()
  .superRefine((plan, context) => {
    if (plan.acceptedDryRunPlanHash !== plan.apply.options.acceptedDryRunPlanHash) {
      context.addIssue({ code: 'custom', message: 'Apply options must preserve accepted dry-run hash.' });
    }

    if (plan.acceptedDryRunPlanId !== plan.apply.options.acceptedDryRunPlanId) {
      context.addIssue({ code: 'custom', message: 'Apply options must preserve accepted dry-run id.' });
    }
  });

export const negativeLabFrameHealthAppServerResultSchema = negativeLabFrameHealthReportSchema;
export const negativeLabQcProofAppServerResultSchema = negativeLabQcProofReportSchema;
export const negativeLabAcceptedBatchApplyAppServerResultSchema = negativeLabAcceptedBatchApplyPlanSchema;
export const negativeLabAcceptBatchPlanAppServerResultSchema = negativeLabAcceptedBatchPlanSchema;
export const negativeLabBatchSummaryAppServerResultSchema = negativeLabBatchDryRunSummarySchema;
export const negativeLabDensitometerAppServerResultSchema = negativeBaseFogDensitometerReadoutSchema;
export const negativeLabStockRegistryAppServerResultSchema = z
  .object({
    commandName: negativeLabStockRegistryCommandNameSchema,
    counts: z
      .object({
        referenceOnlyCount: z.number().int().nonnegative(),
        runtimeSafeCount: z.number().int().nonnegative(),
        totalCount: z.number().int().positive(),
      })
      .strict(),
    proof: z
      .object({
        deterministic: z.literal(true),
        generatedFrom: z.literal('src/utils/negativeLabStockRegistry.ts'),
        namedStockClaimsRuntimeGated: z.literal(true),
      })
      .strict(),
    registry: negativeLabStockRegistrySchema,
  })
  .strict()
  .superRefine((result, context) => {
    if (result.counts.totalCount !== result.registry.entries.length) {
      context.addIssue({ code: 'custom', message: 'Stock registry count must match registry entries.' });
    }
  });
export const negativeLabStockMetadataAppServerResultSchema = z
  .object({
    catalog: negativeLabStockMetadataCatalogSchema,
    commandName: negativeLabStockMetadataCommandNameSchema,
    counts: z
      .object({
        blackAndWhiteNegativeCount: z.number().int().nonnegative(),
        cinemaNegativeCount: z.number().int().nonnegative(),
        colorNegativeCount: z.number().int().nonnegative(),
        slideReversalCount: z.number().int().nonnegative(),
        totalCount: z.number().int().positive(),
      })
      .strict(),
    proof: z
      .object({
        deterministic: z.literal(true),
        generatedFrom: z.literal('src/utils/negativeLabStockMetadataCatalog.ts'),
        metadataOnlyNotRuntimeApplied: z.literal(true),
        namedStockClaimsRuntimeGated: z.literal(true),
      })
      .strict(),
  })
  .strict()
  .superRefine((result, context) => {
    if (result.counts.totalCount !== result.catalog.entries.length) {
      context.addIssue({ code: 'custom', message: 'Stock metadata count must match catalog entries.' });
    }
  });
export const negativeLabStockFamilyConversionResultSchema = z
  .object({
    commandName: negativeLabStockFamilyConversionCommandNameSchema,
    conversionPlan: negativeLabConversionPlanResultSchema,
    proof: z
      .object({
        deterministic: z.literal(true),
        generatedFrom: z.literal('src/utils/negativeLabAppServerRoutes.ts'),
        registryMappedPreset: z.literal(true),
      })
      .strict(),
    stockFamily: negativeLabStockRegistryEntrySchema,
  })
  .strict()
  .superRefine((result, context) => {
    if (result.stockFamily.genericPresetId === null) {
      context.addIssue({ code: 'custom', message: 'Stock-family conversion requires a runtime-safe generic preset.' });
      return;
    }

    if (result.conversionPlan.presetId !== result.stockFamily.genericPresetId) {
      context.addIssue({
        code: 'custom',
        message: 'Stock-family conversion plan must use the registry mapped generic preset.',
      });
    }
  });

export type NegativeLabAppServerCommand = z.infer<typeof negativeLabAppServerCommandSchema>;
export type NegativeLabAcceptBatchPlanAppServerCommand = z.infer<
  typeof negativeLabAcceptBatchPlanAppServerCommandSchema
>;
export type NegativeLabAcceptBatchPlanAppServerResult = z.infer<typeof negativeLabAcceptBatchPlanAppServerResultSchema>;
export type NegativeLabAcceptedBatchApplyAppServerCommand = z.infer<
  typeof negativeLabAcceptedBatchApplyAppServerCommandSchema
>;
export type NegativeLabAcceptedBatchApplyAppServerResult = z.infer<
  typeof negativeLabAcceptedBatchApplyAppServerResultSchema
>;
export type NegativeLabBatchSummaryAppServerCommand = z.infer<typeof negativeLabBatchSummaryAppServerCommandSchema>;
export type NegativeLabBatchSummaryAppServerResult = z.infer<typeof negativeLabBatchSummaryAppServerResultSchema>;
export type NegativeLabConversionPlanResult = z.infer<typeof negativeLabConversionPlanResultSchema>;
export type NegativeLabDensitometerAppServerCommand = z.infer<typeof negativeLabDensitometerAppServerCommandSchema>;
export type NegativeLabDensitometerAppServerResult = z.infer<typeof negativeLabDensitometerAppServerResultSchema>;
export type NegativeLabFrameHealthAppServerCommand = z.infer<typeof negativeLabFrameHealthAppServerCommandSchema>;
export type NegativeLabFrameHealthAppServerResult = z.infer<typeof negativeLabFrameHealthAppServerResultSchema>;
export type NegativeLabQcProofAppServerCommand = z.infer<typeof negativeLabQcProofAppServerCommandSchema>;
export type NegativeLabQcProofAppServerResult = z.infer<typeof negativeLabQcProofAppServerResultSchema>;
export type NegativeLabProfileProvenanceHash = z.infer<typeof negativeLabProfileProvenanceHashSchema>;
export type NegativeLabStockMetadataAppServerCommand = z.infer<typeof negativeLabStockMetadataAppServerCommandSchema>;
export type NegativeLabStockMetadataAppServerResult = z.infer<typeof negativeLabStockMetadataAppServerResultSchema>;
export type NegativeLabStockRegistryAppServerCommand = z.infer<typeof negativeLabStockRegistryAppServerCommandSchema>;
export type NegativeLabStockRegistryAppServerResult = z.infer<typeof negativeLabStockRegistryAppServerResultSchema>;
export type NegativeLabStockFamilyConversionAppServerCommand = z.infer<
  typeof negativeLabStockFamilyConversionAppServerCommandSchema
>;
export type NegativeLabStockFamilyConversionResult = z.infer<typeof negativeLabStockFamilyConversionResultSchema>;
