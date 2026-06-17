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

export const rawEngineAppServerTransportSchema = z.enum(['stdio_jsonl']);
export const rawEngineAppServerToolKindSchema = z.enum(['read']);
export const rawEngineAppServerAuditOutcomeSchema = z.enum(['success', 'rejected']);

export const rawEngineAppServerToolDefinitionSchema = z
  .object({
    inputSchemaName: z.string().trim().min(1),
    mutates: z.literal(false),
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
    protocol: z.literal('codex_app_server'),
    schemaVersion: z.literal(1),
    transport: rawEngineAppServerTransportSchema,
    tools: z.array(rawEngineAppServerToolDefinitionSchema).min(1),
  })
  .strict();

export const rawEngineAppServerHealthRequestSchema = z
  .object({
    requestId: z.string().trim().min(1),
    toolName: z.literal('rawengine.host.health'),
  })
  .strict();

export const rawEngineAppServerCapabilitiesRequestSchema = z
  .object({
    requestId: z.string().trim().min(1),
    toolName: z.literal('rawengine.host.capabilities'),
  })
  .strict();

export const rawEngineAppServerRouteCatalogRequestSchema = z
  .object({
    requestId: z.string().trim().min(1),
    toolName: z.literal('rawengine.host.route_catalog'),
  })
  .strict();

export const rawEngineAppServerHealthResponseSchema = z
  .object({
    manifestToolCount: z.number().int().positive(),
    requestId: z.string().trim().min(1),
    runtime: z.literal(AgentRuntimeId.AppServer),
    status: z.literal('ok'),
    transport: rawEngineAppServerTransportSchema,
  })
  .strict();

export const rawEngineAppServerCapabilitiesResponseSchema = z
  .object({
    requestId: z.string().trim().min(1),
    runtime: z.literal(AgentRuntimeId.AppServer),
    status: z.literal('ok'),
    tools: z.array(rawEngineAppServerToolDefinitionSchema).min(1),
    transport: rawEngineAppServerTransportSchema,
  })
  .strict();

export const rawEngineAppServerRouteFamilySchema = z.enum([
  'ai',
  'computational_merge',
  'film_look',
  'negative_lab',
  'tone_color',
]);
export const rawEngineAppServerRouteModeSchema = z.enum([
  'apply_dry_run_plan',
  'dry_run_command',
  'host_command',
  'mapped_invoke',
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
    status: z.literal('ok'),
    transport: rawEngineAppServerTransportSchema,
  })
  .strict();

export const rawEngineAppServerAuditEntrySchema = z
  .object({
    affectedArtifactIds: z.array(z.string().trim().min(1)),
    mutates: z.literal(false),
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
  rawEngineAppServerHealthRequestSchema,
  rawEngineAppServerRouteCatalogRequestSchema,
]);

export const rawEngineAppServerHostResponseSchema = z.union([
  rawEngineAppServerCapabilitiesResponseSchema,
  rawEngineAppServerHealthResponseSchema,
  rawEngineAppServerRouteCatalogResponseSchema,
]);

export const rawEngineAppServerHostResponseEnvelopeSchema = z
  .object({
    handledAtIso: z.iso.datetime(),
    request: rawEngineAppServerHostRequestSchema,
    response: rawEngineAppServerHostResponseSchema,
    schemaVersion: z.literal(1),
    status: z.literal('ok'),
    transport: rawEngineAppServerTransportSchema,
  })
  .strict();

export type RawEngineAppServerAuditEntry = z.infer<typeof rawEngineAppServerAuditEntrySchema>;
export type RawEngineAppServerCapabilitiesReplay = z.infer<typeof rawEngineAppServerCapabilitiesReplaySchema>;
export type RawEngineAppServerCapabilitiesRequest = z.infer<typeof rawEngineAppServerCapabilitiesRequestSchema>;
export type RawEngineAppServerCapabilitiesResponse = z.infer<typeof rawEngineAppServerCapabilitiesResponseSchema>;
export type RawEngineAppServerHealthReplay = z.infer<typeof rawEngineAppServerHealthReplaySchema>;
export type RawEngineAppServerHealthRequest = z.infer<typeof rawEngineAppServerHealthRequestSchema>;
export type RawEngineAppServerHealthResponse = z.infer<typeof rawEngineAppServerHealthResponseSchema>;
export type RawEngineAppServerHostManifest = z.infer<typeof rawEngineAppServerHostManifestSchema>;
export type RawEngineAppServerHostRequest = z.infer<typeof rawEngineAppServerHostRequestSchema>;
export type RawEngineAppServerHostResponse = z.infer<typeof rawEngineAppServerHostResponseSchema>;
export type RawEngineAppServerHostResponseEnvelope = z.infer<typeof rawEngineAppServerHostResponseEnvelopeSchema>;
export type RawEngineAppServerRouteCatalogEntry = z.infer<typeof rawEngineAppServerRouteCatalogEntrySchema>;
export type RawEngineAppServerRouteCatalogReplay = z.infer<typeof rawEngineAppServerRouteCatalogReplaySchema>;
export type RawEngineAppServerRouteCatalogRequest = z.infer<typeof rawEngineAppServerRouteCatalogRequestSchema>;
export type RawEngineAppServerRouteCatalogResponse = z.infer<typeof rawEngineAppServerRouteCatalogResponseSchema>;
export type RawEngineAppServerRouteFamily = z.infer<typeof rawEngineAppServerRouteFamilySchema>;
export type RawEngineAppServerRouteMode = z.infer<typeof rawEngineAppServerRouteModeSchema>;
