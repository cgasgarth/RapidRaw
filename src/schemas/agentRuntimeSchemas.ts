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

export const rawEngineAppServerHealthResponseSchema = z
  .object({
    manifestToolCount: z.number().int().positive(),
    requestId: z.string().trim().min(1),
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

export type RawEngineAppServerAuditEntry = z.infer<typeof rawEngineAppServerAuditEntrySchema>;
export type RawEngineAppServerHealthReplay = z.infer<typeof rawEngineAppServerHealthReplaySchema>;
export type RawEngineAppServerHealthRequest = z.infer<typeof rawEngineAppServerHealthRequestSchema>;
export type RawEngineAppServerHealthResponse = z.infer<typeof rawEngineAppServerHealthResponseSchema>;
export type RawEngineAppServerHostManifest = z.infer<typeof rawEngineAppServerHostManifestSchema>;
