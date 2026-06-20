import { AI_APP_SERVER_TOOL_ROUTES } from './aiAppServerToolRoutes';
import { COMPUTATIONAL_MERGE_APP_SERVER_ROUTES } from './computationalMergeAppServerRoutes';
import { DETAIL_APP_SERVER_ROUTES } from './detailAppServerRoutes';
import { FILM_LOOK_APP_SERVER_ROUTE_MANIFEST } from './filmLookAppServerRoutes';
import { NEGATIVE_LAB_APP_SERVER_ROUTE_MANIFEST } from './negativeLabAppServerRoutes';
import { ToneColorAppServerRouteStatus } from './toneColorAppServerRouteIds';
import { TONE_COLOR_APP_SERVER_ROUTES } from './toneColorAppServerRoutes';
import {
  AgentRuntimeId,
  RawEngineAppServerAuditOutcome,
  RawEngineAppServerHostToolName,
  RawEngineAppServerLifecyclePhase,
  RawEngineAppServerProtocol,
  RawEngineAppServerResponseStatus,
  RawEngineAppServerRouteMode,
  RawEngineAppServerSupervisorEventKind,
  RawEngineAppServerSupervisorPhase,
  RawEngineAppServerToolKind,
  RawEngineAppServerTransport,
  rawEngineAppServerAuditEntrySchema,
  rawEngineAppServerCapabilitiesReplaySchema,
  rawEngineAppServerCapabilitiesResponseSchema,
  rawEngineAppServerHealthReplaySchema,
  rawEngineAppServerHealthResponseSchema,
  rawEngineAppServerHostManifestSchema,
  rawEngineAppServerRouteCatalogEntrySchema,
  rawEngineAppServerRouteCatalogReplaySchema,
  rawEngineAppServerRouteCatalogResponseSchema,
  rawEngineAppServerLifecycleReplaySchema,
  rawEngineAppServerLifecycleStateSchema,
  rawEngineAppServerStructuredErrorSchema,
  rawEngineAppServerSupervisorStateSchema,
  rawEngineAppServerHostRequestSchema,
  rawEngineAppServerHostResponseEnvelopeSchema,
  rawEngineAppServerHostResponseSchema,
  type RawEngineAppServerClientInfo,
  type RawEngineAppServerAuditEntry,
  type RawEngineAppServerCapabilitiesReplay,
  type RawEngineAppServerCapabilitiesRequest,
  type RawEngineAppServerCapabilitiesResponse,
  type RawEngineAppServerHealthReplay,
  type RawEngineAppServerHealthRequest,
  type RawEngineAppServerHealthResponse,
  type RawEngineAppServerHostManifest,
  type RawEngineAppServerHostRequest,
  type RawEngineAppServerHostResponse,
  type RawEngineAppServerHostResponseEnvelope,
  type RawEngineAppServerLifecycleReplay,
  type RawEngineAppServerLifecycleState,
  type RawEngineAppServerStructuredError,
  type RawEngineAppServerSupervisorState,
  type RawEngineAppServerRouteCatalogEntry,
  type RawEngineAppServerRouteCatalogReplay,
  type RawEngineAppServerRouteCatalogRequest,
  type RawEngineAppServerRouteCatalogResponse,
  type RawEngineAppServerRouteFamily,
  type RawEngineAppServerRouteMode as RawEngineAppServerRouteModeValue,
} from '../schemas/agentRuntimeSchemas';

export const RAW_ENGINE_APP_SERVER_HOST_MANIFEST = rawEngineAppServerHostManifestSchema.parse({
  protocol: RawEngineAppServerProtocol.CodexAppServer,
  schemaVersion: 1,
  tools: [
    {
      inputSchemaName: 'RawEngineAppServerHealthRequestV1',
      mutates: false,
      outputSchemaName: 'RawEngineAppServerHealthResponseV1',
      toolKind: RawEngineAppServerToolKind.Read,
      toolName: RawEngineAppServerHostToolName.Health,
    },
    {
      inputSchemaName: 'RawEngineAppServerCapabilitiesRequestV1',
      mutates: false,
      outputSchemaName: 'RawEngineAppServerCapabilitiesResponseV1',
      toolKind: RawEngineAppServerToolKind.Read,
      toolName: RawEngineAppServerHostToolName.Capabilities,
    },
    {
      inputSchemaName: 'RawEngineAppServerRouteCatalogRequestV1',
      mutates: false,
      outputSchemaName: 'RawEngineAppServerRouteCatalogResponseV1',
      toolKind: RawEngineAppServerToolKind.Read,
      toolName: RawEngineAppServerHostToolName.RouteCatalog,
    },
  ],
  transport: RawEngineAppServerTransport.StdioJsonl,
});

export const createRawEngineAppServerLifecycleState = ({
  connectionId,
}: {
  connectionId: string;
}): RawEngineAppServerLifecycleState =>
  rawEngineAppServerLifecycleStateSchema.parse({
    clientInfo: null,
    connectionId,
    initializedAtIso: null,
    phase: RawEngineAppServerLifecyclePhase.Created,
    schemaVersion: 1,
    stoppedAtIso: null,
    transport: RAW_ENGINE_APP_SERVER_HOST_MANIFEST.transport,
  });

export const initializeRawEngineAppServerLifecycle = ({
  clientInfo,
  state,
  timestampIso,
}: {
  clientInfo: RawEngineAppServerClientInfo;
  state: RawEngineAppServerLifecycleState;
  timestampIso: string;
}): RawEngineAppServerLifecycleState => {
  if (state.phase !== RawEngineAppServerLifecyclePhase.Created) {
    throw new Error(`RawEngine app-server lifecycle cannot initialize from ${state.phase}.`);
  }

  return rawEngineAppServerLifecycleStateSchema.parse({
    ...state,
    clientInfo,
    initializedAtIso: timestampIso,
    phase: RawEngineAppServerLifecyclePhase.Initialized,
  });
};

export const stopRawEngineAppServerLifecycle = ({
  state,
  timestampIso,
}: {
  state: RawEngineAppServerLifecycleState;
  timestampIso: string;
}): RawEngineAppServerLifecycleState => {
  if (state.phase === RawEngineAppServerLifecyclePhase.Created) {
    throw new Error('RawEngine app-server lifecycle cannot stop before initialize.');
  }

  return rawEngineAppServerLifecycleStateSchema.parse({
    ...state,
    phase: RawEngineAppServerLifecyclePhase.Stopped,
    stoppedAtIso: timestampIso,
  });
};

export const assertRawEngineAppServerLifecycleReady = (state: RawEngineAppServerLifecycleState): void => {
  if (state.phase !== RawEngineAppServerLifecyclePhase.Initialized) {
    throw new Error(`RawEngine app-server request rejected while lifecycle is ${state.phase}.`);
  }
};

const appendRawEngineAppServerSupervisorEvent = ({
  kind,
  phase,
  state,
  timestampIso,
}: {
  kind: RawEngineAppServerSupervisorState['auditEvents'][number]['kind'];
  phase: RawEngineAppServerSupervisorState['phase'];
  state: RawEngineAppServerSupervisorState;
  timestampIso: string;
}): RawEngineAppServerSupervisorState['auditEvents'] => [...state.auditEvents, { kind, phase, timestampIso }];

export const createRawEngineAppServerSupervisorState = ({
  command,
  supervisorId,
  timestampIso,
}: {
  command: string[];
  supervisorId: string;
  timestampIso: string;
}): RawEngineAppServerSupervisorState =>
  rawEngineAppServerSupervisorStateSchema.parse({
    auditEvents: [
      {
        kind: RawEngineAppServerSupervisorEventKind.Created,
        phase: RawEngineAppServerSupervisorPhase.Idle,
        timestampIso,
      },
    ],
    cancellationRequestedAtIso: null,
    command,
    error: null,
    lastTransitionAtIso: timestampIso,
    phase: RawEngineAppServerSupervisorPhase.Idle,
    processId: null,
    schemaVersion: 1,
    startedAtIso: null,
    stoppedAtIso: null,
    supervisorId,
    transport: RAW_ENGINE_APP_SERVER_HOST_MANIFEST.transport,
  });

export const startRawEngineAppServerSupervisor = ({
  processId,
  state,
  timestampIso,
}: {
  processId: number;
  state: RawEngineAppServerSupervisorState;
  timestampIso: string;
}): RawEngineAppServerSupervisorState => {
  if (
    state.phase !== RawEngineAppServerSupervisorPhase.Idle &&
    state.phase !== RawEngineAppServerSupervisorPhase.Stopped
  ) {
    throw new Error(`RawEngine app-server supervisor cannot start from ${state.phase}.`);
  }

  return rawEngineAppServerSupervisorStateSchema.parse({
    ...state,
    auditEvents: appendRawEngineAppServerSupervisorEvent({
      kind: RawEngineAppServerSupervisorEventKind.Start,
      phase: RawEngineAppServerSupervisorPhase.Starting,
      state,
      timestampIso,
    }),
    error: null,
    lastTransitionAtIso: timestampIso,
    phase: RawEngineAppServerSupervisorPhase.Starting,
    processId,
    startedAtIso: timestampIso,
    stoppedAtIso: null,
  });
};

export const markRawEngineAppServerSupervisorReady = ({
  state,
  timestampIso,
}: {
  state: RawEngineAppServerSupervisorState;
  timestampIso: string;
}): RawEngineAppServerSupervisorState => {
  if (state.phase !== RawEngineAppServerSupervisorPhase.Starting) {
    throw new Error(`RawEngine app-server supervisor cannot become ready from ${state.phase}.`);
  }

  return rawEngineAppServerSupervisorStateSchema.parse({
    ...state,
    auditEvents: appendRawEngineAppServerSupervisorEvent({
      kind: RawEngineAppServerSupervisorEventKind.Ready,
      phase: RawEngineAppServerSupervisorPhase.Running,
      state,
      timestampIso,
    }),
    lastTransitionAtIso: timestampIso,
    phase: RawEngineAppServerSupervisorPhase.Running,
  });
};

export const cancelRawEngineAppServerSupervisor = ({
  state,
  timestampIso,
}: {
  state: RawEngineAppServerSupervisorState;
  timestampIso: string;
}): RawEngineAppServerSupervisorState => {
  if (
    state.phase !== RawEngineAppServerSupervisorPhase.Running &&
    state.phase !== RawEngineAppServerSupervisorPhase.Starting
  ) {
    throw new Error(`RawEngine app-server supervisor cannot cancel from ${state.phase}.`);
  }

  return rawEngineAppServerSupervisorStateSchema.parse({
    ...state,
    auditEvents: appendRawEngineAppServerSupervisorEvent({
      kind: RawEngineAppServerSupervisorEventKind.Cancel,
      phase: RawEngineAppServerSupervisorPhase.Stopping,
      state,
      timestampIso,
    }),
    cancellationRequestedAtIso: timestampIso,
    lastTransitionAtIso: timestampIso,
    phase: RawEngineAppServerSupervisorPhase.Stopping,
  });
};

export const stopRawEngineAppServerSupervisor = ({
  state,
  timestampIso,
}: {
  state: RawEngineAppServerSupervisorState;
  timestampIso: string;
}): RawEngineAppServerSupervisorState => {
  if (
    state.phase !== RawEngineAppServerSupervisorPhase.Running &&
    state.phase !== RawEngineAppServerSupervisorPhase.Starting &&
    state.phase !== RawEngineAppServerSupervisorPhase.Stopping
  ) {
    throw new Error(`RawEngine app-server supervisor cannot stop from ${state.phase}.`);
  }

  return rawEngineAppServerSupervisorStateSchema.parse({
    ...state,
    auditEvents: appendRawEngineAppServerSupervisorEvent({
      kind: RawEngineAppServerSupervisorEventKind.Stop,
      phase: RawEngineAppServerSupervisorPhase.Stopped,
      state,
      timestampIso,
    }),
    lastTransitionAtIso: timestampIso,
    phase: RawEngineAppServerSupervisorPhase.Stopped,
    processId: null,
    stoppedAtIso: timestampIso,
  });
};

export const failRawEngineAppServerSupervisor = ({
  error,
  state,
  timestampIso,
}: {
  error: RawEngineAppServerStructuredError;
  state: RawEngineAppServerSupervisorState;
  timestampIso: string;
}): RawEngineAppServerSupervisorState => {
  const parsedError = rawEngineAppServerStructuredErrorSchema.parse(error);
  if (
    state.phase !== RawEngineAppServerSupervisorPhase.Starting &&
    state.phase !== RawEngineAppServerSupervisorPhase.Running &&
    state.phase !== RawEngineAppServerSupervisorPhase.Stopping
  ) {
    throw new Error(`RawEngine app-server supervisor cannot fail from ${state.phase}.`);
  }

  return rawEngineAppServerSupervisorStateSchema.parse({
    ...state,
    auditEvents: appendRawEngineAppServerSupervisorEvent({
      kind: RawEngineAppServerSupervisorEventKind.Fail,
      phase: RawEngineAppServerSupervisorPhase.Stopped,
      state,
      timestampIso,
    }),
    error: parsedError,
    lastTransitionAtIso: timestampIso,
    phase: RawEngineAppServerSupervisorPhase.Stopped,
    processId: null,
    stoppedAtIso: timestampIso,
  });
};

export const buildRawEngineAppServerLifecycleReplay = ({
  clientInfo,
  connectionId,
  createdAtIso,
  initializedAtIso,
  stoppedAtIso,
}: {
  clientInfo: RawEngineAppServerClientInfo;
  connectionId: string;
  createdAtIso: string;
  initializedAtIso: string;
  stoppedAtIso: string;
}): RawEngineAppServerLifecycleReplay => {
  const created = createRawEngineAppServerLifecycleState({ connectionId });
  const initialized = initializeRawEngineAppServerLifecycle({
    clientInfo,
    state: created,
    timestampIso: initializedAtIso,
  });
  assertRawEngineAppServerLifecycleReady(initialized);
  const stopped = stopRawEngineAppServerLifecycle({ state: initialized, timestampIso: stoppedAtIso });

  return rawEngineAppServerLifecycleReplaySchema.parse({
    connectionId,
    events: [
      { phase: created.phase, timestampIso: createdAtIso },
      { phase: initialized.phase, timestampIso: initializedAtIso },
      { phase: stopped.phase, timestampIso: stoppedAtIso },
    ],
    finalState: stopped,
    schemaVersion: 1,
  });
};

const uniqueSorted = (values: Iterable<string>): string[] => [...new Set(values)].sort((a, b) => a.localeCompare(b));

const aiRuntimeCheckScriptsForRoute = (route: (typeof AI_APP_SERVER_TOOL_ROUTES)[number]): string[] => {
  const checks = new Set<string>(['check:ai-app-server-routes']);

  if (route.toolCapability?.endsWith('_mask')) {
    checks.add('check:ai-mask-capabilities');
    checks.add('check:ai-people-masks');
    if (route.executionMode === 'apply_dry_run_plan') checks.add('check:ai-people-apply-plan');
  }

  if (route.toolCapability === 'denoise') {
    checks.add('check:ai-denoise-app-server-tool');
    checks.add('check:ai-denoise-runtime-apply');
  }

  return uniqueSorted(checks);
};

const filmLookRuntimeCheckScripts = ['check:film-look-app-server-routes'];
const negativeLabRuntimeCheckScripts = ['check:negative-lab-app-server-routes'];

const buildRouteCatalogEntry = ({
  commandName,
  family,
  inputSchemaNames,
  modes,
  outputSchemaNames,
  runtimeCheckScripts,
  toolNames,
}: {
  commandName: string;
  family: RawEngineAppServerRouteFamily;
  inputSchemaNames: Iterable<string>;
  modes: Iterable<RawEngineAppServerRouteModeValue>;
  outputSchemaNames: Iterable<string>;
  runtimeCheckScripts?: Iterable<string>;
  toolNames: Iterable<string>;
}): RawEngineAppServerRouteCatalogEntry =>
  rawEngineAppServerRouteCatalogEntrySchema.parse({
    commandName,
    family,
    inputSchemaNames: uniqueSorted(inputSchemaNames),
    modes: uniqueSorted(modes),
    outputSchemaNames: uniqueSorted(outputSchemaNames),
    runtimeCheckScripts: uniqueSorted(runtimeCheckScripts ?? []),
    toolNames: uniqueSorted(toolNames),
  });

export const buildRawEngineAppServerRouteCatalog = (): RawEngineAppServerRouteCatalogEntry[] => {
  const catalog: RawEngineAppServerRouteCatalogEntry[] = [];
  const mappedToneColorRoutes = TONE_COLOR_APP_SERVER_ROUTES.filter(
    (route) => route.status === ToneColorAppServerRouteStatus.Mapped,
  );
  const toneColorCommandNames = uniqueSorted(mappedToneColorRoutes.map((route) => route.commandType));
  for (const commandName of toneColorCommandNames) {
    const routes = mappedToneColorRoutes.filter((route) => route.commandType === commandName);
    catalog.push(
      buildRouteCatalogEntry({
        commandName,
        family: 'tone_color',
        inputSchemaNames: routes.map((route) => route.inputSchemaName),
        modes: routes.map((route) => route.executionMode),
        outputSchemaNames: routes.map((route) => route.outputSchemaName),
        runtimeCheckScripts: routes.map((route) => route.runtimeCheckScript),
        toolNames: routes.map((route) => route.toolName),
      }),
    );
  }

  const computationalCommandNames = uniqueSorted(
    COMPUTATIONAL_MERGE_APP_SERVER_ROUTES.map((route) => route.commandType),
  );
  for (const commandName of computationalCommandNames) {
    const routes = COMPUTATIONAL_MERGE_APP_SERVER_ROUTES.filter((route) => route.commandType === commandName);
    catalog.push(
      buildRouteCatalogEntry({
        commandName,
        family: 'computational_merge',
        inputSchemaNames: routes.map((route) => route.inputSchemaName),
        modes: routes.map((route) => route.executionMode),
        outputSchemaNames: routes.map((route) => route.outputSchemaName),
        runtimeCheckScripts: routes.map((route) => route.runtimeCheckScript),
        toolNames: routes.map((route) => route.toolName),
      }),
    );
  }

  for (const route of FILM_LOOK_APP_SERVER_ROUTE_MANIFEST.routes) {
    catalog.push(
      buildRouteCatalogEntry({
        commandName: route.commandName,
        family: 'film_look',
        inputSchemaNames: [route.inputSchemaName],
        modes: [RawEngineAppServerRouteMode.HostCommand],
        outputSchemaNames: [route.outputSchemaName],
        runtimeCheckScripts: filmLookRuntimeCheckScripts,
        toolNames: [route.commandName],
      }),
    );
  }

  for (const route of NEGATIVE_LAB_APP_SERVER_ROUTE_MANIFEST.routes) {
    catalog.push(
      buildRouteCatalogEntry({
        commandName: route.commandName,
        family: 'negative_lab',
        inputSchemaNames: [route.inputSchemaName],
        modes: [RawEngineAppServerRouteMode.HostCommand],
        outputSchemaNames: [route.outputSchemaName],
        runtimeCheckScripts: negativeLabRuntimeCheckScripts,
        toolNames: [route.commandName],
      }),
    );
  }

  for (const route of AI_APP_SERVER_TOOL_ROUTES.filter((candidate) => candidate.status === 'mapped')) {
    catalog.push(
      buildRouteCatalogEntry({
        commandName: route.sourceOperation,
        family: 'ai',
        inputSchemaNames: route.commandSchemaName === undefined ? ['AiToolRouteCommandV1'] : [route.commandSchemaName],
        modes: route.executionMode === undefined ? [RawEngineAppServerRouteMode.MappedInvoke] : [route.executionMode],
        outputSchemaNames: route.outputSchemaName === undefined ? ['AiToolRouteResultV1'] : [route.outputSchemaName],
        runtimeCheckScripts: aiRuntimeCheckScriptsForRoute(route),
        toolNames: route.appServerToolName === undefined ? [route.sourceOperation] : [route.appServerToolName],
      }),
    );
  }

  for (const route of DETAIL_APP_SERVER_ROUTES) {
    catalog.push(
      buildRouteCatalogEntry({
        commandName: route.commandType,
        family: 'detail',
        inputSchemaNames: [route.inputSchemaName],
        modes: [route.executionMode],
        outputSchemaNames: [route.outputSchemaName],
        runtimeCheckScripts: [route.runtimeCheckScript],
        toolNames: [route.toolName],
      }),
    );
  }

  return catalog.sort((left, right) =>
    `${left.family}:${left.commandName}`.localeCompare(`${right.family}:${right.commandName}`),
  );
};

export const buildRawEngineAppServerHealthResponse = ({
  requestId,
}: RawEngineAppServerHealthRequest): RawEngineAppServerHealthResponse =>
  rawEngineAppServerHealthResponseSchema.parse({
    manifestToolCount: RAW_ENGINE_APP_SERVER_HOST_MANIFEST.tools.length,
    requestId,
    runtime: AgentRuntimeId.AppServer,
    status: RawEngineAppServerResponseStatus.Ok,
    transport: RAW_ENGINE_APP_SERVER_HOST_MANIFEST.transport,
  });

export const buildRawEngineAppServerCapabilitiesResponse = ({
  requestId,
}: RawEngineAppServerCapabilitiesRequest): RawEngineAppServerCapabilitiesResponse =>
  rawEngineAppServerCapabilitiesResponseSchema.parse({
    requestId,
    runtime: AgentRuntimeId.AppServer,
    status: RawEngineAppServerResponseStatus.Ok,
    tools: RAW_ENGINE_APP_SERVER_HOST_MANIFEST.tools,
    transport: RAW_ENGINE_APP_SERVER_HOST_MANIFEST.transport,
  });

export const buildRawEngineAppServerRouteCatalogResponse = ({
  requestId,
}: RawEngineAppServerRouteCatalogRequest): RawEngineAppServerRouteCatalogResponse =>
  rawEngineAppServerRouteCatalogResponseSchema.parse({
    requestId,
    routes: buildRawEngineAppServerRouteCatalog(),
    runtime: AgentRuntimeId.AppServer,
    status: RawEngineAppServerResponseStatus.Ok,
    transport: RAW_ENGINE_APP_SERVER_HOST_MANIFEST.transport,
  });

export const handleRawEngineAppServerHostRequest = (request: unknown): RawEngineAppServerHostResponse => {
  const parsedRequest: RawEngineAppServerHostRequest = rawEngineAppServerHostRequestSchema.parse(request);

  switch (parsedRequest.toolName) {
    case RawEngineAppServerHostToolName.Capabilities:
      return rawEngineAppServerHostResponseSchema.parse(buildRawEngineAppServerCapabilitiesResponse(parsedRequest));
    case RawEngineAppServerHostToolName.Health:
      return rawEngineAppServerHostResponseSchema.parse(buildRawEngineAppServerHealthResponse(parsedRequest));
    case RawEngineAppServerHostToolName.RouteCatalog:
      return rawEngineAppServerHostResponseSchema.parse(buildRawEngineAppServerRouteCatalogResponse(parsedRequest));
  }
};

export const buildRawEngineAppServerHostResponseEnvelope = (
  request: unknown,
  handledAtIso = '2026-06-17T00:00:00.000Z',
): RawEngineAppServerHostResponseEnvelope => {
  const parsedRequest = rawEngineAppServerHostRequestSchema.parse(request);

  return rawEngineAppServerHostResponseEnvelopeSchema.parse({
    handledAtIso,
    request: parsedRequest,
    response: handleRawEngineAppServerHostRequest(parsedRequest),
    schemaVersion: 1,
    status: RawEngineAppServerResponseStatus.Ok,
    transport: RAW_ENGINE_APP_SERVER_HOST_MANIFEST.transport,
  });
};

export const buildRawEngineAppServerAuditEntry = ({
  requestId,
  timestampIso,
  toolName,
}: {
  requestId: string;
  timestampIso: string;
  toolName: RawEngineAppServerHostManifest['tools'][number]['toolName'];
}): RawEngineAppServerAuditEntry =>
  rawEngineAppServerAuditEntrySchema.parse({
    affectedArtifactIds: [],
    mutates: false,
    outcome: RawEngineAppServerAuditOutcome.Success,
    requestId,
    timestampIso,
    toolKind: RawEngineAppServerToolKind.Read,
    toolName,
    transport: RAW_ENGINE_APP_SERVER_HOST_MANIFEST.transport,
  });

export const buildRawEngineAppServerHealthReplay = (
  request: RawEngineAppServerHealthRequest,
  timestampIso = '2026-06-17T00:00:00.000Z',
): RawEngineAppServerHealthReplay =>
  rawEngineAppServerHealthReplaySchema.parse({
    auditLog: [
      buildRawEngineAppServerAuditEntry({ requestId: request.requestId, timestampIso, toolName: request.toolName }),
    ],
    manifest: RAW_ENGINE_APP_SERVER_HOST_MANIFEST,
    request,
    response: buildRawEngineAppServerHealthResponse(request),
    replayId: `rawengine_app_server_health_${request.requestId}`,
    schemaVersion: 1,
  });

export const buildRawEngineAppServerCapabilitiesReplay = (
  request: RawEngineAppServerCapabilitiesRequest,
  timestampIso = '2026-06-17T00:00:00.000Z',
): RawEngineAppServerCapabilitiesReplay =>
  rawEngineAppServerCapabilitiesReplaySchema.parse({
    auditLog: [
      buildRawEngineAppServerAuditEntry({ requestId: request.requestId, timestampIso, toolName: request.toolName }),
    ],
    manifest: RAW_ENGINE_APP_SERVER_HOST_MANIFEST,
    request,
    response: buildRawEngineAppServerCapabilitiesResponse(request),
    replayId: `rawengine_app_server_capabilities_${request.requestId}`,
    schemaVersion: 1,
  });

export const buildRawEngineAppServerRouteCatalogReplay = (
  request: RawEngineAppServerRouteCatalogRequest,
  timestampIso = '2026-06-17T00:00:00.000Z',
): RawEngineAppServerRouteCatalogReplay =>
  rawEngineAppServerRouteCatalogReplaySchema.parse({
    auditLog: [
      buildRawEngineAppServerAuditEntry({ requestId: request.requestId, timestampIso, toolName: request.toolName }),
    ],
    manifest: RAW_ENGINE_APP_SERVER_HOST_MANIFEST,
    request,
    response: buildRawEngineAppServerRouteCatalogResponse(request),
    replayId: `rawengine_app_server_route_catalog_${request.requestId}`,
    schemaVersion: 1,
  });
