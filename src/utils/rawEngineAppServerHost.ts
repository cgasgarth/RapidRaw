import {
  AgentRuntimeId,
  rawEngineAppServerAuditEntrySchema,
  rawEngineAppServerCapabilitiesReplaySchema,
  rawEngineAppServerCapabilitiesResponseSchema,
  rawEngineAppServerHealthReplaySchema,
  rawEngineAppServerHealthResponseSchema,
  rawEngineAppServerHostManifestSchema,
  type RawEngineAppServerAuditEntry,
  type RawEngineAppServerCapabilitiesReplay,
  type RawEngineAppServerCapabilitiesRequest,
  type RawEngineAppServerCapabilitiesResponse,
  type RawEngineAppServerHealthReplay,
  type RawEngineAppServerHealthRequest,
  type RawEngineAppServerHealthResponse,
  type RawEngineAppServerHostManifest,
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
  ],
  transport: 'stdio_jsonl',
});

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
