import { detailAppServerRouteManifestSchema } from '../schemas/detailAppServerSchemas';

export const DETAIL_APP_SERVER_ROUTE_MANIFEST = detailAppServerRouteManifestSchema.parse({
  routes: [
    {
      commandType: 'detailDeblur.dryRunControls',
      executionMode: 'dry_run_command',
      feature: 'deblur',
      inputSchemaName: 'DetailDeblurCommandEnvelopeV1',
      outputSchemaName: 'DetailDeblurDryRunResultV1',
      reason:
        'Deblur dry-runs validate scene-linear deblur controls and return explicit preview/export-not-wired metadata.',
      runtimeCheckScript: 'check:deblur-app-server-tool',
      status: 'mapped_unavailable',
      toolName: 'detail.deblur.dry_run_command',
    },
    {
      commandType: 'detailDeblur.applyControls',
      executionMode: 'apply_dry_run_plan',
      feature: 'deblur',
      inputSchemaName: 'DetailDeblurCommandEnvelopeV1',
      outputSchemaName: 'DetailDeblurDryRunResultV1',
      reason:
        'Deblur apply requests require edit approval but currently return explicit unavailable metadata instead of mutating.',
      runtimeCheckScript: 'check:deblur-app-server-tool',
      status: 'mapped_unavailable',
      toolName: 'detail.deblur.apply_command',
    },
  ],
  schemaVersion: 1,
});

export const DETAIL_APP_SERVER_ROUTES = DETAIL_APP_SERVER_ROUTE_MANIFEST.routes;
