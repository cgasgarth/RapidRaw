import { z } from 'zod';
import { agentAppServerModelSelectionReceiptSchema } from './agentAppServerModelSession';
import type { AgentSessionAuditRecord, AgentSessionAuditStorageAdapter } from './agentSessionAuditStore';
import { readAgentSessionAuditStore, verifyAgentSessionArtifactLineage } from './agentSessionAuditStore';

export const agentSessionReplayStatusSchema = z.enum(['matched', 'diverged']);

export const agentSessionReplayReportSchema = z
  .object({
    artifactDivergences: z.array(
      z
        .object({
          artifactId: z.string().trim().min(1),
          expectedHash: z.string().trim().min(1),
          replayedHash: z.string().trim().min(1),
        })
        .strict(),
    ),
    finalGraphRevision: z.string().trim().min(1),
    modelSelection: agentAppServerModelSelectionReceiptSchema.optional(),
    replayedRecordCount: z.number().int().nonnegative(),
    sessionId: z.string().trim().min(1),
    status: agentSessionReplayStatusSchema,
  })
  .strict();

export type AgentSessionReplayReport = z.infer<typeof agentSessionReplayReportSchema>;

export type AgentArtifactReplayHashProvider = (artifact: AgentSessionAuditRecord['artifactLineage'][number]) => string;

export const replayAgentSessionAuditRecord = (
  record: AgentSessionAuditRecord,
  replayHashForArtifact: AgentArtifactReplayHashProvider = (artifact) => artifact.contentHash,
): AgentSessionReplayReport => {
  verifyAgentSessionArtifactLineage(record);
  const artifactDivergences = record.artifactLineage
    .map((artifact) => ({
      artifactId: artifact.artifactId,
      expectedHash: artifact.contentHash,
      replayedHash: replayHashForArtifact(artifact),
    }))
    .filter((artifact) => artifact.expectedHash !== artifact.replayedHash);

  return agentSessionReplayReportSchema.parse({
    artifactDivergences,
    finalGraphRevision: record.finalGraphRevision,
    modelSelection: record.modelSelection,
    replayedRecordCount: 1,
    sessionId: record.sessionId,
    status: artifactDivergences.length === 0 ? 'matched' : 'diverged',
  });
};

export const replayPersistedAgentSessions = (
  adapter: AgentSessionAuditStorageAdapter,
  replayHashForArtifact?: AgentArtifactReplayHashProvider,
): AgentSessionReplayReport[] =>
  readAgentSessionAuditStore(adapter).records.map((record) =>
    replayAgentSessionAuditRecord(record, replayHashForArtifact),
  );
