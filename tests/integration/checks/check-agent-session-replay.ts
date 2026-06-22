#!/usr/bin/env bun

import {
  appendAgentSessionAuditRecord,
  type AgentSessionAuditStorageAdapter,
} from '../../../src/utils/agentSessionAuditStore.ts';
import { replayPersistedAgentSessions } from '../../../src/utils/agentSessionReplay.ts';

let storedText: string | null = null;
const adapter: AgentSessionAuditStorageAdapter = {
  readText: () => storedText,
  writeText: (value) => {
    storedText = value;
  },
};

const record = {
  approvalId: 'approval_replay_3162',
  artifactLineage: [
    {
      artifactId: 'artifact_replay_3162_before',
      contentHash: 'sha256:before3162',
      graphRevision: 'history_0',
      sourceToolCallId: 'tool_dry_run_3162',
    },
    {
      artifactId: 'artifact_replay_3162_after',
      contentHash: 'sha256:after3162',
      graphRevision: 'history_1',
      sourceToolCallId: 'tool_apply_3162',
    },
  ],
  finalGraphRevision: 'history_1',
  initialGraphRevision: 'history_0',
  planSummary: 'Replay brightening plan.',
  prompt: 'Replay the completed edit.',
  rollbackGraphRevision: 'history_0',
  sessionId: 'session_replay_3162',
  toolCalls: [
    { id: 'tool_dry_run_3162', name: 'tonecolor.dry_run_command' },
    { id: 'tool_apply_3162', name: 'tonecolor.apply_command' },
  ],
};

appendAgentSessionAuditRecord(adapter, record);

const [matched] = replayPersistedAgentSessions(adapter);
if (matched === undefined || matched.status !== 'matched' || matched.artifactDivergences.length !== 0) {
  throw new Error('Agent replay must match persisted artifact lineage by default.');
}

const [diverged] = replayPersistedAgentSessions(adapter, (artifact) =>
  artifact.artifactId.endsWith('_after') ? 'sha256:changed-after3162' : artifact.contentHash,
);
if (diverged === undefined || diverged.status !== 'diverged') {
  throw new Error('Agent replay must report deterministic divergence.');
}
if (
  diverged.artifactDivergences.length !== 1 ||
  diverged.artifactDivergences[0]?.artifactId !== 'artifact_replay_3162_after'
) {
  throw new Error('Agent replay divergence did not identify the changed artifact.');
}
if (diverged.finalGraphRevision !== 'history_1' || diverged.replayedRecordCount !== 1) {
  throw new Error('Agent replay report did not preserve session replay metadata.');
}

console.log('agent session replay ok (matched+diverged)');
