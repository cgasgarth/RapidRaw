import {
  type ToneColorAppServerCommandType,
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
  toolName: ToneColorAppServerToolName.DryRunCommand,
} as const;
const applyRoute = {
  executionMode: ToneColorAppServerExecutionMode.ApplyDryRunPlan,
  outputSchemaName: ToneColorAppServerSchemaName.MutationResult,
  toolName: ToneColorAppServerToolName.ApplyCommand,
} as const;
const executableCommandTypes = new Set<ToneColorAppServerCommandType>([
  'toneColor.adjustHsl',
  'toneColor.setBasicTone',
]);

const routeStatusForCommand = (commandType: ToneColorAppServerCommandType): ToneColorAppServerRouteStatus =>
  executableCommandTypes.has(commandType)
    ? ToneColorAppServerRouteStatus.Mapped
    : ToneColorAppServerRouteStatus.MappedUnavailable;

export const TONE_COLOR_APP_SERVER_ROUTE_MANIFEST = toneColorAppServerRouteManifestSchema.parse({
  routes: [
    {
      commandType: 'toneColor.setBasicTone',
      ...dryRunRoute,
      inputSchemaName,
      reason: 'Basic tone dry-runs use the shared UI/agent typed command bridge before graph mutation.',
      runtimeCheckScript,
      status: routeStatusForCommand('toneColor.setBasicTone'),
    },
    {
      commandType: 'toneColor.setBasicTone',
      ...applyRoute,
      inputSchemaName,
      reason: 'Basic tone applies reuse the typed command bridge with edit-apply approval.',
      runtimeCheckScript,
      status: routeStatusForCommand('toneColor.setBasicTone'),
    },
    {
      commandType: 'toneColor.setToneCurve',
      ...dryRunRoute,
      inputSchemaName,
      reason: 'Tone curve dry-runs use the generic tone/color command tool with profile tone validation.',
      runtimeCheckScript: 'check:profile-tone',
      status: routeStatusForCommand('toneColor.setToneCurve'),
    },
    {
      commandType: 'toneColor.setToneCurve',
      ...applyRoute,
      inputSchemaName,
      reason: 'Tone curve applies reuse the approved tone/color apply tool and persist an undoable edit graph update.',
      runtimeCheckScript: 'check:profile-tone',
      status: routeStatusForCommand('toneColor.setToneCurve'),
    },
    {
      commandType: 'toneColor.setWhiteBalance',
      ...dryRunRoute,
      inputSchemaName,
      reason: 'White balance dry-runs use the generic tone/color command tool with picker/runtime validation.',
      runtimeCheckScript: 'check:white-balance-picker',
      status: routeStatusForCommand('toneColor.setWhiteBalance'),
    },
    {
      commandType: 'toneColor.setWhiteBalance',
      ...applyRoute,
      inputSchemaName,
      reason:
        'White balance applies reuse the approved tone/color apply tool and persist an undoable edit graph update.',
      runtimeCheckScript: 'check:white-balance-picker',
      status: routeStatusForCommand('toneColor.setWhiteBalance'),
    },
    {
      commandType: 'toneColor.adjustHsl',
      ...dryRunRoute,
      inputSchemaName,
      reason: 'HSL color mixer dry-runs use the generic tone/color command tool with selective color range validation.',
      runtimeCheckScript: 'check:selective-color-ranges',
      status: routeStatusForCommand('toneColor.adjustHsl'),
    },
    {
      commandType: 'toneColor.adjustHsl',
      ...applyRoute,
      inputSchemaName,
      reason:
        'HSL color mixer applies reuse the approved tone/color apply tool and persist an undoable edit graph update.',
      runtimeCheckScript: 'check:selective-color-ranges',
      status: routeStatusForCommand('toneColor.adjustHsl'),
    },
    {
      commandType: 'toneColor.setColorGrading',
      ...dryRunRoute,
      inputSchemaName,
      reason: 'Color grading dry-runs use the generic tone/color command tool with color grading preset validation.',
      runtimeCheckScript: 'check:color-grading-presets',
      status: routeStatusForCommand('toneColor.setColorGrading'),
    },
    {
      commandType: 'toneColor.setColorGrading',
      ...applyRoute,
      inputSchemaName,
      reason:
        'Color grading applies reuse the approved tone/color apply tool and persist an undoable edit graph update.',
      runtimeCheckScript: 'check:color-grading-presets',
      status: routeStatusForCommand('toneColor.setColorGrading'),
    },
    {
      commandType: 'toneColor.setLevels',
      ...dryRunRoute,
      inputSchemaName,
      reason: 'Levels dry-runs use the generic tone/color command tool with luma-only runtime validation.',
      runtimeCheckScript: 'check:levels-runtime',
      status: routeStatusForCommand('toneColor.setLevels'),
    },
    {
      commandType: 'toneColor.setLevels',
      ...applyRoute,
      inputSchemaName,
      reason: 'Levels applies reuse the approved tone/color apply tool and persist an undoable edit graph update.',
      runtimeCheckScript: 'check:levels-runtime',
      status: routeStatusForCommand('toneColor.setLevels'),
    },
    {
      commandType: 'toneColor.setChannelMixer',
      ...dryRunRoute,
      inputSchemaName,
      reason: 'Channel mixer dry-runs use the generic tone/color command tool with RGB mixer runtime validation.',
      runtimeCheckScript: 'check:channel-mixer',
      status: routeStatusForCommand('toneColor.setChannelMixer'),
    },
    {
      commandType: 'toneColor.setChannelMixer',
      ...applyRoute,
      inputSchemaName,
      reason:
        'Channel mixer applies reuse the approved tone/color apply tool and persist an undoable edit graph update.',
      runtimeCheckScript: 'check:channel-mixer',
      status: routeStatusForCommand('toneColor.setChannelMixer'),
    },
    {
      commandType: 'toneColor.setColorBalanceRgb',
      ...dryRunRoute,
      inputSchemaName,
      reason:
        'RGB color balance dry-runs use the generic tone/color command tool with range-weighted runtime validation.',
      runtimeCheckScript: 'check:color-balance-rgb',
      status: routeStatusForCommand('toneColor.setColorBalanceRgb'),
    },
    {
      commandType: 'toneColor.setColorBalanceRgb',
      ...applyRoute,
      inputSchemaName,
      reason:
        'RGB color balance applies reuse the approved tone/color apply tool and persist an undoable edit graph update.',
      runtimeCheckScript: 'check:color-balance-rgb',
      status: routeStatusForCommand('toneColor.setColorBalanceRgb'),
    },
    {
      commandType: 'toneColor.setBlackWhiteMixer',
      ...dryRunRoute,
      inputSchemaName,
      reason:
        'Black and white mixer dry-runs use the generic tone/color command tool with hue-weighted runtime validation.',
      runtimeCheckScript: 'check:black-white-mixer',
      status: routeStatusForCommand('toneColor.setBlackWhiteMixer'),
    },
    {
      commandType: 'toneColor.setBlackWhiteMixer',
      ...applyRoute,
      inputSchemaName,
      reason:
        'Black and white mixer applies reuse the approved tone/color apply tool and persist an undoable edit graph update.',
      runtimeCheckScript: 'check:black-white-mixer',
      status: routeStatusForCommand('toneColor.setBlackWhiteMixer'),
    },
  ],
  schemaVersion: 1,
});

export const TONE_COLOR_APP_SERVER_ROUTES = TONE_COLOR_APP_SERVER_ROUTE_MANIFEST.routes;
