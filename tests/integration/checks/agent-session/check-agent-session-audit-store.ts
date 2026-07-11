#!/usr/bin/env bun

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import {
  appendAgentSessionAuditRecord,
  assertAgentSessionTraceShareable,
  readAgentSessionAuditStore,
  verifyAgentSessionArtifactLineage,
  verifyAgentSessionTraceReferences,
} from '../../../../src/utils/agent/session/agentSessionAuditStore.ts';

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
    modelSelection: {
      effective: { modelId: 'gpt-5.6-terra-fallback', reasoningTier: 'low' },
      reason: 'Terra light unavailable in fixture transport.',
      requested: { modelId: 'gpt-5.6-terra', reasoningTier: 'light' },
      status: 'fallback',
    },
    planSummary: 'Brighten RAW and add contrast after approval.',
    prompt: 'Make /Users/cgas/Pictures/Capture One/Alaska/DSC_3161.ARW brighter and punchier.',
    rollbackGraphRevision: 'history_0',
    sessionId: 'session_agent_audit_3161',
    toolCalls: [
      { id: 'tool_inspect_3161', name: 'agent.editor_state.query', status: 'succeeded' },
      {
        id: 'tool_dry_run_3161',
        name: 'tonecolor.dry_run_command',
        resultSummary: 'Previewed /Users/cgas/Pictures/Capture One/Alaska/DSC_3161.ARW without writing.',
        status: 'succeeded',
      },
      { id: 'tool_apply_3161', name: 'tonecolor.apply_command', status: 'succeeded' },
      { errorCode: 'stale_recipe_hash', id: 'tool_stale_3161', name: 'tonecolor.apply_command', status: 'rejected' },
    ],
    traceEvents: [
      {
        id: 'trace_prompt_3161',
        kind: 'prompt',
        message: 'Make /Users/cgas/Pictures/Capture One/Alaska/DSC_3161.ARW brighter.',
        timestamp: '2026-06-26T05:00:00.000Z',
      },
      {
        id: 'trace_preview_before_3161',
        kind: 'preview',
        previewRef: 'blob:agent-preview-before-3161',
        recipeHash: 'recipe:before3161',
        renderHash: 'render:before3161',
        timestamp: '2026-06-26T05:00:01.000Z',
        toolCallId: 'tool_dry_run_3161',
      },
      {
        errorCode: 'stale_recipe_hash',
        id: 'trace_stale_3161',
        kind: 'error',
        message: 'Rejected stale tool call before apply.',
        timestamp: '2026-06-26T05:00:02.000Z',
        toolCallId: 'tool_stale_3161',
      },
      {
        approvalId: 'approval_agent_audit_3161',
        id: 'trace_approval_3161',
        kind: 'approval',
        message: 'User approved bounded tone apply.',
        timestamp: '2026-06-26T05:00:03.000Z',
      },
      {
        graphRevision: 'history_0',
        id: 'trace_rollback_3161',
        kind: 'rollback',
        message: 'Rollback checkpoint available.',
        timestamp: '2026-06-26T05:00:04.000Z',
      },
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
  if (
    persisted.prompt.includes('/Users/') ||
    persisted.toolCalls.some((toolCall) => toolCall.resultSummary?.includes('/Users/'))
  ) {
    throw new Error('Audit store did not redact private local paths from shareable trace text.');
  }
  if (persisted.artifactLineage.length !== 2) {
    throw new Error('Audit store did not preserve every output artifact lineage entry.');
  }
  if (
    persisted.modelSelection.status !== 'fallback' ||
    persisted.modelSelection.requested.reasoningTier !== 'light' ||
    persisted.modelSelection.effective?.reasoningTier !== 'low'
  ) {
    throw new Error('Audit store did not preserve explicit requested/effective model fallback.');
  }

  verifyAgentSessionArtifactLineage(persisted);
  verifyAgentSessionTraceReferences(persisted);
  assertAgentSessionTraceShareable(persisted);

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

  const brokenTrace = {
    ...persisted,
    traceEvents: [{ ...persisted.traceEvents[0], toolCallId: 'missing_tool_call' }],
  };
  try {
    verifyAgentSessionTraceReferences(brokenTrace);
    throw new Error('Expected broken trace reference to fail.');
  } catch (error) {
    if (error instanceof Error && error.message === 'Expected broken trace reference to fail.') throw error;
  }

  console.log('agent session audit store ok (persist+restart+lineage)');
} finally {
  rmSync(tempRoot, { force: true, recursive: true });
}
