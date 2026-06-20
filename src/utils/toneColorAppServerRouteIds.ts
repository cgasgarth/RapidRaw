export const TONE_COLOR_APP_SERVER_COMMAND_TYPES = [
  'toneColor.setBasicTone',
  'toneColor.setToneCurve',
  'toneColor.setWhiteBalance',
  'toneColor.adjustHsl',
  'toneColor.setColorGrading',
  'toneColor.setLevels',
  'toneColor.setChannelMixer',
  'toneColor.setColorBalanceRgb',
  'toneColor.setBlackWhiteMixer',
] as const;

export type ToneColorAppServerCommandType = (typeof TONE_COLOR_APP_SERVER_COMMAND_TYPES)[number];

export const ToneColorAppServerExecutionMode = {
  ApplyDryRunPlan: 'apply_dry_run_plan',
  DryRunCommand: 'dry_run_command',
} as const;

export type ToneColorAppServerExecutionMode =
  (typeof ToneColorAppServerExecutionMode)[keyof typeof ToneColorAppServerExecutionMode];

export const TONE_COLOR_APP_SERVER_EXECUTION_MODES = [
  ToneColorAppServerExecutionMode.DryRunCommand,
  ToneColorAppServerExecutionMode.ApplyDryRunPlan,
] as const;

export const ToneColorAppServerRouteStatus = {
  Mapped: 'mapped',
  MappedUnavailable: 'mapped_unavailable',
} as const;

export type ToneColorAppServerRouteStatus =
  (typeof ToneColorAppServerRouteStatus)[keyof typeof ToneColorAppServerRouteStatus];

export const TONE_COLOR_APP_SERVER_ROUTE_STATUSES = [
  ToneColorAppServerRouteStatus.Mapped,
  ToneColorAppServerRouteStatus.MappedUnavailable,
] as const;

export const ToneColorAppServerSchemaName = {
  CommandEnvelope: 'ToneColorCommandEnvelopeV1',
  DryRunResult: 'ToneColorDryRunResultV1',
  MutationResult: 'ToneColorMutationResultV1',
} as const;

export const TONE_COLOR_APP_SERVER_OUTPUT_SCHEMA_NAMES = [
  ToneColorAppServerSchemaName.DryRunResult,
  ToneColorAppServerSchemaName.MutationResult,
] as const;

export const ToneColorAppServerToolName = {
  ApplyCommand: 'tonecolor.apply_command',
  DryRunCommand: 'tonecolor.dry_run_command',
} as const;

export const TONE_COLOR_APP_SERVER_TOOL_NAMES = [
  ToneColorAppServerToolName.DryRunCommand,
  ToneColorAppServerToolName.ApplyCommand,
] as const;
