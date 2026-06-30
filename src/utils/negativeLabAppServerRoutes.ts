import {
  type NegativeLabAcceptBatchPlanAppServerCommand,
  type NegativeLabAcceptBatchPlanAppServerResult,
  type NegativeLabAcceptedBatchApplyAppServerCommand,
  type NegativeLabAcceptedBatchApplyAppServerResult,
  type NegativeLabAppServerCommand,
  type NegativeLabBatchSummaryAppServerCommand,
  type NegativeLabBatchSummaryAppServerResult,
  type NegativeLabConversionPlanResult,
  type NegativeLabDensitometerAppServerCommand,
  type NegativeLabDensitometerAppServerResult,
  type NegativeLabFrameHealthAppServerCommand,
  type NegativeLabFrameHealthAppServerResult,
  type NegativeLabPlanRollNormalizationAppServerCommand,
  type NegativeLabPlanRollNormalizationAppServerResult,
  type NegativeLabQcProofAppServerCommand,
  type NegativeLabQcProofAppServerResult,
  type NegativeLabStockFamilyConversionAppServerCommand,
  type NegativeLabStockFamilyConversionResult,
  type NegativeLabStockMetadataAppServerCommand,
  type NegativeLabStockMetadataAppServerResult,
  type NegativeLabStockRegistryAppServerCommand,
  type NegativeLabStockRegistryAppServerResult,
  negativeLabAcceptBatchPlanAppServerCommandSchema,
  negativeLabAcceptBatchPlanAppServerResultSchema,
  negativeLabAcceptedBatchApplyAppServerCommandSchema,
  negativeLabAcceptedBatchApplyAppServerResultSchema,
  negativeLabAppServerCommandSchema,
  negativeLabAppServerRouteManifestSchema,
  negativeLabBatchSummaryAppServerCommandSchema,
  negativeLabBatchSummaryAppServerResultSchema,
  negativeLabConversionPlanResultSchema,
  negativeLabDensitometerAppServerCommandSchema,
  negativeLabDensitometerAppServerResultSchema,
  negativeLabFrameHealthAppServerCommandSchema,
  negativeLabFrameHealthAppServerResultSchema,
  negativeLabPlanRollNormalizationAppServerCommandSchema,
  negativeLabPlanRollNormalizationAppServerResultSchema,
  negativeLabQcProofAppServerCommandSchema,
  negativeLabQcProofAppServerResultSchema,
  negativeLabRouteDescriptors,
  negativeLabStockFamilyConversionAppServerCommandSchema,
  negativeLabStockFamilyConversionResultSchema,
  negativeLabStockMetadataAppServerCommandSchema,
  negativeLabStockMetadataAppServerResultSchema,
  negativeLabStockRegistryAppServerCommandSchema,
  negativeLabStockRegistryAppServerResultSchema,
} from '../schemas/negativeLabAppServerSchemas';
import { NegativeLabAppServerCommandName } from './negativeLabAppServerCommandNames';
import { buildNegativeBaseFogDensitometerReadout } from './negativeLabDensitometer';
import { buildNegativeLabDustScratchReviewReport, buildNegativeLabQcProofReport } from './negativeLabDustScratchReview';
import { buildNegativeLabBatchDryRunSummary, buildNegativeLabFrameHealthReport } from './negativeLabFrameHealth';
import {
  buildNegativeLabRuntimeProfileProvenanceHash,
  buildNegativeLabRuntimeSelectedProfileSnapshot,
  NEGATIVE_LAB_RUNTIME_PROFILE_CATALOG,
  type NegativeLabRuntimeProfileCatalog,
  resolveNegativeLabRuntimeProfile,
} from './negativeLabMeasuredProfileRuntime';
import { buildNegativeLabPlanHash } from './negativeLabPlanIdentity';
import { buildNegativeLabRollNormalizationPlan } from './negativeLabRollNormalizationPlan';
import {
  buildNegativeLabStockMetadataCounts,
  NEGATIVE_LAB_STOCK_METADATA_CATALOG,
} from './negativeLabStockMetadataCatalog';
import { buildNegativeLabStockRegistryCounts, NEGATIVE_LAB_STOCK_REGISTRY } from './negativeLabStockRegistry';

export const NEGATIVE_LAB_APP_SERVER_ROUTE_MANIFEST = negativeLabAppServerRouteManifestSchema.parse({
  routes: negativeLabRouteDescriptors.map((descriptor) => ({ ...descriptor, status: 'mapped' as const })),
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
    commandName: NegativeLabAppServerCommandName.ConversionPlan,
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
      densityAlgorithm: profile.params.print_curve_algorithm,
      deterministic: true,
      generatedFrom: 'src/utils/negativeLabMeasuredProfileRuntime.ts',
      runtimeConversionHelper: 'src/utils/negativeLabDensityConversion.ts',
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

export const buildNegativeLabPlanRollNormalizationRouteResult = (
  command: NegativeLabPlanRollNormalizationAppServerCommand,
): NegativeLabPlanRollNormalizationAppServerResult => {
  const parsedCommand = negativeLabPlanRollNormalizationAppServerCommandSchema.parse(command);
  const frameHealthCommand = {
    activePathIndex: parsedCommand.activePathIndex,
    baseFogConfidence: parsedCommand.baseFogConfidence,
    includedPaths: parsedCommand.includedPaths,
    previewReady: parsedCommand.previewReady,
    targetPaths: parsedCommand.targetPaths,
  };
  const frameHealthReport = buildNegativeLabFrameHealthRouteResult(frameHealthCommand);

  return negativeLabPlanRollNormalizationAppServerResultSchema.parse(
    buildNegativeLabRollNormalizationPlan({
      anchorFrameIds: parsedCommand.anchorFrameIds,
      baselineExposure: 0,
      frameHealthReport,
      frameScanMetrics: parsedCommand.frameScanMetrics ?? [],
      mode: parsedCommand.mode,
      preserveCreativeAdjustments: parsedCommand.preserveCreativeAdjustments,
      selectedFrameIds: parsedCommand.selectedFrameIds,
    }),
  );
};

export const buildNegativeLabQcProofRouteResult = (
  command: NegativeLabQcProofAppServerCommand,
): NegativeLabQcProofAppServerResult => {
  const parsedCommand = negativeLabQcProofAppServerCommandSchema.parse(command);
  const frameHealthReport = buildNegativeLabFrameHealthRouteResult(parsedCommand);
  const reviewReport = buildNegativeLabDustScratchReviewReport(frameHealthReport, parsedCommand.previewReady);
  const exportReady =
    parsedCommand.previewReady &&
    frameHealthReport.queuedCount > 0 &&
    frameHealthReport.includedCount === frameHealthReport.frames.length &&
    !reviewReport.frames.some((frame) => frame.severity === 'retouch');

  return negativeLabQcProofAppServerResultSchema.parse(
    buildNegativeLabQcProofReport(reviewReport, parsedCommand.previewReady, exportReady),
  );
};

export const buildNegativeLabAcceptedBatchPlanRouteResult = (
  command: NegativeLabAcceptBatchPlanAppServerCommand,
  runtimeCatalog: NegativeLabRuntimeProfileCatalog = NEGATIVE_LAB_RUNTIME_PROFILE_CATALOG,
): NegativeLabAcceptBatchPlanAppServerResult => {
  const parsedCommand = negativeLabAcceptBatchPlanAppServerCommandSchema.parse(command);
  const { presetId: _presetId, ...frameHealthCommand } = parsedCommand;
  const dryRunSummary = buildNegativeLabBatchSummaryRouteResult(frameHealthCommand);
  const profile = resolveNegativeLabRuntimeProfile(parsedCommand.presetId, runtimeCatalog);
  const selectedProfileSnapshot = buildNegativeLabRuntimeSelectedProfileSnapshot(profile);
  const acceptedDryRunPlanHash = `fnv1a32:${buildNegativeLabPlanHash(
    JSON.stringify({
      dryRunSummaryJson: JSON.stringify(dryRunSummary),
      selectedProfile: selectedProfileSnapshot,
    }),
  )}`;

  return negativeLabAcceptBatchPlanAppServerResultSchema.parse({
    acceptedDryRunPlanHash,
    acceptedDryRunPlanId: `negative_lab_batch_plan_${acceptedDryRunPlanHash.slice('fnv1a32:'.length)}`,
    commandName: NegativeLabAppServerCommandName.AcceptBatchPlan,
    dryRunSummary,
    proof: {
      deterministic: true,
      generatedFrom: 'src/utils/negativeLabAppServerRoutes.ts',
      selectedProfileBound: true,
    },
    selectedProfileSnapshot,
  });
};

export const buildNegativeLabAcceptedBatchApplyRouteResult = (
  command: NegativeLabAcceptedBatchApplyAppServerCommand,
  runtimeCatalog: NegativeLabRuntimeProfileCatalog = NEGATIVE_LAB_RUNTIME_PROFILE_CATALOG,
): NegativeLabAcceptedBatchApplyAppServerResult => {
  const parsedCommand = negativeLabAcceptedBatchApplyAppServerCommandSchema.parse(command);
  const expectedAcceptedPlan = buildNegativeLabAcceptedBatchPlanRouteResult(parsedCommand.dryRun, runtimeCatalog);
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
  const selectedProfileSnapshot = parsedCommand.selectedProfileSnapshot;
  const acceptedSelectedProfileSnapshot = expectedAcceptedPlan.selectedProfileSnapshot;
  const acceptedProfileJson = JSON.stringify(acceptedSelectedProfileSnapshot);
  if (JSON.stringify(parsedCommand.acceptedPlan.selectedProfileSnapshot) !== acceptedProfileJson) {
    throw new Error('Accepted Negative Lab apply plan does not match the selected profile snapshot.');
  }

  if (
    conversionPlan.presetId !== acceptedSelectedProfileSnapshot.presetId ||
    conversionPlan.profileProvenanceHash !== acceptedSelectedProfileSnapshot.profileProvenanceHash
  ) {
    throw new Error('Selected Negative Lab profile snapshot does not match the accepted apply conversion profile.');
  }

  if (selectedProfileSnapshot !== undefined && JSON.stringify(selectedProfileSnapshot) !== acceptedProfileJson) {
    throw new Error('Caller supplied Negative Lab profile snapshot does not match the accepted plan.');
  }

  return negativeLabAcceptedBatchApplyAppServerResultSchema.parse({
    acceptedDryRunPlanHash: expectedAcceptedPlan.acceptedDryRunPlanHash,
    acceptedDryRunPlanId: expectedAcceptedPlan.acceptedDryRunPlanId,
    apply: {
      options: {
        acceptedDryRunPlanHash: expectedAcceptedPlan.acceptedDryRunPlanHash,
        acceptedDryRunPlanId: expectedAcceptedPlan.acceptedDryRunPlanId,
        outputFormat: parsedCommand.conversion.outputFormat,
        profileProvenanceHash: conversionPlan.profileProvenanceHash,
        selectedProfile: acceptedSelectedProfileSnapshot,
        suffix: parsedCommand.conversion.suffix,
      },
      params: conversionPlan.params,
      paths: plannedPaths,
    },
    commandName: NegativeLabAppServerCommandName.AcceptedBatchApply,
    conversionPlan,
    dryRunSummary: expectedAcceptedPlan.dryRunSummary,
    proof: {
      dryRunRequired: true,
      generatedFrom: 'src/utils/negativeLabAppServerRoutes.ts',
      identityMatched: true,
      selectedProfileBound: true,
    },
    selectedProfileSnapshot: acceptedSelectedProfileSnapshot,
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
    commandName: NegativeLabAppServerCommandName.StockRegistry,
    counts: buildNegativeLabStockRegistryCounts(NEGATIVE_LAB_STOCK_REGISTRY),
    proof: {
      deterministic: true,
      generatedFrom: 'src/utils/negativeLabStockRegistry.ts',
      namedStockClaimsRuntimeGated: true,
    },
    registry: NEGATIVE_LAB_STOCK_REGISTRY,
  });
};

export const buildNegativeLabStockMetadataRouteResult = (
  command: NegativeLabStockMetadataAppServerCommand,
): NegativeLabStockMetadataAppServerResult => {
  negativeLabStockMetadataAppServerCommandSchema.parse(command);

  return negativeLabStockMetadataAppServerResultSchema.parse({
    catalog: NEGATIVE_LAB_STOCK_METADATA_CATALOG,
    commandName: NegativeLabAppServerCommandName.StockMetadata,
    counts: buildNegativeLabStockMetadataCounts(NEGATIVE_LAB_STOCK_METADATA_CATALOG),
    proof: {
      deterministic: true,
      generatedFrom: 'src/utils/negativeLabStockMetadataCatalog.ts',
      metadataOnlyNotRuntimeApplied: true,
      namedStockClaimsRuntimeGated: true,
    },
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
    commandName: NegativeLabAppServerCommandName.StockFamilyConversion,
    conversionPlan,
    proof: {
      deterministic: true,
      generatedFrom: 'src/utils/negativeLabAppServerRoutes.ts',
      registryMappedPreset: true,
    },
    stockFamily,
  });
};
