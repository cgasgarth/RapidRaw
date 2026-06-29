import { z } from 'zod';

export const AgentRuntimeId = {
  AppServer: 'app-server',
} as const;

export const agentRuntimeIdSchema = z.enum([AgentRuntimeId.AppServer]);

export type AgentRuntimeId = z.infer<typeof agentRuntimeIdSchema>;

export const DEFAULT_AGENT_RUNTIME_ID: AgentRuntimeId = AgentRuntimeId.AppServer;

export const agentRuntimeSettingsSchema = z
  .object({
    agentRuntime: agentRuntimeIdSchema.default(DEFAULT_AGENT_RUNTIME_ID),
    enabled: z.boolean().default(false),
  })
  .strict();

export type AgentRuntimeSettings = z.infer<typeof agentRuntimeSettingsSchema>;

export const normalizeAgentRuntimeId = (value: unknown): AgentRuntimeId => {
  const parsed = agentRuntimeIdSchema.safeParse(value);
  return parsed.success ? parsed.data : DEFAULT_AGENT_RUNTIME_ID;
};

export const RawEngineAppServerProtocol = {
  CodexAppServer: 'codex_app_server',
} as const;

export const RawEngineAppServerTransport = {
  StdioJsonl: 'stdio_jsonl',
} as const;

export const rawEngineAppServerTransportSchema = z.enum([RawEngineAppServerTransport.StdioJsonl]);

export const RawEngineAppServerToolKind = {
  Command: 'command',
  Read: 'read',
} as const;

export const rawEngineAppServerToolKindSchema = z.enum([
  RawEngineAppServerToolKind.Command,
  RawEngineAppServerToolKind.Read,
]);

export const RawEngineAppServerAuditOutcome = {
  Rejected: 'rejected',
  Success: 'success',
} as const;

export const rawEngineAppServerAuditOutcomeSchema = z.enum([
  RawEngineAppServerAuditOutcome.Success,
  RawEngineAppServerAuditOutcome.Rejected,
]);

export const RawEngineAppServerLifecyclePhase = {
  Created: 'created',
  Initialized: 'initialized',
  Stopped: 'stopped',
} as const;

export const rawEngineAppServerLifecyclePhaseSchema = z.enum([
  RawEngineAppServerLifecyclePhase.Created,
  RawEngineAppServerLifecyclePhase.Initialized,
  RawEngineAppServerLifecyclePhase.Stopped,
]);

export const RawEngineAppServerSupervisorPhase = {
  Idle: 'idle',
  Running: 'running',
  Starting: 'starting',
  Stopped: 'stopped',
  Stopping: 'stopping',
} as const;

export const rawEngineAppServerSupervisorPhaseSchema = z.enum([
  RawEngineAppServerSupervisorPhase.Idle,
  RawEngineAppServerSupervisorPhase.Starting,
  RawEngineAppServerSupervisorPhase.Running,
  RawEngineAppServerSupervisorPhase.Stopping,
  RawEngineAppServerSupervisorPhase.Stopped,
]);

export const RawEngineAppServerSupervisorEventKind = {
  Cancel: 'cancel',
  Created: 'created',
  Fail: 'fail',
  Ready: 'ready',
  Start: 'start',
  Stop: 'stop',
} as const;

export const rawEngineAppServerSupervisorEventKindSchema = z.enum([
  RawEngineAppServerSupervisorEventKind.Created,
  RawEngineAppServerSupervisorEventKind.Start,
  RawEngineAppServerSupervisorEventKind.Ready,
  RawEngineAppServerSupervisorEventKind.Cancel,
  RawEngineAppServerSupervisorEventKind.Stop,
  RawEngineAppServerSupervisorEventKind.Fail,
]);

export const RawEngineAppServerStructuredErrorCode = {
  Cancelled: 'cancelled',
  HealthTimeout: 'health_timeout',
  SpawnFailed: 'spawn_failed',
  UnexpectedExit: 'unexpected_exit',
} as const;

export const RawEngineAppServerResponseStatus = {
  Ok: 'ok',
} as const;

export const RawEngineAppServerHostToolName = {
  Capabilities: 'rawengine.host.capabilities',
  DispatchTool: 'rawengine.host.dispatch_tool',
  Health: 'rawengine.host.health',
  RouteCatalog: 'rawengine.host.route_catalog',
} as const;

export const rawEngineAppServerHostToolNameSchema = z.enum([
  RawEngineAppServerHostToolName.Capabilities,
  RawEngineAppServerHostToolName.DispatchTool,
  RawEngineAppServerHostToolName.Health,
  RawEngineAppServerHostToolName.RouteCatalog,
]);

export const rawEngineAppServerClientInfoSchema = z
  .object({
    name: z.string().trim().min(1),
    title: z.string().trim().min(1),
    version: z.string().trim().min(1),
  })
  .strict();

export const rawEngineAppServerLifecycleStateSchema = z
  .object({
    clientInfo: rawEngineAppServerClientInfoSchema.nullable(),
    connectionId: z.string().trim().min(1),
    initializedAtIso: z.iso.datetime().nullable(),
    phase: rawEngineAppServerLifecyclePhaseSchema,
    schemaVersion: z.literal(1),
    stoppedAtIso: z.iso.datetime().nullable(),
    transport: rawEngineAppServerTransportSchema,
  })
  .strict()
  .superRefine((state, context) => {
    if (
      state.phase === RawEngineAppServerLifecyclePhase.Created &&
      (state.clientInfo !== null || state.initializedAtIso !== null)
    ) {
      context.addIssue({ code: 'custom', message: 'Created lifecycle state must not include initialized metadata.' });
    }
    if (
      state.phase === RawEngineAppServerLifecyclePhase.Initialized &&
      (state.clientInfo === null || state.initializedAtIso === null)
    ) {
      context.addIssue({ code: 'custom', message: 'Initialized lifecycle state requires client metadata.' });
    }
    if (state.phase === RawEngineAppServerLifecyclePhase.Stopped && state.stoppedAtIso === null) {
      context.addIssue({ code: 'custom', message: 'Stopped lifecycle state requires stoppedAtIso.' });
    }
  });

export const rawEngineAppServerLifecycleReplaySchema = z
  .object({
    connectionId: z.string().trim().min(1),
    events: z
      .array(
        z
          .object({
            phase: rawEngineAppServerLifecyclePhaseSchema,
            timestampIso: z.iso.datetime(),
          })
          .strict(),
      )
      .min(3),
    finalState: rawEngineAppServerLifecycleStateSchema,
    schemaVersion: z.literal(1),
  })
  .strict();

export const rawEngineAppServerStructuredErrorSchema = z
  .object({
    code: z.enum([
      RawEngineAppServerStructuredErrorCode.SpawnFailed,
      RawEngineAppServerStructuredErrorCode.HealthTimeout,
      RawEngineAppServerStructuredErrorCode.Cancelled,
      RawEngineAppServerStructuredErrorCode.UnexpectedExit,
    ]),
    message: z.string().trim().min(1),
    recoverable: z.boolean(),
  })
  .strict();

export const rawEngineAppServerSupervisorEventSchema = z
  .object({
    kind: rawEngineAppServerSupervisorEventKindSchema,
    phase: rawEngineAppServerSupervisorPhaseSchema,
    timestampIso: z.iso.datetime(),
  })
  .strict();

export const rawEngineAppServerSupervisorStateSchema = z
  .object({
    auditEvents: z.array(rawEngineAppServerSupervisorEventSchema).min(1),
    cancellationRequestedAtIso: z.iso.datetime().nullable(),
    command: z.array(z.string().trim().min(1)).min(1),
    error: rawEngineAppServerStructuredErrorSchema.nullable(),
    lastTransitionAtIso: z.iso.datetime(),
    phase: rawEngineAppServerSupervisorPhaseSchema,
    processId: z.number().int().positive().nullable(),
    schemaVersion: z.literal(1),
    startedAtIso: z.iso.datetime().nullable(),
    stoppedAtIso: z.iso.datetime().nullable(),
    supervisorId: z.string().trim().min(1),
    transport: rawEngineAppServerTransportSchema,
  })
  .strict()
  .superRefine((state, context) => {
    if (
      (state.phase === RawEngineAppServerSupervisorPhase.Running ||
        state.phase === RawEngineAppServerSupervisorPhase.Stopping) &&
      state.processId === null
    ) {
      context.addIssue({ code: 'custom', message: 'Running supervisor state requires processId.' });
    }
    if (
      (state.phase === RawEngineAppServerSupervisorPhase.Running ||
        state.phase === RawEngineAppServerSupervisorPhase.Stopping) &&
      state.startedAtIso === null
    ) {
      context.addIssue({ code: 'custom', message: 'Running supervisor state requires startedAtIso.' });
    }
    if (
      (state.phase === RawEngineAppServerSupervisorPhase.Stopped ||
        state.phase === RawEngineAppServerSupervisorPhase.Idle) &&
      state.processId !== null
    ) {
      context.addIssue({ code: 'custom', message: 'Stopped supervisor state must not retain processId.' });
    }
    if (state.phase === RawEngineAppServerSupervisorPhase.Stopped && state.stoppedAtIso === null) {
      context.addIssue({ code: 'custom', message: 'Stopped supervisor state requires stoppedAtIso.' });
    }
  });

export const rawEngineAppServerToolDefinitionSchema = z
  .object({
    inputSchemaName: z.string().trim().min(1),
    mutates: z.boolean(),
    outputSchemaName: z.string().trim().min(1),
    toolKind: rawEngineAppServerToolKindSchema,
    toolName: z
      .string()
      .trim()
      .regex(/^rawengine\.[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)*$/u),
  })
  .strict();

export const rawEngineAppServerHostManifestSchema = z
  .object({
    protocol: z.literal(RawEngineAppServerProtocol.CodexAppServer),
    schemaVersion: z.literal(1),
    transport: rawEngineAppServerTransportSchema,
    tools: z.array(rawEngineAppServerToolDefinitionSchema).min(1),
  })
  .strict();

export const rawEngineAppServerHealthRequestSchema = z
  .object({
    requestId: z.string().trim().min(1),
    toolName: z.literal(RawEngineAppServerHostToolName.Health),
  })
  .strict();

export const rawEngineAppServerCapabilitiesRequestSchema = z
  .object({
    requestId: z.string().trim().min(1),
    toolName: z.literal(RawEngineAppServerHostToolName.Capabilities),
  })
  .strict();

export const rawEngineAppServerRouteCatalogRequestSchema = z
  .object({
    requestId: z.string().trim().min(1),
    toolName: z.literal(RawEngineAppServerHostToolName.RouteCatalog),
  })
  .strict();

export const rawEngineAppServerToolDispatchRequestSchema = z
  .object({
    arguments: z.unknown(),
    draftSession: z
      .object({
        draftRevision: z.number().int().nonnegative(),
        parentRecipeHash: z.string().trim().min(1),
        selectedImagePath: z.string().trim().min(1),
        sessionId: z.string().trim().min(1),
        status: z.enum(['active', 'cancelled']),
      })
      .strict()
      .optional(),
    requestId: z.string().trim().min(1),
    runtimeToolName: z.string().trim().min(1),
    toolName: z.literal(RawEngineAppServerHostToolName.DispatchTool),
  })
  .strict();

export const rawEngineAppServerHealthResponseSchema = z
  .object({
    manifestToolCount: z.number().int().positive(),
    requestId: z.string().trim().min(1),
    runtime: z.literal(AgentRuntimeId.AppServer),
    status: z.literal(RawEngineAppServerResponseStatus.Ok),
    transport: rawEngineAppServerTransportSchema,
  })
  .strict();

export const rawEngineAppServerCapabilitiesResponseSchema = z
  .object({
    requestId: z.string().trim().min(1),
    runtime: z.literal(AgentRuntimeId.AppServer),
    status: z.literal(RawEngineAppServerResponseStatus.Ok),
    tools: z.array(rawEngineAppServerToolDefinitionSchema).min(1),
    transport: rawEngineAppServerTransportSchema,
  })
  .strict();

export const rawEngineAppServerRouteFamilySchema = z.enum([
  'agent',
  'ai',
  'computational_merge',
  'detail',
  'film_look',
  'negative_lab',
  'tone_color',
]);
export const RawEngineAppServerRouteMode = {
  ApplyDryRunPlan: 'apply_dry_run_plan',
  DryRunCommand: 'dry_run_command',
  HostCommand: 'host_command',
  MappedInvoke: 'mapped_invoke',
  OpenDerivedSource: 'open_derived_source',
  Read: 'read',
} as const;

export const rawEngineAppServerRouteModeSchema = z.enum([
  RawEngineAppServerRouteMode.ApplyDryRunPlan,
  RawEngineAppServerRouteMode.DryRunCommand,
  RawEngineAppServerRouteMode.HostCommand,
  RawEngineAppServerRouteMode.MappedInvoke,
  RawEngineAppServerRouteMode.OpenDerivedSource,
  RawEngineAppServerRouteMode.Read,
]);

export const rawEngineAppServerRouteCatalogEntrySchema = z
  .object({
    commandName: z.string().trim().min(1),
    family: rawEngineAppServerRouteFamilySchema,
    inputSchemaNames: z.array(z.string().trim().min(1)).min(1),
    modes: z.array(rawEngineAppServerRouteModeSchema).min(1),
    outputSchemaNames: z.array(z.string().trim().min(1)).min(1),
    runtimeCheckScripts: z.array(z.string().trim().min(1)),
    toolNames: z.array(z.string().trim().min(1)).min(1),
  })
  .strict();

export const rawEngineAppServerRouteCatalogResponseSchema = z
  .object({
    requestId: z.string().trim().min(1),
    routes: z.array(rawEngineAppServerRouteCatalogEntrySchema).min(1),
    runtime: z.literal(AgentRuntimeId.AppServer),
    status: z.literal(RawEngineAppServerResponseStatus.Ok),
    transport: rawEngineAppServerTransportSchema,
  })
  .strict();

export const rawEngineAppServerToolDispatchResponseSchema = z
  .object({
    commandType: z.string().trim().min(1).optional(),
    dispatchStatus: z.enum(['completed', 'rejected']),
    message: z.string().trim().min(1).optional(),
    requestId: z.string().trim().min(1),
    result: z.unknown().optional(),
    runtime: z.literal(AgentRuntimeId.AppServer),
    runtimeToolName: z.string().trim().min(1),
    status: z.literal(RawEngineAppServerResponseStatus.Ok),
    transport: rawEngineAppServerTransportSchema,
  })
  .strict();

export const rawEngineAppServerAuditEntrySchema = z
  .object({
    affectedArtifactIds: z.array(z.string().trim().min(1)),
    mutates: z.boolean(),
    outcome: rawEngineAppServerAuditOutcomeSchema,
    requestId: z.string().trim().min(1),
    timestampIso: z.iso.datetime(),
    toolKind: rawEngineAppServerToolKindSchema,
    toolName: z.string().trim().min(1),
    transport: rawEngineAppServerTransportSchema,
  })
  .strict();

export const rawEngineAppServerHealthReplaySchema = z
  .object({
    auditLog: z.array(rawEngineAppServerAuditEntrySchema).min(1),
    manifest: rawEngineAppServerHostManifestSchema,
    request: rawEngineAppServerHealthRequestSchema,
    response: rawEngineAppServerHealthResponseSchema,
    replayId: z.string().trim().min(1),
    schemaVersion: z.literal(1),
  })
  .strict();

export const rawEngineAppServerCapabilitiesReplaySchema = z
  .object({
    auditLog: z.array(rawEngineAppServerAuditEntrySchema).min(1),
    manifest: rawEngineAppServerHostManifestSchema,
    request: rawEngineAppServerCapabilitiesRequestSchema,
    response: rawEngineAppServerCapabilitiesResponseSchema,
    replayId: z.string().trim().min(1),
    schemaVersion: z.literal(1),
  })
  .strict();

export const rawEngineAppServerRouteCatalogReplaySchema = z
  .object({
    auditLog: z.array(rawEngineAppServerAuditEntrySchema).min(1),
    manifest: rawEngineAppServerHostManifestSchema,
    request: rawEngineAppServerRouteCatalogRequestSchema,
    response: rawEngineAppServerRouteCatalogResponseSchema,
    replayId: z.string().trim().min(1),
    schemaVersion: z.literal(1),
  })
  .strict();

export const rawEngineAppServerHostRequestSchema = z.discriminatedUnion('toolName', [
  rawEngineAppServerCapabilitiesRequestSchema,
  rawEngineAppServerToolDispatchRequestSchema,
  rawEngineAppServerHealthRequestSchema,
  rawEngineAppServerRouteCatalogRequestSchema,
]);

export const rawEngineAppServerHostResponseSchema = z.union([
  rawEngineAppServerCapabilitiesResponseSchema,
  rawEngineAppServerHealthResponseSchema,
  rawEngineAppServerRouteCatalogResponseSchema,
  rawEngineAppServerToolDispatchResponseSchema,
]);

export const rawEngineAppServerHostResponseEnvelopeSchema = z
  .object({
    handledAtIso: z.iso.datetime(),
    request: rawEngineAppServerHostRequestSchema,
    response: rawEngineAppServerHostResponseSchema,
    schemaVersion: z.literal(1),
    status: z.literal(RawEngineAppServerResponseStatus.Ok),
    transport: rawEngineAppServerTransportSchema,
  })
  .strict();

export type RawEngineAppServerAuditEntry = z.infer<typeof rawEngineAppServerAuditEntrySchema>;
export type RawEngineAppServerCapabilitiesReplay = z.infer<typeof rawEngineAppServerCapabilitiesReplaySchema>;
export type RawEngineAppServerCapabilitiesRequest = z.infer<typeof rawEngineAppServerCapabilitiesRequestSchema>;
export type RawEngineAppServerCapabilitiesResponse = z.infer<typeof rawEngineAppServerCapabilitiesResponseSchema>;
export type RawEngineAppServerClientInfo = z.infer<typeof rawEngineAppServerClientInfoSchema>;
export type RawEngineAppServerHealthReplay = z.infer<typeof rawEngineAppServerHealthReplaySchema>;
export type RawEngineAppServerHealthRequest = z.infer<typeof rawEngineAppServerHealthRequestSchema>;
export type RawEngineAppServerHealthResponse = z.infer<typeof rawEngineAppServerHealthResponseSchema>;
export type RawEngineAppServerHostManifest = z.infer<typeof rawEngineAppServerHostManifestSchema>;
export type RawEngineAppServerHostRequest = z.infer<typeof rawEngineAppServerHostRequestSchema>;
export type RawEngineAppServerHostResponse = z.infer<typeof rawEngineAppServerHostResponseSchema>;
export type RawEngineAppServerHostResponseEnvelope = z.infer<typeof rawEngineAppServerHostResponseEnvelopeSchema>;
export type RawEngineAppServerHostToolName = z.infer<typeof rawEngineAppServerHostToolNameSchema>;
export type RawEngineAppServerLifecycleReplay = z.infer<typeof rawEngineAppServerLifecycleReplaySchema>;
export type RawEngineAppServerLifecycleState = z.infer<typeof rawEngineAppServerLifecycleStateSchema>;
export type RawEngineAppServerStructuredError = z.infer<typeof rawEngineAppServerStructuredErrorSchema>;
export type RawEngineAppServerSupervisorState = z.infer<typeof rawEngineAppServerSupervisorStateSchema>;
export type RawEngineAppServerRouteCatalogEntry = z.infer<typeof rawEngineAppServerRouteCatalogEntrySchema>;
export type RawEngineAppServerRouteCatalogReplay = z.infer<typeof rawEngineAppServerRouteCatalogReplaySchema>;
export type RawEngineAppServerRouteCatalogRequest = z.infer<typeof rawEngineAppServerRouteCatalogRequestSchema>;
export type RawEngineAppServerRouteCatalogResponse = z.infer<typeof rawEngineAppServerRouteCatalogResponseSchema>;
export type RawEngineAppServerToolDispatchRequest = z.infer<typeof rawEngineAppServerToolDispatchRequestSchema>;
export type RawEngineAppServerToolDispatchResponse = z.infer<typeof rawEngineAppServerToolDispatchResponseSchema>;
export type RawEngineAppServerRouteFamily = z.infer<typeof rawEngineAppServerRouteFamilySchema>;
export type RawEngineAppServerRouteMode = z.infer<typeof rawEngineAppServerRouteModeSchema>;
