import { detailAppServerRouteManifestSchema } from '../schemas/detailAppServerSchemas';
import {
  DetailAppServerCommandType,
  DetailAppServerExecutionMode,
  DetailAppServerFeature,
  DetailAppServerRouteStatus,
  DetailAppServerSchemaName,
  DetailAppServerToolName,
} from './detailAppServerRouteIds';

export const DETAIL_APP_SERVER_ROUTE_MANIFEST = detailAppServerRouteManifestSchema.parse({
  routes: [
    {
      commandType: DetailAppServerCommandType.DryRunControls,
      executionMode: DetailAppServerExecutionMode.DryRunCommand,
      feature: DetailAppServerFeature.Deblur,
      inputSchemaName: DetailAppServerSchemaName.CommandEnvelope,
      outputSchemaName: DetailAppServerSchemaName.DryRunResult,
      reason:
        'Deblur dry-runs validate scene-linear deblur controls and return explicit preview/export-not-wired metadata.',
      runtimeCheckScript: 'check:deblur-app-server-tool',
      status: DetailAppServerRouteStatus.MappedUnavailable,
      toolName: DetailAppServerToolName.DryRunCommand,
    },
    {
      commandType: DetailAppServerCommandType.ApplyControls,
      executionMode: DetailAppServerExecutionMode.ApplyDryRunPlan,
      feature: DetailAppServerFeature.Deblur,
      inputSchemaName: DetailAppServerSchemaName.CommandEnvelope,
      outputSchemaName: DetailAppServerSchemaName.DryRunResult,
      reason:
        'Deblur apply requests require edit approval but currently return explicit unavailable metadata instead of mutating.',
      runtimeCheckScript: 'check:deblur-app-server-tool',
      status: DetailAppServerRouteStatus.MappedUnavailable,
      toolName: DetailAppServerToolName.ApplyCommand,
    },
  ],
  schemaVersion: 1,
});

export const DETAIL_APP_SERVER_ROUTES = DETAIL_APP_SERVER_ROUTE_MANIFEST.routes;
