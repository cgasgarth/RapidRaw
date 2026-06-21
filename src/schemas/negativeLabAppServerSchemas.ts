import { z } from 'zod';

import {
  negativeLabBatchDryRunSummarySchema,
  negativeLabFrameHealthReportSchema,
} from './negativeLabFrameHealthSchemas';
import {
  negativeLabMeasuredProfileIdSchema,
  negativeLabMeasuredProfileRuntimeLimitationSchema,
  negativeLabMeasuredProfileRuntimeStatusSchema,
  negativeLabResolvedRuntimeProfileSchema,
  negativeLabRuntimePresetIdSchema,
  negativeLabUserProfileIdSchema,
} from './negativeLabMeasuredProfileSchemas';
import {
  negativeBaseFogDensitometerReadoutSchema,
  negativeBaseFogEstimateSchema,
  negativeLabBaseFogSampleRectSchema,
  negativeLabPresetIdSchema,
  negativeLabPresetParamsSchema,
} from './negativeLabPresetCatalogSchemas';
import { negativeLabStockMetadataCatalogSchema } from './negativeLabStockMetadataCatalogSchemas';
import {
  negativeLabStockRegistryEntrySchema,
  negativeLabStockRegistryIdSchema,
  negativeLabStockRegistrySchema,
} from './negativeLabStockRegistrySchemas';
import { negativeLabQcProofReportSchema } from './negativeLabWorkspaceSchemas';
import { NegativeLabAppServerCommandName } from '../utils/negativeLabAppServerCommandNames';
import { NEGATIVE_LAB_DENSITY_ALGORITHM_ID } from '../utils/negativeLabDensityConversion';
import { NEGATIVE_LAB_OUTPUT_FORMAT_IDS } from '../utils/negativeLabOutputFormatIds';

export const negativeLabConversionPlanCommandNameSchema = z.literal(NegativeLabAppServerCommandName.ConversionPlan);
export const negativeLabAcceptedBatchApplyCommandNameSchema = z.literal(
  NegativeLabAppServerCommandName.AcceptedBatchApply,
);
export const negativeLabAcceptBatchPlanCommandNameSchema = z.literal(NegativeLabAppServerCommandName.AcceptBatchPlan);
export const negativeLabBatchSummaryCommandNameSchema = z.literal(NegativeLabAppServerCommandName.BatchSummary);
export const negativeLabDensitometerCommandNameSchema = z.literal(NegativeLabAppServerCommandName.Densitometer);
export const negativeLabFrameHealthCommandNameSchema = z.literal(NegativeLabAppServerCommandName.FrameHealth);
export const negativeLabQcProofCommandNameSchema = z.literal(NegativeLabAppServerCommandName.QcProof);
export const negativeLabStockMetadataCommandNameSchema = z.literal(NegativeLabAppServerCommandName.StockMetadata);
export const negativeLabStockRegistryCommandNameSchema = z.literal(NegativeLabAppServerCommandName.StockRegistry);
export const negativeLabStockFamilyConversionCommandNameSchema = z.literal(
  NegativeLabAppServerCommandName.StockFamilyConversion,
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
export const negativeLabAppServerOutputFormatSchema = z.enum(NEGATIVE_LAB_OUTPUT_FORMAT_IDS);
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

export const negativeLabSelectedProfileSnapshotAppServerSchema = z
  .object({
    claimLevel: z.enum(['generic_starting_point_only', 'measured_profile', 'user_profile']),
    claimPolicy: z.enum([
      'generic_starting_point_no_stock_claim',
      'measured_profile_required_before_stock_claim',
      'process_family_profile_no_stock_claim',
      'named_stock_profile_requires_license_review',
      'user_profile_no_stock_claim',
    ]),
    displayName: z.string().trim().min(1).max(80),
    doesNotProve: z.array(negativeLabMeasuredProfileRuntimeLimitationSchema),
    evidenceFixtureCount: z.number().int().nonnegative(),
    measurementProfileId: negativeLabMeasuredProfileIdSchema.or(negativeLabUserProfileIdSchema).nullable(),
    params: negativeLabPresetParamsSchema,
    presetId: negativeLabRuntimePresetIdSchema,
    profileProvenanceHash: negativeLabProfileProvenanceHashSchema,
    profileStatus: z.enum(['generic_unmeasured', 'fixture_measured', 'user_supplied']),
    provenanceSummary: z.string().trim().min(1).max(220),
    runtimeStatus: negativeLabMeasuredProfileRuntimeStatusSchema,
    sourceGenericPresetId: negativeLabPresetIdSchema.nullable(),
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
export const negativeLabAcceptBatchPlanAppServerCommandSchema = negativeLabFrameHealthAppServerCommandSchema
  .extend({
    presetId: negativeLabRuntimePresetIdSchema,
  })
  .strict();
export const negativeLabQcProofAppServerCommandSchema = negativeLabFrameHealthAppServerCommandSchema;
export const negativeLabAcceptedBatchApplyAppServerCommandSchema = z
  .object({
    acceptedPlan: z.lazy(() => negativeLabAcceptedBatchPlanSchema),
    conversion: negativeLabAppServerCommandSchema.extend({
      scope: z.literal('all'),
    }),
    dryRun: negativeLabAcceptBatchPlanAppServerCommandSchema,
    selectedProfileSnapshot: negativeLabSelectedProfileSnapshotAppServerSchema.optional(),
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

interface NegativeLabRouteDescriptor {
  commandName: z.infer<typeof negativeLabAppServerCommandNameSchema>;
  inputSchemaName: string;
  outputSchemaName: string;
  reason: string;
}

export const negativeLabAcceptedBatchApplyRouteDescriptor = {
  commandName: NegativeLabAppServerCommandName.AcceptedBatchApply,
  inputSchemaName: 'NegativeLabAcceptedBatchApplyAppServerCommandV1',
  outputSchemaName: 'NegativeLabAcceptedBatchApplyPlanV1',
  reason: 'Negative Lab app-server apply calls must replay an accepted dry-run plan identity.',
} as const satisfies NegativeLabRouteDescriptor;
export const negativeLabAcceptBatchPlanRouteDescriptor = {
  commandName: NegativeLabAppServerCommandName.AcceptBatchPlan,
  inputSchemaName: 'NegativeLabAcceptBatchPlanAppServerCommandV1',
  outputSchemaName: 'NegativeLabAcceptedBatchPlanV1',
  reason: 'Negative Lab app-server calls require an accepted non-destructive batch plan before apply.',
} as const satisfies NegativeLabRouteDescriptor;
export const negativeLabBatchSummaryRouteDescriptor = {
  commandName: NegativeLabAppServerCommandName.BatchSummary,
  inputSchemaName: 'NegativeLabBatchSummaryAppServerCommandV1',
  outputSchemaName: 'NegativeLabBatchDryRunSummaryV1',
  reason: 'Negative Lab app-server calls expose the same non-destructive batch apply/skip plan used by UI.',
} as const satisfies NegativeLabRouteDescriptor;
export const negativeLabConversionPlanRouteDescriptor = {
  commandName: NegativeLabAppServerCommandName.ConversionPlan,
  inputSchemaName: 'NegativeLabAppServerCommandV1',
  outputSchemaName: 'NegativeLabConversionPlanResultV1',
  reason: 'Negative Lab app-server calls share the UI built-in preset catalog and deterministic conversion plan shape.',
} as const satisfies NegativeLabRouteDescriptor;
export const negativeLabDensitometerRouteDescriptor = {
  commandName: NegativeLabAppServerCommandName.Densitometer,
  inputSchemaName: 'NegativeLabDensitometerAppServerCommandV1',
  outputSchemaName: 'NegativeBaseFogDensitometerReadoutV1',
  reason: 'Negative Lab app-server calls expose the same base/fog densitometer math used by UI.',
} as const satisfies NegativeLabRouteDescriptor;
export const negativeLabFrameHealthRouteDescriptor = {
  commandName: NegativeLabAppServerCommandName.FrameHealth,
  inputSchemaName: 'NegativeLabFrameHealthAppServerCommandV1',
  outputSchemaName: 'NegativeLabFrameHealthReportV1',
  reason: 'Negative Lab app-server calls expose the same roll frame health report used by the workspace UI.',
} as const satisfies NegativeLabRouteDescriptor;
export const negativeLabQcProofRouteDescriptor = {
  commandName: NegativeLabAppServerCommandName.QcProof,
  inputSchemaName: 'NegativeLabQcProofAppServerCommandV1',
  outputSchemaName: 'NegativeLabQcProofReportV1',
  reason: 'Negative Lab app-server calls expose the same contact-sheet QC proof summary used by the workspace UI.',
} as const satisfies NegativeLabRouteDescriptor;
export const negativeLabStockFamilyConversionRouteDescriptor = {
  commandName: NegativeLabAppServerCommandName.StockFamilyConversion,
  inputSchemaName: 'NegativeLabStockFamilyConversionAppServerCommandV1',
  outputSchemaName: 'NegativeLabStockFamilyConversionResultV1',
  reason: 'Negative Lab app-server calls can build conversion plans from governed stock-family registry ids.',
} as const satisfies NegativeLabRouteDescriptor;
export const negativeLabStockMetadataRouteDescriptor = {
  commandName: NegativeLabAppServerCommandName.StockMetadata,
  inputSchemaName: 'NegativeLabStockMetadataAppServerCommandV1',
  outputSchemaName: 'NegativeLabStockMetadataAppServerResultV1',
  reason: 'Negative Lab app-server calls expose named stock metadata without routing it through apply/export.',
} as const satisfies NegativeLabRouteDescriptor;
export const negativeLabStockRegistryRouteDescriptor = {
  commandName: NegativeLabAppServerCommandName.StockRegistry,
  inputSchemaName: 'NegativeLabStockRegistryAppServerCommandV1',
  outputSchemaName: 'NegativeLabStockRegistryAppServerResultV1',
  reason: 'Negative Lab app-server calls expose the governed stock-family registry used by preset workflows.',
} as const satisfies NegativeLabRouteDescriptor;

export const negativeLabRouteDescriptors = [
  negativeLabAcceptedBatchApplyRouteDescriptor,
  negativeLabAcceptBatchPlanRouteDescriptor,
  negativeLabBatchSummaryRouteDescriptor,
  negativeLabConversionPlanRouteDescriptor,
  negativeLabDensitometerRouteDescriptor,
  negativeLabFrameHealthRouteDescriptor,
  negativeLabQcProofRouteDescriptor,
  negativeLabStockFamilyConversionRouteDescriptor,
  negativeLabStockMetadataRouteDescriptor,
  negativeLabStockRegistryRouteDescriptor,
] as const;

const buildNegativeLabRouteSchema = (descriptor: (typeof negativeLabRouteDescriptors)[number]) =>
  z
    .object({
      commandName: z.literal(descriptor.commandName),
      inputSchemaName: z.literal(descriptor.inputSchemaName),
      outputSchemaName: z.literal(descriptor.outputSchemaName),
      reason: z.string().trim().min(1),
      status: z.literal('mapped'),
    })
    .strict();

export const negativeLabBatchSummaryRouteSchema = buildNegativeLabRouteSchema(negativeLabBatchSummaryRouteDescriptor);
export const negativeLabAcceptBatchPlanRouteSchema = buildNegativeLabRouteSchema(
  negativeLabAcceptBatchPlanRouteDescriptor,
);
export const negativeLabAcceptedBatchApplyRouteSchema = buildNegativeLabRouteSchema(
  negativeLabAcceptedBatchApplyRouteDescriptor,
);
export const negativeLabConversionPlanRouteSchema = buildNegativeLabRouteSchema(
  negativeLabConversionPlanRouteDescriptor,
);
export const negativeLabDensitometerRouteSchema = buildNegativeLabRouteSchema(negativeLabDensitometerRouteDescriptor);
export const negativeLabFrameHealthRouteSchema = buildNegativeLabRouteSchema(negativeLabFrameHealthRouteDescriptor);
export const negativeLabQcProofRouteSchema = buildNegativeLabRouteSchema(negativeLabQcProofRouteDescriptor);
export const negativeLabStockRegistryRouteSchema = buildNegativeLabRouteSchema(negativeLabStockRegistryRouteDescriptor);
export const negativeLabStockMetadataRouteSchema = buildNegativeLabRouteSchema(negativeLabStockMetadataRouteDescriptor);
export const negativeLabStockFamilyConversionRouteSchema = buildNegativeLabRouteSchema(
  negativeLabStockFamilyConversionRouteDescriptor,
);

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
        densityAlgorithm: z.literal(NEGATIVE_LAB_DENSITY_ALGORITHM_ID),
        deterministic: z.literal(true),
        generatedFrom: z.literal('src/utils/negativeLabMeasuredProfileRuntime.ts'),
        runtimeConversionHelper: z.literal('src/utils/negativeLabDensityConversion.ts'),
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
        generatedFrom: z.literal('src/utils/negativeLabAppServerRoutes.ts'),
        selectedProfileBound: z.literal(true),
      })
      .strict(),
    selectedProfileSnapshot: negativeLabSelectedProfileSnapshotAppServerSchema,
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
            selectedProfile: negativeLabSelectedProfileSnapshotAppServerSchema,
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
        selectedProfileBound: z.literal(true),
      })
      .strict(),
    selectedProfileSnapshot: negativeLabSelectedProfileSnapshotAppServerSchema,
  })
  .strict()
  .superRefine((plan, context) => {
    if (plan.acceptedDryRunPlanHash !== plan.apply.options.acceptedDryRunPlanHash) {
      context.addIssue({ code: 'custom', message: 'Apply options must preserve accepted dry-run hash.' });
    }

    if (plan.acceptedDryRunPlanId !== plan.apply.options.acceptedDryRunPlanId) {
      context.addIssue({ code: 'custom', message: 'Apply options must preserve accepted dry-run id.' });
    }

    if (plan.apply.options.profileProvenanceHash !== plan.conversionPlan.profileProvenanceHash) {
      context.addIssue({ code: 'custom', message: 'Apply options must preserve selected profile provenance hash.' });
    }

    if (JSON.stringify(plan.apply.options.selectedProfile) !== JSON.stringify(plan.selectedProfileSnapshot)) {
      context.addIssue({ code: 'custom', message: 'Apply options must preserve selected profile snapshot.' });
    }

    if (plan.selectedProfileSnapshot.presetId !== plan.conversionPlan.presetId) {
      context.addIssue({ code: 'custom', message: 'Selected profile snapshot must match conversion preset.' });
    }

    if (plan.selectedProfileSnapshot.profileProvenanceHash !== plan.conversionPlan.profileProvenanceHash) {
      context.addIssue({
        code: 'custom',
        message: 'Selected profile snapshot must match conversion profile provenance hash.',
      });
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
export type NegativeLabSelectedProfileSnapshotAppServer = z.infer<
  typeof negativeLabSelectedProfileSnapshotAppServerSchema
>;
export type NegativeLabStockMetadataAppServerCommand = z.infer<typeof negativeLabStockMetadataAppServerCommandSchema>;
export type NegativeLabStockMetadataAppServerResult = z.infer<typeof negativeLabStockMetadataAppServerResultSchema>;
export type NegativeLabStockRegistryAppServerCommand = z.infer<typeof negativeLabStockRegistryAppServerCommandSchema>;
export type NegativeLabStockRegistryAppServerResult = z.infer<typeof negativeLabStockRegistryAppServerResultSchema>;
export type NegativeLabStockFamilyConversionAppServerCommand = z.infer<
  typeof negativeLabStockFamilyConversionAppServerCommandSchema
>;
export type NegativeLabStockFamilyConversionResult = z.infer<typeof negativeLabStockFamilyConversionResultSchema>;
