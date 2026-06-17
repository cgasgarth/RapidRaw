import { toneColorAppServerRouteManifestSchema } from '../schemas/toneColorAppServerSchemas';

const inputSchemaName = 'ToneColorCommandEnvelopeV1';
const runtimeCheckScript = 'check:basic-tone-command-bridge';

export const TONE_COLOR_APP_SERVER_ROUTE_MANIFEST = toneColorAppServerRouteManifestSchema.parse({
  routes: [
    {
      commandType: 'toneColor.setBasicTone',
      executionMode: 'dry_run_command',
      inputSchemaName,
      outputSchemaName: 'ToneColorDryRunResultV1',
      reason: 'Basic tone dry-runs use the shared UI/agent typed command bridge before graph mutation.',
      runtimeCheckScript,
      status: 'mapped',
      toolName: 'tonecolor.dry_run_command',
    },
    {
      commandType: 'toneColor.setBasicTone',
      executionMode: 'apply_dry_run_plan',
      inputSchemaName,
      outputSchemaName: 'ToneColorMutationResultV1',
      reason: 'Basic tone applies reuse the typed command bridge with edit-apply approval.',
      runtimeCheckScript,
      status: 'mapped',
      toolName: 'tonecolor.apply_command',
    },
  ],
  schemaVersion: 1,
});

export const TONE_COLOR_APP_SERVER_ROUTES = TONE_COLOR_APP_SERVER_ROUTE_MANIFEST.routes;
