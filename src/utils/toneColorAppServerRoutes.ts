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
    {
      commandType: 'toneColor.setLevels',
      executionMode: 'dry_run_command',
      inputSchemaName,
      outputSchemaName: 'ToneColorDryRunResultV1',
      reason: 'Levels dry-runs use the generic tone/color command tool with luma-only runtime validation.',
      runtimeCheckScript: 'check:levels-runtime',
      status: 'mapped',
      toolName: 'tonecolor.dry_run_command',
    },
    {
      commandType: 'toneColor.setLevels',
      executionMode: 'apply_dry_run_plan',
      inputSchemaName,
      outputSchemaName: 'ToneColorMutationResultV1',
      reason: 'Levels applies reuse the approved tone/color apply tool and persist an undoable edit graph update.',
      runtimeCheckScript: 'check:levels-runtime',
      status: 'mapped',
      toolName: 'tonecolor.apply_command',
    },
    {
      commandType: 'toneColor.setChannelMixer',
      executionMode: 'dry_run_command',
      inputSchemaName,
      outputSchemaName: 'ToneColorDryRunResultV1',
      reason: 'Channel mixer dry-runs use the generic tone/color command tool with RGB mixer runtime validation.',
      runtimeCheckScript: 'check:channel-mixer',
      status: 'mapped',
      toolName: 'tonecolor.dry_run_command',
    },
    {
      commandType: 'toneColor.setChannelMixer',
      executionMode: 'apply_dry_run_plan',
      inputSchemaName,
      outputSchemaName: 'ToneColorMutationResultV1',
      reason:
        'Channel mixer applies reuse the approved tone/color apply tool and persist an undoable edit graph update.',
      runtimeCheckScript: 'check:channel-mixer',
      status: 'mapped',
      toolName: 'tonecolor.apply_command',
    },
    {
      commandType: 'toneColor.setColorBalanceRgb',
      executionMode: 'dry_run_command',
      inputSchemaName,
      outputSchemaName: 'ToneColorDryRunResultV1',
      reason:
        'RGB color balance dry-runs use the generic tone/color command tool with range-weighted runtime validation.',
      runtimeCheckScript: 'check:color-balance-rgb',
      status: 'mapped',
      toolName: 'tonecolor.dry_run_command',
    },
    {
      commandType: 'toneColor.setColorBalanceRgb',
      executionMode: 'apply_dry_run_plan',
      inputSchemaName,
      outputSchemaName: 'ToneColorMutationResultV1',
      reason:
        'RGB color balance applies reuse the approved tone/color apply tool and persist an undoable edit graph update.',
      runtimeCheckScript: 'check:color-balance-rgb',
      status: 'mapped',
      toolName: 'tonecolor.apply_command',
    },
    {
      commandType: 'toneColor.setBlackWhiteMixer',
      executionMode: 'dry_run_command',
      inputSchemaName,
      outputSchemaName: 'ToneColorDryRunResultV1',
      reason:
        'Black and white mixer dry-runs use the generic tone/color command tool with hue-weighted runtime validation.',
      runtimeCheckScript: 'check:black-white-mixer',
      status: 'mapped',
      toolName: 'tonecolor.dry_run_command',
    },
    {
      commandType: 'toneColor.setBlackWhiteMixer',
      executionMode: 'apply_dry_run_plan',
      inputSchemaName,
      outputSchemaName: 'ToneColorMutationResultV1',
      reason:
        'Black and white mixer applies reuse the approved tone/color apply tool and persist an undoable edit graph update.',
      runtimeCheckScript: 'check:black-white-mixer',
      status: 'mapped',
      toolName: 'tonecolor.apply_command',
    },
  ],
  schemaVersion: 1,
});

export const TONE_COLOR_APP_SERVER_ROUTES = TONE_COLOR_APP_SERVER_ROUTE_MANIFEST.routes;
