import {
  AgentRuntimeId,
  rawEngineAppServerAuditEntrySchema,
  rawEngineAppServerHealthReplaySchema,
  rawEngineAppServerHealthResponseSchema,
  rawEngineAppServerHostManifestSchema,
  type RawEngineAppServerAuditEntry,
  type RawEngineAppServerHealthReplay,
  type RawEngineAppServerHealthRequest,
  type RawEngineAppServerHealthResponse,
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

export const buildRawEngineAppServerAuditEntry = ({
  requestId,
  timestampIso,
}: {
  requestId: string;
  timestampIso: string;
}): RawEngineAppServerAuditEntry =>
  rawEngineAppServerAuditEntrySchema.parse({
    affectedArtifactIds: [],
    mutates: false,
    outcome: 'success',
    requestId,
    timestampIso,
    toolKind: 'read',
    toolName: 'rawengine.host.health',
    transport: RAW_ENGINE_APP_SERVER_HOST_MANIFEST.transport,
  });

export const buildRawEngineAppServerHealthReplay = (
  request: RawEngineAppServerHealthRequest,
  timestampIso = '2026-06-17T00:00:00.000Z',
): RawEngineAppServerHealthReplay =>
  rawEngineAppServerHealthReplaySchema.parse({
    auditLog: [buildRawEngineAppServerAuditEntry({ requestId: request.requestId, timestampIso })],
    manifest: RAW_ENGINE_APP_SERVER_HOST_MANIFEST,
    request,
    response: buildRawEngineAppServerHealthResponse(request),
    replayId: `rawengine_app_server_health_${request.requestId}`,
    schemaVersion: 1,
  });
