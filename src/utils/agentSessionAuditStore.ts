import { z } from 'zod';

export const agentArtifactLineageEntrySchema = z
  .object({
    artifactId: z.string().trim().min(1),
    contentHash: z.string().trim().min(1),
    graphRevision: z.string().trim().min(1),
    sourceToolCallId: z.string().trim().min(1),
  })
  .strict();

export const agentSessionAuditRecordSchema = z
  .object({
    approvalId: z.string().trim().min(1),
    artifactLineage: z.array(agentArtifactLineageEntrySchema).min(1),
    finalGraphRevision: z.string().trim().min(1),
    initialGraphRevision: z.string().trim().min(1),
    planSummary: z.string().trim().min(1),
    prompt: z.string().trim().min(1),
    rollbackGraphRevision: z.string().trim().min(1),
    sessionId: z.string().trim().min(1),
    toolCalls: z.array(z.object({ id: z.string().trim().min(1), name: z.string().trim().min(1) }).strict()).min(1),
  })
  .strict();

export const agentSessionAuditStoreSchema = z
  .object({
    records: z.array(agentSessionAuditRecordSchema),
    schemaVersion: z.literal(1),
  })
  .strict();

export type AgentSessionAuditRecord = z.infer<typeof agentSessionAuditRecordSchema>;
export type AgentSessionAuditStore = z.infer<typeof agentSessionAuditStoreSchema>;

export interface AgentSessionAuditStorageAdapter {
  readText: () => string | null;
  writeText: (value: string) => void;
}

export const parseAgentSessionAuditStore = (value: string | null): AgentSessionAuditStore => {
  if (value === null) return { records: [], schemaVersion: 1 };
  return agentSessionAuditStoreSchema.parse(JSON.parse(value));
};

export const readAgentSessionAuditStore = (adapter: AgentSessionAuditStorageAdapter): AgentSessionAuditStore =>
  parseAgentSessionAuditStore(adapter.readText());

export const appendAgentSessionAuditRecord = (
  adapter: AgentSessionAuditStorageAdapter,
  record: AgentSessionAuditRecord,
): AgentSessionAuditStore => {
  const store = readAgentSessionAuditStore(adapter);
  const nextStore = agentSessionAuditStoreSchema.parse({
    records: [...store.records, agentSessionAuditRecordSchema.parse(record)],
    schemaVersion: 1,
  });
  adapter.writeText(JSON.stringify(nextStore));
  return nextStore;
};

export const verifyAgentSessionArtifactLineage = (record: AgentSessionAuditRecord): void => {
  const toolCallIds = new Set(record.toolCalls.map((toolCall) => toolCall.id));
  for (const artifact of record.artifactLineage) {
    if (!toolCallIds.has(artifact.sourceToolCallId)) {
      throw new Error(`Artifact ${artifact.artifactId} is not linked to a persisted tool call.`);
    }
  }
};
