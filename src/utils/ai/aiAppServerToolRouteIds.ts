export const AiAppServerToolRouteStatus = {
  ConnectorStatus: 'connector_status',
  Deferred: 'deferred',
  Mapped: 'mapped',
  MetadataCleanup: 'metadata_cleanup',
  ModelLifecycle: 'model_lifecycle',
} as const;

export const AI_APP_SERVER_TOOL_ROUTE_STATUSES = [
  AiAppServerToolRouteStatus.Mapped,
  AiAppServerToolRouteStatus.Deferred,
  AiAppServerToolRouteStatus.ConnectorStatus,
  AiAppServerToolRouteStatus.MetadataCleanup,
  AiAppServerToolRouteStatus.ModelLifecycle,
] as const;

export const AiAppServerToolRouteSourceKind = {
  AppServerTool: 'app_server_tool',
  TauriInvoke: 'tauri_invoke',
} as const;

export const AI_APP_SERVER_TOOL_ROUTE_SOURCE_KINDS = [
  AiAppServerToolRouteSourceKind.TauriInvoke,
  AiAppServerToolRouteSourceKind.AppServerTool,
] as const;

export const AiAppServerToolRouteExecutionMode = {
  ApplyDryRunPlan: 'apply_dry_run_plan',
  DryRunCommand: 'dry_run_command',
} as const;

export const AI_APP_SERVER_TOOL_ROUTE_EXECUTION_MODES = [
  AiAppServerToolRouteExecutionMode.DryRunCommand,
  AiAppServerToolRouteExecutionMode.ApplyDryRunPlan,
] as const;

export const AiAppServerToolCapability = {
  Denoise: 'denoise',
  DepthMask: 'depth_mask',
  Enhance: 'enhance',
  ForegroundMask: 'foreground_mask',
  Inpaint: 'inpaint',
  PersonMask: 'person_mask',
  SkyMask: 'sky_mask',
  SubjectMask: 'subject_mask',
} as const;

export const AI_APP_SERVER_TOOL_CAPABILITIES = [
  AiAppServerToolCapability.DepthMask,
  AiAppServerToolCapability.Denoise,
  AiAppServerToolCapability.Enhance,
  AiAppServerToolCapability.ForegroundMask,
  AiAppServerToolCapability.Inpaint,
  AiAppServerToolCapability.PersonMask,
  AiAppServerToolCapability.SkyMask,
  AiAppServerToolCapability.SubjectMask,
] as const;

export const AiAppServerToolName = {
  EnhancementApplyCommand: 'ai.enhancement.apply_command',
  EnhancementDryRunCommand: 'ai.enhancement.dry_run_command',
  MaskApplySubject: 'ai.mask.apply_subject',
  MaskDryRunSubject: 'ai.mask.dry_run_subject',
} as const;

export const AiAppServerToolSchemaName = {
  EnhancementApplyResult: 'AiEnhancementApplyResultV1',
  EnhancementCommandEnvelope: 'AiEnhancementCommandEnvelopeV1',
  EnhancementDryRunResult: 'AiEnhancementDryRunResultV1',
  ToolApplyResult: 'AiToolApplyResultV1',
  ToolCommandEnvelope: 'AiToolCommandEnvelopeV1',
  ToolDryRunResult: 'AiToolDryRunResultV1',
} as const;
