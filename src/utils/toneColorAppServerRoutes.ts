import {
  ToneColorAppServerExecutionMode,
  ToneColorAppServerRouteStatus,
  ToneColorAppServerSchemaName,
  ToneColorAppServerToolName,
} from './toneColorAppServerRouteIds';
import { toneColorAppServerRouteManifestSchema } from '../schemas/toneColorAppServerSchemas';

const inputSchemaName = ToneColorAppServerSchemaName.CommandEnvelope;
const runtimeCheckScript = 'check:basic-tone-command-bridge';
const dryRunRoute = {
  executionMode: ToneColorAppServerExecutionMode.DryRunCommand,
  outputSchemaName: ToneColorAppServerSchemaName.DryRunResult,
  status: ToneColorAppServerRouteStatus.Mapped,
  toolName: ToneColorAppServerToolName.DryRunCommand,
} as const;
const applyRoute = {
  executionMode: ToneColorAppServerExecutionMode.ApplyDryRunPlan,
  outputSchemaName: ToneColorAppServerSchemaName.MutationResult,
  status: ToneColorAppServerRouteStatus.Mapped,
  toolName: ToneColorAppServerToolName.ApplyCommand,
} as const;

export const TONE_COLOR_APP_SERVER_ROUTE_MANIFEST = toneColorAppServerRouteManifestSchema.parse({
  routes: [
    {
      commandType: 'toneColor.setBasicTone',
      ...dryRunRoute,
      inputSchemaName,
      reason: 'Basic tone dry-runs use the shared UI/agent typed command bridge before graph mutation.',
      runtimeCheckScript,
    },
    {
      commandType: 'toneColor.setBasicTone',
      ...applyRoute,
      inputSchemaName,
      reason: 'Basic tone applies reuse the typed command bridge with edit-apply approval.',
      runtimeCheckScript,
    },
    {
      commandType: 'toneColor.setToneCurve',
      ...dryRunRoute,
      inputSchemaName,
      reason: 'Tone curve dry-runs use the generic tone/color command tool with profile tone validation.',
      runtimeCheckScript: 'check:profile-tone',
    },
    {
      commandType: 'toneColor.setToneCurve',
      ...applyRoute,
      inputSchemaName,
      reason: 'Tone curve applies reuse the approved tone/color apply tool and persist an undoable edit graph update.',
      runtimeCheckScript: 'check:profile-tone',
    },
    {
      commandType: 'toneColor.setWhiteBalance',
      ...dryRunRoute,
      inputSchemaName,
      reason: 'White balance dry-runs use the generic tone/color command tool with picker/runtime validation.',
      runtimeCheckScript: 'check:white-balance-picker',
    },
    {
      commandType: 'toneColor.setWhiteBalance',
      ...applyRoute,
      inputSchemaName,
      reason:
        'White balance applies reuse the approved tone/color apply tool and persist an undoable edit graph update.',
      runtimeCheckScript: 'check:white-balance-picker',
    },
    {
      commandType: 'toneColor.adjustHsl',
      ...dryRunRoute,
      inputSchemaName,
      reason: 'HSL color mixer dry-runs use the generic tone/color command tool with selective color range validation.',
      runtimeCheckScript: 'check:selective-color-ranges',
    },
    {
      commandType: 'toneColor.adjustHsl',
      ...applyRoute,
      inputSchemaName,
      reason:
        'HSL color mixer applies reuse the approved tone/color apply tool and persist an undoable edit graph update.',
      runtimeCheckScript: 'check:selective-color-ranges',
    },
    {
      commandType: 'toneColor.setColorGrading',
      ...dryRunRoute,
      inputSchemaName,
      reason: 'Color grading dry-runs use the generic tone/color command tool with color grading preset validation.',
      runtimeCheckScript: 'check:color-grading-presets',
    },
    {
      commandType: 'toneColor.setColorGrading',
      ...applyRoute,
      inputSchemaName,
      reason:
        'Color grading applies reuse the approved tone/color apply tool and persist an undoable edit graph update.',
      runtimeCheckScript: 'check:color-grading-presets',
    },
    {
      commandType: 'toneColor.setLevels',
      ...dryRunRoute,
      inputSchemaName,
      reason: 'Levels dry-runs use the generic tone/color command tool with luma-only runtime validation.',
      runtimeCheckScript: 'check:levels-runtime',
    },
    {
      commandType: 'toneColor.setLevels',
      ...applyRoute,
      inputSchemaName,
      reason: 'Levels applies reuse the approved tone/color apply tool and persist an undoable edit graph update.',
      runtimeCheckScript: 'check:levels-runtime',
    },
    {
      commandType: 'toneColor.setChannelMixer',
      ...dryRunRoute,
      inputSchemaName,
      reason: 'Channel mixer dry-runs use the generic tone/color command tool with RGB mixer runtime validation.',
      runtimeCheckScript: 'check:channel-mixer',
    },
    {
      commandType: 'toneColor.setChannelMixer',
      ...applyRoute,
      inputSchemaName,
      reason:
        'Channel mixer applies reuse the approved tone/color apply tool and persist an undoable edit graph update.',
      runtimeCheckScript: 'check:channel-mixer',
    },
    {
      commandType: 'toneColor.setColorBalanceRgb',
      ...dryRunRoute,
      inputSchemaName,
      reason:
        'RGB color balance dry-runs use the generic tone/color command tool with range-weighted runtime validation.',
      runtimeCheckScript: 'check:color-balance-rgb',
    },
    {
      commandType: 'toneColor.setColorBalanceRgb',
      ...applyRoute,
      inputSchemaName,
      reason:
        'RGB color balance applies reuse the approved tone/color apply tool and persist an undoable edit graph update.',
      runtimeCheckScript: 'check:color-balance-rgb',
    },
    {
      commandType: 'toneColor.setBlackWhiteMixer',
      ...dryRunRoute,
      inputSchemaName,
      reason:
        'Black and white mixer dry-runs use the generic tone/color command tool with hue-weighted runtime validation.',
      runtimeCheckScript: 'check:black-white-mixer',
    },
    {
      commandType: 'toneColor.setBlackWhiteMixer',
      ...applyRoute,
      inputSchemaName,
      reason:
        'Black and white mixer applies reuse the approved tone/color apply tool and persist an undoable edit graph update.',
      runtimeCheckScript: 'check:black-white-mixer',
    },
  ],
  schemaVersion: 1,
});

export const TONE_COLOR_APP_SERVER_ROUTES = TONE_COLOR_APP_SERVER_ROUTE_MANIFEST.routes;
