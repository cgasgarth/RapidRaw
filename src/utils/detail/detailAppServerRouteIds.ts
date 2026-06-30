export const DetailAppServerFeature = {
  Deblur: 'deblur',
} as const;

export const DETAIL_APP_SERVER_FEATURES = [DetailAppServerFeature.Deblur] as const;

export const DetailAppServerExecutionMode = {
  ApplyDryRunPlan: 'apply_dry_run_plan',
  DryRunCommand: 'dry_run_command',
} as const;

export const DETAIL_APP_SERVER_EXECUTION_MODES = [
  DetailAppServerExecutionMode.ApplyDryRunPlan,
  DetailAppServerExecutionMode.DryRunCommand,
] as const;

export const DetailAppServerRouteStatus = {
  MappedUnavailable: 'mapped_unavailable',
} as const;

export const DETAIL_APP_SERVER_ROUTE_STATUSES = [DetailAppServerRouteStatus.MappedUnavailable] as const;

export const DetailAppServerCommandType = {
  ApplyControls: 'detailDeblur.applyControls',
  DryRunControls: 'detailDeblur.dryRunControls',
} as const;

export const DETAIL_APP_SERVER_COMMAND_TYPES = [
  DetailAppServerCommandType.ApplyControls,
  DetailAppServerCommandType.DryRunControls,
] as const;

export const DetailAppServerSchemaName = {
  CommandEnvelope: 'DetailDeblurCommandEnvelopeV1',
  DryRunResult: 'DetailDeblurDryRunResultV1',
} as const;

export const DetailAppServerToolName = {
  ApplyCommand: 'detail.deblur.apply_command',
  DryRunCommand: 'detail.deblur.dry_run_command',
} as const;
