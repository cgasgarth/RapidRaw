import { buildNegativeBaseFogDensitometerReadout } from './negativeLabDensitometer';
import { buildNegativeLabBatchDryRunSummary, buildNegativeLabFrameHealthReport } from './negativeLabFrameHealth';
import {
  NEGATIVE_LAB_RUNTIME_PROFILE_CATALOG,
  buildNegativeLabRuntimeProfileProvenanceHash,
  type NegativeLabRuntimeProfileCatalog,
  resolveNegativeLabRuntimeProfile,
} from './negativeLabMeasuredProfileRuntime';
import { buildNegativeLabAcceptedPlanIdentity } from './negativeLabPlanIdentity';
import { NEGATIVE_LAB_STOCK_REGISTRY, buildNegativeLabStockRegistryCounts } from './negativeLabStockRegistry';
import {
  negativeLabAppServerCommandSchema,
  negativeLabAppServerRouteManifestSchema,
  negativeLabAcceptedBatchApplyAppServerCommandSchema,
  negativeLabAcceptedBatchApplyAppServerResultSchema,
  negativeLabAcceptBatchPlanAppServerCommandSchema,
  negativeLabAcceptBatchPlanAppServerResultSchema,
  negativeLabBatchSummaryAppServerCommandSchema,
  negativeLabBatchSummaryAppServerResultSchema,
  negativeLabConversionPlanResultSchema,
  negativeLabDensitometerAppServerCommandSchema,
  negativeLabDensitometerAppServerResultSchema,
  negativeLabFrameHealthAppServerCommandSchema,
  negativeLabFrameHealthAppServerResultSchema,
  negativeLabStockFamilyConversionAppServerCommandSchema,
  negativeLabStockFamilyConversionResultSchema,
  negativeLabStockRegistryAppServerCommandSchema,
  negativeLabStockRegistryAppServerResultSchema,
  type NegativeLabAppServerCommand,
  type NegativeLabAcceptedBatchApplyAppServerCommand,
  type NegativeLabAcceptedBatchApplyAppServerResult,
  type NegativeLabAcceptBatchPlanAppServerCommand,
  type NegativeLabAcceptBatchPlanAppServerResult,
  type NegativeLabBatchSummaryAppServerCommand,
  type NegativeLabBatchSummaryAppServerResult,
  type NegativeLabConversionPlanResult,
  type NegativeLabDensitometerAppServerCommand,
  type NegativeLabDensitometerAppServerResult,
  type NegativeLabFrameHealthAppServerCommand,
  type NegativeLabFrameHealthAppServerResult,
  type NegativeLabStockFamilyConversionAppServerCommand,
  type NegativeLabStockFamilyConversionResult,
  type NegativeLabStockRegistryAppServerCommand,
  type NegativeLabStockRegistryAppServerResult,
} from '../schemas/negativeLabAppServerSchemas';

export const NEGATIVE_LAB_APP_SERVER_ROUTE_MANIFEST = negativeLabAppServerRouteManifestSchema.parse({
  routes: [
    {
      commandName: 'negative.lab.build_accepted_batch_apply',
      inputSchemaName: 'NegativeLabAcceptedBatchApplyAppServerCommandV1',
      outputSchemaName: 'NegativeLabAcceptedBatchApplyPlanV1',
      reason: 'Negative Lab app-server apply calls must replay an accepted dry-run plan identity.',
      status: 'mapped',
    },
    {
      commandName: 'negative.lab.accept_batch_dry_run_plan',
      inputSchemaName: 'NegativeLabAcceptBatchPlanAppServerCommandV1',
      outputSchemaName: 'NegativeLabAcceptedBatchPlanV1',
      reason: 'Negative Lab app-server calls require an accepted non-destructive batch plan before apply.',
      status: 'mapped',
    },
    {
      commandName: 'negative.lab.build_batch_dry_run_summary',
      inputSchemaName: 'NegativeLabBatchSummaryAppServerCommandV1',
      outputSchemaName: 'NegativeLabBatchDryRunSummaryV1',
      reason: 'Negative Lab app-server calls expose the same non-destructive batch apply/skip plan used by UI.',
      status: 'mapped',
    },
    {
      commandName: 'negative.lab.build_conversion_plan',
      inputSchemaName: 'NegativeLabAppServerCommandV1',
      outputSchemaName: 'NegativeLabConversionPlanResultV1',
      reason:
        'Negative Lab app-server calls share the UI built-in preset catalog and deterministic conversion plan shape.',
      status: 'mapped',
    },
    {
      commandName: 'negative.lab.build_densitometer_readout',
      inputSchemaName: 'NegativeLabDensitometerAppServerCommandV1',
      outputSchemaName: 'NegativeBaseFogDensitometerReadoutV1',
      reason: 'Negative Lab app-server calls expose the same base/fog densitometer math used by UI.',
      status: 'mapped',
    },
    {
      commandName: 'negative.lab.build_frame_health_report',
      inputSchemaName: 'NegativeLabFrameHealthAppServerCommandV1',
      outputSchemaName: 'NegativeLabFrameHealthReportV1',
      reason: 'Negative Lab app-server calls expose the same roll frame health report used by the workspace UI.',
      status: 'mapped',
    },
    {
      commandName: 'negative.lab.build_stock_family_conversion_plan',
      inputSchemaName: 'NegativeLabStockFamilyConversionAppServerCommandV1',
      outputSchemaName: 'NegativeLabStockFamilyConversionResultV1',
      reason: 'Negative Lab app-server calls can build conversion plans from governed stock-family registry ids.',
      status: 'mapped',
    },
    {
      commandName: 'negative.lab.list_stock_registry',
      inputSchemaName: 'NegativeLabStockRegistryAppServerCommandV1',
      outputSchemaName: 'NegativeLabStockRegistryAppServerResultV1',
      reason: 'Negative Lab app-server calls expose the governed stock-family registry used by preset workflows.',
      status: 'mapped',
    },
  ],
  schemaVersion: 1,
});

export const buildNegativeLabConversionPlanResult = (
  command: NegativeLabAppServerCommand,
  runtimeCatalog: NegativeLabRuntimeProfileCatalog = NEGATIVE_LAB_RUNTIME_PROFILE_CATALOG,
): NegativeLabConversionPlanResult => {
  const parsedCommand = negativeLabAppServerCommandSchema.parse(command);
  const profile = resolveNegativeLabRuntimeProfile(parsedCommand.presetId, runtimeCatalog);
  const profileProvenanceHash = buildNegativeLabRuntimeProfileProvenanceHash(profile);

  return negativeLabConversionPlanResultSchema.parse({
    commandName: 'negative.lab.build_conversion_plan',
    outputFormat: parsedCommand.outputFormat,
    params: {
      ...profile.params,
      base_fog_sample: parsedCommand.sampleRect,
    },
    paths: parsedCommand.paths,
    presetId: profile.presetId,
    profile,
    profileProvenanceHash,
    proof: {
      deterministic: true,
      generatedFrom: 'src/utils/negativeLabMeasuredProfileRuntime.ts',
    },
    sampleRect: parsedCommand.sampleRect,
    scope: parsedCommand.scope,
    suffix: parsedCommand.suffix,
  });
};

export const buildNegativeLabFrameHealthRouteResult = (
  command: NegativeLabFrameHealthAppServerCommand,
): NegativeLabFrameHealthAppServerResult => {
  const parsedCommand = negativeLabFrameHealthAppServerCommandSchema.parse(command);
  const includedPathSet = new Set(parsedCommand.includedPaths);

  return negativeLabFrameHealthAppServerResultSchema.parse(
    buildNegativeLabFrameHealthReport({
      activePathIndex: parsedCommand.activePathIndex,
      baseFogConfidence: parsedCommand.baseFogConfidence,
      includedPathSet,
      previewReady: parsedCommand.previewReady,
      targetPaths: parsedCommand.targetPaths,
    }),
  );
};

export const buildNegativeLabBatchSummaryRouteResult = (
  command: NegativeLabBatchSummaryAppServerCommand,
): NegativeLabBatchSummaryAppServerResult => {
  const parsedCommand = negativeLabBatchSummaryAppServerCommandSchema.parse(command);
  const frameHealthReport = buildNegativeLabFrameHealthRouteResult(parsedCommand);

  return negativeLabBatchSummaryAppServerResultSchema.parse(buildNegativeLabBatchDryRunSummary(frameHealthReport));
};

export const buildNegativeLabAcceptedBatchPlanRouteResult = (
  command: NegativeLabAcceptBatchPlanAppServerCommand,
): NegativeLabAcceptBatchPlanAppServerResult => {
  const parsedCommand = negativeLabAcceptBatchPlanAppServerCommandSchema.parse(command);
  const dryRunSummary = buildNegativeLabBatchSummaryRouteResult(parsedCommand);
  const planIdentity = buildNegativeLabAcceptedPlanIdentity(JSON.stringify(dryRunSummary));

  return negativeLabAcceptBatchPlanAppServerResultSchema.parse({
    ...planIdentity,
    commandName: 'negative.lab.accept_batch_dry_run_plan',
    dryRunSummary,
    proof: {
      deterministic: true,
      generatedFrom: 'src/utils/negativeLabFrameHealth.ts',
    },
  });
};

export const buildNegativeLabAcceptedBatchApplyRouteResult = (
  command: NegativeLabAcceptedBatchApplyAppServerCommand,
  runtimeCatalog: NegativeLabRuntimeProfileCatalog = NEGATIVE_LAB_RUNTIME_PROFILE_CATALOG,
): NegativeLabAcceptedBatchApplyAppServerResult => {
  const parsedCommand = negativeLabAcceptedBatchApplyAppServerCommandSchema.parse(command);
  const expectedAcceptedPlan = buildNegativeLabAcceptedBatchPlanRouteResult(parsedCommand.dryRun);
  const expectedSummaryJson = JSON.stringify(expectedAcceptedPlan.dryRunSummary);
  const acceptedSummaryJson = JSON.stringify(parsedCommand.acceptedPlan.dryRunSummary);

  if (
    parsedCommand.acceptedPlan.acceptedDryRunPlanHash !== expectedAcceptedPlan.acceptedDryRunPlanHash ||
    parsedCommand.acceptedPlan.acceptedDryRunPlanId !== expectedAcceptedPlan.acceptedDryRunPlanId ||
    acceptedSummaryJson !== expectedSummaryJson
  ) {
    throw new Error('Accepted Negative Lab apply plan does not match the dry-run summary.');
  }

  const plannedPaths = expectedAcceptedPlan.dryRunSummary.frameHealthReport.frames
    .filter((frame) => expectedAcceptedPlan.dryRunSummary.affectedFrameIds.includes(frame.frameId))
    .map((frame) => frame.sourcePath);
  const conversionPlan = buildNegativeLabConversionPlanResult(
    {
      ...parsedCommand.conversion,
      paths: plannedPaths,
    },
    runtimeCatalog,
  );

  return negativeLabAcceptedBatchApplyAppServerResultSchema.parse({
    acceptedDryRunPlanHash: expectedAcceptedPlan.acceptedDryRunPlanHash,
    acceptedDryRunPlanId: expectedAcceptedPlan.acceptedDryRunPlanId,
    apply: {
      options: {
        acceptedDryRunPlanHash: expectedAcceptedPlan.acceptedDryRunPlanHash,
        acceptedDryRunPlanId: expectedAcceptedPlan.acceptedDryRunPlanId,
        outputFormat: parsedCommand.conversion.outputFormat,
        profileProvenanceHash: conversionPlan.profileProvenanceHash,
        suffix: parsedCommand.conversion.suffix,
      },
      params: conversionPlan.params,
      paths: plannedPaths,
    },
    commandName: 'negative.lab.build_accepted_batch_apply',
    conversionPlan,
    dryRunSummary: expectedAcceptedPlan.dryRunSummary,
    proof: {
      dryRunRequired: true,
      generatedFrom: 'src/utils/negativeLabAppServerRoutes.ts',
      identityMatched: true,
    },
  });
};

export const buildNegativeLabDensitometerRouteResult = (
  command: NegativeLabDensitometerAppServerCommand,
): NegativeLabDensitometerAppServerResult => {
  const parsedCommand = negativeLabDensitometerAppServerCommandSchema.parse(command);

  return negativeLabDensitometerAppServerResultSchema.parse(
    buildNegativeBaseFogDensitometerReadout(parsedCommand.baseFogEstimate),
  );
};

export const buildNegativeLabStockRegistryRouteResult = (
  command: NegativeLabStockRegistryAppServerCommand,
): NegativeLabStockRegistryAppServerResult => {
  negativeLabStockRegistryAppServerCommandSchema.parse(command);

  return negativeLabStockRegistryAppServerResultSchema.parse({
    commandName: 'negative.lab.list_stock_registry',
    counts: buildNegativeLabStockRegistryCounts(NEGATIVE_LAB_STOCK_REGISTRY),
    proof: {
      deterministic: true,
      generatedFrom: 'src/utils/negativeLabStockRegistry.ts',
      namedStockClaimsRuntimeGated: true,
    },
    registry: NEGATIVE_LAB_STOCK_REGISTRY,
  });
};

export const buildNegativeLabStockFamilyConversionRouteResult = (
  command: NegativeLabStockFamilyConversionAppServerCommand,
  runtimeCatalog: NegativeLabRuntimeProfileCatalog = NEGATIVE_LAB_RUNTIME_PROFILE_CATALOG,
): NegativeLabStockFamilyConversionResult => {
  const parsedCommand = negativeLabStockFamilyConversionAppServerCommandSchema.parse(command);
  const stockFamily = NEGATIVE_LAB_STOCK_REGISTRY.entries.find(
    (entry) => entry.registryId === parsedCommand.stockFamilyRegistryId,
  );

  if (stockFamily === undefined) {
    throw new Error(`Unknown Negative Lab stock-family registry id: ${parsedCommand.stockFamilyRegistryId}`);
  }

  if (stockFamily.genericPresetId === null) {
    throw new Error(`Negative Lab stock-family registry id is not runtime-safe: ${stockFamily.registryId}`);
  }

  const conversionPlan = buildNegativeLabConversionPlanResult(
    {
      outputFormat: parsedCommand.outputFormat,
      paths: parsedCommand.paths,
      presetId: stockFamily.genericPresetId,
      sampleRect: parsedCommand.sampleRect,
      scope: parsedCommand.scope,
      suffix: parsedCommand.suffix,
    },
    runtimeCatalog,
  );

  return negativeLabStockFamilyConversionResultSchema.parse({
    commandName: 'negative.lab.build_stock_family_conversion_plan',
    conversionPlan,
    proof: {
      deterministic: true,
      generatedFrom: 'src/utils/negativeLabAppServerRoutes.ts',
      registryMappedPreset: true,
    },
    stockFamily,
  });
};
