import { z } from 'zod';

export const agentArtifactLineageEntrySchema = z
  .object({
    artifactId: z.string().trim().min(1),
    contentHash: z.string().trim().min(1),
    graphRevision: z.string().trim().min(1),
    sourceToolCallId: z.string().trim().min(1),
  })
  .strict();

export const agentSessionTraceEventSchema = z
  .object({
    approvalId: z.string().trim().min(1).optional(),
    errorCode: z.string().trim().min(1).optional(),
    graphRevision: z.string().trim().min(1).optional(),
    id: z.string().trim().min(1),
    kind: z.enum([
      'approval',
      'error',
      'export',
      'preview',
      'prompt',
      'recipe_hash',
      'rollback',
      'tool_call',
      'tool_result',
    ]),
    message: z.string().trim().min(1).optional(),
    previewRef: z.string().trim().min(1).optional(),
    recipeHash: z.string().trim().min(1).optional(),
    renderHash: z.string().trim().min(1).optional(),
    timestamp: z.string().trim().min(1),
    toolCallId: z.string().trim().min(1).optional(),
  })
  .strict();

export const agentSessionAuditRecordSchema = z
  .object({
    approvalId: z.string().trim().min(1),
    artifactLineage: z.array(agentArtifactLineageEntrySchema).min(1),
    finalGraphRevision: z.string().trim().min(1),
    initialGraphRevision: z.string().trim().min(1),
    modelId: z.string().trim().min(1),
    planSummary: z.string().trim().min(1),
    prompt: z.string().trim().min(1),
    rollbackGraphRevision: z.string().trim().min(1),
    sessionId: z.string().trim().min(1),
    toolCalls: z
      .array(
        z
          .object({
            errorCode: z.string().trim().min(1).optional(),
            id: z.string().trim().min(1),
            name: z.string().trim().min(1),
            resultSummary: z.string().trim().min(1).optional(),
            status: z.enum(['failed', 'rejected', 'succeeded']).optional(),
          })
          .strict(),
      )
      .min(1),
    traceEvents: z.array(agentSessionTraceEventSchema).min(1),
  })
  .strict();

export const agentSessionAuditStoreSchema = z
  .object({
    records: z.array(agentSessionAuditRecordSchema),
    schemaVersion: z.literal(1),
  })
  .strict();

export const agentSelectedImageExportReceiptSchema = z
  .object({
    approvalId: z.string().trim().min(1),
    beforePreviewArtifact: z
      .object({
        artifactId: z.string().trim().min(1),
        contentHash: z.string().trim().min(1),
        graphRevision: z.string().trim().min(1),
        previewRef: z.string().trim().min(1),
        recipeHash: z.string().trim().min(1),
        renderHash: z.string().trim().min(1),
      })
      .strict(),
    currentPreviewArtifact: z
      .object({
        artifactId: z.string().trim().min(1),
        contentHash: z.string().trim().min(1),
        graphRevision: z.string().trim().min(1),
        previewRef: z.string().trim().min(1),
        recipeHash: z.string().trim().min(1),
        renderHash: z.string().trim().min(1),
      })
      .strict(),
    exportSettings: z
      .object({
        colorProfile: z.string().trim().min(1),
        fileFormat: z.enum(['jpeg', 'png']),
        jpegQuality: z.number().int().min(50).max(95),
        longEdgePx: z.number().int().min(512).max(8192),
        renderingIntent: z.string().trim().min(1),
      })
      .strict(),
    finalGraphRevision: z.string().trim().min(1),
    finalRecipeHash: z.string().trim().min(1),
    initialGraphRevision: z.string().trim().min(1),
    initialRecipeHash: z.string().trim().min(1),
    noOverwritePolicy: z.literal('never_overwrite_original'),
    outputHash: z.string().trim().min(1),
    outputPath: z.string().trim().min(1),
    prompt: z.string().trim().min(1),
    requestId: z.string().trim().min(1),
    rollback: z
      .object({
        checkpointGraphRevision: z.string().trim().min(1),
        receiptGraphRevision: z.string().trim().min(1).optional(),
        status: z.enum(['available', 'restored']),
      })
      .strict(),
    selectedRawPath: z.string().trim().min(1),
    sessionId: z.string().trim().min(1),
    toolName: z.literal('rawengine.agent.export.final'),
  })
  .strict();

export type AgentSessionAuditRecord = z.infer<typeof agentSessionAuditRecordSchema>;
export type AgentSessionAuditStore = z.infer<typeof agentSessionAuditStoreSchema>;
export type AgentSessionTraceEvent = z.infer<typeof agentSessionTraceEventSchema>;
export type AgentSelectedImageExportReceipt = z.infer<typeof agentSelectedImageExportReceiptSchema>;

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

const privatePathPattern = /(?:\/Users\/[^\s"']+|\/var\/folders\/[^\s"']+|[A-Za-z]:\\[^\s"']+)/gu;

export const redactAgentTraceText = (value: string): string =>
  value.replace(privatePathPattern, '[redacted-local-path]');

export const createShareableAgentSessionAuditRecord = (record: AgentSessionAuditRecord): AgentSessionAuditRecord => {
  const parsedRecord = agentSessionAuditRecordSchema.parse(record);
  return agentSessionAuditRecordSchema.parse({
    ...parsedRecord,
    planSummary: redactAgentTraceText(parsedRecord.planSummary),
    prompt: redactAgentTraceText(parsedRecord.prompt),
    toolCalls: parsedRecord.toolCalls.map((toolCall) => ({
      ...toolCall,
      resultSummary: toolCall.resultSummary === undefined ? undefined : redactAgentTraceText(toolCall.resultSummary),
    })),
    traceEvents: parsedRecord.traceEvents.map((event) => ({
      ...event,
      message: event.message === undefined ? undefined : redactAgentTraceText(event.message),
      previewRef: event.previewRef === undefined ? undefined : redactAgentTraceText(event.previewRef),
    })),
  });
};

export const assertAgentSessionTraceShareable = (record: AgentSessionAuditRecord): void => {
  const shareableText = JSON.stringify(record);
  if (privatePathPattern.test(shareableText)) {
    throw new Error('Agent session trace contains an unredacted local path.');
  }
};

export const appendAgentSessionAuditRecord = (
  adapter: AgentSessionAuditStorageAdapter,
  record: AgentSessionAuditRecord,
): AgentSessionAuditStore => {
  const store = readAgentSessionAuditStore(adapter);
  const shareableRecord = createShareableAgentSessionAuditRecord(record);
  verifyAgentSessionArtifactLineage(shareableRecord);
  verifyAgentSessionTraceReferences(shareableRecord);
  assertAgentSessionTraceShareable(shareableRecord);
  const nextStore = agentSessionAuditStoreSchema.parse({
    records: [...store.records, shareableRecord],
    schemaVersion: 1,
  });
  adapter.writeText(JSON.stringify(nextStore));
  return nextStore;
};

export const appendAgentSelectedImageExportReceipt = (
  adapter: AgentSessionAuditStorageAdapter,
  receipt: AgentSelectedImageExportReceipt,
): AgentSelectedImageExportReceipt => {
  const parsedReceipt = agentSelectedImageExportReceiptSchema.parse(receipt);
  const shareableText = redactAgentTraceText(JSON.stringify(parsedReceipt));
  const shareableReceipt = agentSelectedImageExportReceiptSchema.parse(JSON.parse(shareableText));
  if (privatePathPattern.test(JSON.stringify(shareableReceipt))) {
    throw new Error('Agent selected-image export receipt contains an unredacted local path.');
  }
  const existing = adapter.readText();
  const receipts = existing === null ? [] : z.array(agentSelectedImageExportReceiptSchema).parse(JSON.parse(existing));
  adapter.writeText(JSON.stringify([...receipts, shareableReceipt]));
  return shareableReceipt;
};

export const verifyAgentSessionArtifactLineage = (record: AgentSessionAuditRecord): void => {
  const toolCallIds = new Set(record.toolCalls.map((toolCall) => toolCall.id));
  for (const artifact of record.artifactLineage) {
    if (!toolCallIds.has(artifact.sourceToolCallId)) {
      throw new Error(`Artifact ${artifact.artifactId} is not linked to a persisted tool call.`);
    }
  }
};

export const verifyAgentSessionTraceReferences = (record: AgentSessionAuditRecord): void => {
  const toolCallIds = new Set(record.toolCalls.map((toolCall) => toolCall.id));
  let previewEventCount = 0;

  for (const event of record.traceEvents) {
    if (event.toolCallId !== undefined && !toolCallIds.has(event.toolCallId)) {
      throw new Error(`Trace event ${event.id} references missing tool call ${event.toolCallId}.`);
    }
    if (event.kind === 'preview') {
      previewEventCount += 1;
      if (event.previewRef === undefined || event.recipeHash === undefined || event.renderHash === undefined) {
        throw new Error(`Preview trace event ${event.id} must include preview, recipe, and render identifiers.`);
      }
    }
  }

  if (previewEventCount === 0) {
    throw new Error('Agent session trace must include at least one preview event.');
  }
};
