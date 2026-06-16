import { buildNegativeLabFrameHealthReport } from './negativeLabFrameHealth';
import { NEGATIVE_LAB_BUILT_IN_UI_PRESET_CATALOG } from './negativeLabPresetCatalog';
import {
  negativeLabAppServerCommandSchema,
  negativeLabAppServerRouteManifestSchema,
  negativeLabConversionPlanResultSchema,
  negativeLabFrameHealthAppServerCommandSchema,
  negativeLabFrameHealthAppServerResultSchema,
  type NegativeLabAppServerCommand,
  type NegativeLabConversionPlanResult,
  type NegativeLabFrameHealthAppServerCommand,
  type NegativeLabFrameHealthAppServerResult,
} from '../schemas/negativeLabAppServerSchemas';

export const NEGATIVE_LAB_APP_SERVER_ROUTE_MANIFEST = negativeLabAppServerRouteManifestSchema.parse({
  routes: [
    {
      commandName: 'negative.lab.build_conversion_plan',
      inputSchemaName: 'NegativeLabAppServerCommandV1',
      outputSchemaName: 'NegativeLabConversionPlanResultV1',
      reason:
        'Negative Lab app-server calls share the UI built-in preset catalog and deterministic conversion plan shape.',
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
