#!/usr/bin/env bun

import {
  type AgentSessionAuditStorageAdapter,
  appendAgentSessionAuditRecord,
} from '../../../../src/utils/agent/session/agentSessionAuditStore.ts';
import { replayPersistedAgentSessions } from '../../../../src/utils/agent/session/agentSessionReplay.ts';

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
  modelId: 'gpt-5.1-codex-app-server',
  planSummary: 'Replay brightening plan.',
  prompt: 'Replay the completed edit.',
  rollbackGraphRevision: 'history_0',
  sessionId: 'session_replay_3162',
  toolCalls: [
    { id: 'tool_dry_run_3162', name: 'tonecolor.dry_run_command', status: 'succeeded' },
    { id: 'tool_apply_3162', name: 'tonecolor.apply_command', status: 'succeeded' },
  ],
  traceEvents: [
    {
      id: 'trace_replay_prompt_3162',
      kind: 'prompt',
      message: 'Replay completed agent edit.',
      timestamp: '2026-06-26T05:10:00.000Z',
    },
    {
      id: 'trace_replay_preview_3162',
      kind: 'preview',
      previewRef: 'blob:agent-replay-preview-3162',
      recipeHash: 'recipe:replay3162',
      renderHash: 'render:replay3162',
      timestamp: '2026-06-26T05:10:01.000Z',
      toolCallId: 'tool_dry_run_3162',
    },
    {
      graphRevision: 'history_1',
      id: 'trace_replay_export_3162',
      kind: 'export',
      message: 'Export proof receipt captured.',
      timestamp: '2026-06-26T05:10:02.000Z',
      toolCallId: 'tool_apply_3162',
    },
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
