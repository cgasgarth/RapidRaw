import { AI_APP_SERVER_TOOL_ROUTES } from './aiAppServerToolRoutes';
import { COMPUTATIONAL_MERGE_APP_SERVER_ROUTES } from './computationalMergeAppServerRoutes';
import { FILM_LOOK_APP_SERVER_ROUTE_MANIFEST } from './filmLookAppServerRoutes';
import { NEGATIVE_LAB_APP_SERVER_ROUTE_MANIFEST } from './negativeLabAppServerRoutes';
import { TONE_COLOR_APP_SERVER_ROUTES } from './toneColorAppServerRoutes';
import {
  AgentRuntimeId,
  rawEngineAppServerAuditEntrySchema,
  rawEngineAppServerCapabilitiesReplaySchema,
  rawEngineAppServerCapabilitiesResponseSchema,
  rawEngineAppServerHealthReplaySchema,
  rawEngineAppServerHealthResponseSchema,
  rawEngineAppServerHostManifestSchema,
  rawEngineAppServerRouteCatalogEntrySchema,
  rawEngineAppServerRouteCatalogReplaySchema,
  rawEngineAppServerRouteCatalogResponseSchema,
  rawEngineAppServerHostRequestSchema,
  rawEngineAppServerHostResponseEnvelopeSchema,
  rawEngineAppServerHostResponseSchema,
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
  type RawEngineAppServerRouteCatalogEntry,
  type RawEngineAppServerRouteCatalogReplay,
  type RawEngineAppServerRouteCatalogRequest,
  type RawEngineAppServerRouteCatalogResponse,
  type RawEngineAppServerRouteFamily,
  type RawEngineAppServerRouteMode,
} from '../schemas/agentRuntimeSchemas';

export const RAW_ENGINE_APP_SERVER_HOST_MANIFEST = rawEngineAppServerHostManifestSchema.parse({
  protocol: 'codex_app_server',
  schemaVersion: 1,
  tools: [
    {
      inputSchemaName: 'RawEngineAppServerHealthRequestV1',
      mutates: false,
      outputSchemaName: 'RawEngineAppServerHealthResponseV1',
      toolKind: 'read',
      toolName: 'rawengine.host.health',
    },
    {
      inputSchemaName: 'RawEngineAppServerCapabilitiesRequestV1',
      mutates: false,
      outputSchemaName: 'RawEngineAppServerCapabilitiesResponseV1',
      toolKind: 'read',
      toolName: 'rawengine.host.capabilities',
    },
    {
      inputSchemaName: 'RawEngineAppServerRouteCatalogRequestV1',
      mutates: false,
      outputSchemaName: 'RawEngineAppServerRouteCatalogResponseV1',
      toolKind: 'read',
      toolName: 'rawengine.host.route_catalog',
    },
  ],
  transport: 'stdio_jsonl',
});

const uniqueSorted = (values: Iterable<string>): string[] => [...new Set(values)].sort((a, b) => a.localeCompare(b));

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
  modes: Iterable<RawEngineAppServerRouteMode>;
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
  const toneColorCommandNames = uniqueSorted(TONE_COLOR_APP_SERVER_ROUTES.map((route) => route.commandType));
  for (const commandName of toneColorCommandNames) {
    const routes = TONE_COLOR_APP_SERVER_ROUTES.filter((route) => route.commandType === commandName);
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
        modes: ['host_command'],
        outputSchemaNames: [route.outputSchemaName],
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
        modes: ['host_command'],
        outputSchemaNames: [route.outputSchemaName],
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
        modes: route.executionMode === undefined ? ['mapped_invoke'] : [route.executionMode],
        outputSchemaNames: route.outputSchemaName === undefined ? ['AiToolRouteResultV1'] : [route.outputSchemaName],
        toolNames: route.appServerToolName === undefined ? [route.sourceOperation] : [route.appServerToolName],
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
    status: 'ok',
    transport: RAW_ENGINE_APP_SERVER_HOST_MANIFEST.transport,
  });

export const buildRawEngineAppServerCapabilitiesResponse = ({
  requestId,
}: RawEngineAppServerCapabilitiesRequest): RawEngineAppServerCapabilitiesResponse =>
  rawEngineAppServerCapabilitiesResponseSchema.parse({
    requestId,
    runtime: AgentRuntimeId.AppServer,
    status: 'ok',
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
    status: 'ok',
    transport: RAW_ENGINE_APP_SERVER_HOST_MANIFEST.transport,
  });

export const handleRawEngineAppServerHostRequest = (request: unknown): RawEngineAppServerHostResponse => {
  const parsedRequest: RawEngineAppServerHostRequest = rawEngineAppServerHostRequestSchema.parse(request);

  switch (parsedRequest.toolName) {
    case 'rawengine.host.capabilities':
      return rawEngineAppServerHostResponseSchema.parse(buildRawEngineAppServerCapabilitiesResponse(parsedRequest));
    case 'rawengine.host.health':
      return rawEngineAppServerHostResponseSchema.parse(buildRawEngineAppServerHealthResponse(parsedRequest));
    case 'rawengine.host.route_catalog':
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
    status: 'ok',
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
    outcome: 'success',
    requestId,
    timestampIso,
    toolKind: 'read',
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
