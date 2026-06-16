import { buildNegativeBaseFogDensitometerReadout } from './negativeLabDensitometer';
import { buildNegativeLabBatchDryRunSummary, buildNegativeLabFrameHealthReport } from './negativeLabFrameHealth';
import { NEGATIVE_LAB_BUILT_IN_UI_PRESET_CATALOG } from './negativeLabPresetCatalog';
import {
  negativeLabAppServerCommandSchema,
  negativeLabAppServerRouteManifestSchema,
  negativeLabAcceptBatchPlanAppServerCommandSchema,
  negativeLabAcceptBatchPlanAppServerResultSchema,
  negativeLabBatchSummaryAppServerCommandSchema,
  negativeLabBatchSummaryAppServerResultSchema,
  negativeLabConversionPlanResultSchema,
  negativeLabDensitometerAppServerCommandSchema,
  negativeLabDensitometerAppServerResultSchema,
  negativeLabFrameHealthAppServerCommandSchema,
  negativeLabFrameHealthAppServerResultSchema,
  type NegativeLabAppServerCommand,
  type NegativeLabAcceptBatchPlanAppServerCommand,
  type NegativeLabAcceptBatchPlanAppServerResult,
  type NegativeLabBatchSummaryAppServerCommand,
  type NegativeLabBatchSummaryAppServerResult,
  type NegativeLabConversionPlanResult,
  type NegativeLabDensitometerAppServerCommand,
  type NegativeLabDensitometerAppServerResult,
  type NegativeLabFrameHealthAppServerCommand,
  type NegativeLabFrameHealthAppServerResult,
} from '../schemas/negativeLabAppServerSchemas';

const buildPlanHash = (value: string) => {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
};

export const NEGATIVE_LAB_APP_SERVER_ROUTE_MANIFEST = negativeLabAppServerRouteManifestSchema.parse({
  routes: [
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
  ],
  schemaVersion: 1,
});

export const buildNegativeLabConversionPlanResult = (
  command: NegativeLabAppServerCommand,
): NegativeLabConversionPlanResult => {
  const parsedCommand = negativeLabAppServerCommandSchema.parse(command);
  const preset = NEGATIVE_LAB_BUILT_IN_UI_PRESET_CATALOG.presets.find(
    (candidate) => candidate.presetId === parsedCommand.presetId,
  );

  if (preset === undefined) {
    throw new Error(`Unknown Negative Lab preset id: ${parsedCommand.presetId}`);
  }

  return negativeLabConversionPlanResultSchema.parse({
    commandName: 'negative.lab.build_conversion_plan',
    outputFormat: parsedCommand.outputFormat,
    params: {
      ...preset.params,
      base_fog_sample: parsedCommand.sampleRect,
    },
    paths: parsedCommand.paths,
    presetId: preset.presetId,
    proof: {
      deterministic: true,
      generatedFrom: 'src/utils/negativeLabPresetCatalog.ts',
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
  const planHash = buildPlanHash(JSON.stringify(dryRunSummary));

  return negativeLabAcceptBatchPlanAppServerResultSchema.parse({
    acceptedDryRunPlanHash: `fnv1a32:${planHash}`,
    acceptedDryRunPlanId: `negative_lab_batch_plan_${planHash}`,
    commandName: 'negative.lab.accept_batch_dry_run_plan',
    dryRunSummary,
    proof: {
      deterministic: true,
      generatedFrom: 'src/utils/negativeLabFrameHealth.ts',
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
