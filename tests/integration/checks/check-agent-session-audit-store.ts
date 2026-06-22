#!/usr/bin/env bun

import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import {
  appendAgentSessionAuditRecord,
  readAgentSessionAuditStore,
  verifyAgentSessionArtifactLineage,
} from '../../../src/utils/agentSessionAuditStore.ts';

const tempRoot = mkdtempSync(join(tmpdir(), 'rawengine-agent-audit-'));
const storePath = join(tempRoot, 'agent-sessions.json');
const fileAdapter = {
  readText: () => (existsSync(storePath) ? readFileSync(storePath, 'utf8') : null),
  writeText: (value: string) => {
    mkdirSync(dirname(storePath), { recursive: true });
    writeFileSync(storePath, value);
  },
};

try {
  const record = {
    approvalId: 'approval_agent_audit_3161',
    artifactLineage: [
      {
        artifactId: 'artifact_agent_3161_before',
        contentHash: 'sha256:before3161',
        graphRevision: 'history_0',
        sourceToolCallId: 'tool_dry_run_3161',
      },
      {
        artifactId: 'artifact_agent_3161_after',
        contentHash: 'sha256:after3161',
        graphRevision: 'history_0',
        sourceToolCallId: 'tool_dry_run_3161',
      },
    ],
    finalGraphRevision: 'history_1',
    initialGraphRevision: 'history_0',
    planSummary: 'Brighten RAW and add contrast after approval.',
    prompt: 'Make this RAW brighter and punchier.',
    rollbackGraphRevision: 'history_0',
    sessionId: 'session_agent_audit_3161',
    toolCalls: [
      { id: 'tool_inspect_3161', name: 'agent.editor_state.query' },
      { id: 'tool_dry_run_3161', name: 'tonecolor.dry_run_command' },
      { id: 'tool_apply_3161', name: 'tonecolor.apply_command' },
    ],
  };

  const written = appendAgentSessionAuditRecord(fileAdapter, record);
  if (written.records.length !== 1) throw new Error('Audit store did not append the session record.');

  const restartedRead = readAgentSessionAuditStore(fileAdapter);
  const persisted = restartedRead.records[0];
  if (persisted === undefined) throw new Error('Audit store did not survive restart/readback.');
  if (persisted.sessionId !== record.sessionId || persisted.rollbackGraphRevision !== 'history_0') {
    throw new Error('Audit store did not preserve session and rollback lineage.');
  }
  if (persisted.artifactLineage.length !== 2) {
    throw new Error('Audit store did not preserve every output artifact lineage entry.');
  }

  verifyAgentSessionArtifactLineage(persisted);

  const broken = {
    ...persisted,
    artifactLineage: [{ ...persisted.artifactLineage[0], sourceToolCallId: 'missing_tool_call' }],
  };
  try {
    verifyAgentSessionArtifactLineage(broken);
    throw new Error('Expected broken artifact lineage to fail.');
  } catch (error) {
    if (error instanceof Error && error.message === 'Expected broken artifact lineage to fail.') throw error;
  }

  console.log('agent session audit store ok (persist+restart+lineage)');
} finally {
  rmSync(tempRoot, { force: true, recursive: true });
}
