#!/usr/bin/env bun

import { readFileSync } from 'node:fs';

import { z } from 'zod';

import { evaluateAgentSafetyPolicy, inferAgentSafetyOperationKind } from '../../../../src/utils/agentSafetyPolicy.ts';

const localeSchema = z
  .object({
    editor: z.object({
      ai: z.object({
        agent: z.object({
          composer: z.object({
            policy: z.object({
              approve: z.string().min(1),
              approved: z.string().min(1),
              title: z.string().min(1),
            }),
            status: z.object({
              approval_required: z.string().min(1),
              blocked: z.string().min(1),
            }),
          }),
        }),
      }),
    }),
  })
  .passthrough();

const allowed = evaluateAgentSafetyPolicy({
  operationKind: 'global_adjustment',
  prompt: 'brighten this RAW and keep color natural',
});
if (allowed.severity !== 'allow' || allowed.approvalRequired || allowed.blocked) {
  throw new Error('Small global edits should be auto-allowed after dry-run.');
}

const exportWrite = evaluateAgentSafetyPolicy({
  operationKind: 'export_write',
  prompt: 'export this image to a file',
});
if (exportWrite.severity !== 'review' || !exportWrite.approvalRequired || exportWrite.blocked) {
  throw new Error('Export/file writes should require approval.');
}

const remove = evaluateAgentSafetyPolicy({
  operationKind: 'retouch_remove',
  prompt: 'remove this small dust spot',
  radiusPx: 42,
});
if (remove.severity !== 'review' || !remove.approvalRequired) {
  throw new Error('Retouch remove should require approval.');
}

const largeRemove = evaluateAgentSafetyPolicy({
  operationKind: 'retouch_remove',
  prompt: 'remove a large object',
  radiusPx: 160,
});
if (largeRemove.severity !== 'block' || !largeRemove.blocked) {
  throw new Error('Large retouch remove should be blocked.');
}

const rollback = evaluateAgentSafetyPolicy({
  operationKind: 'rollback',
  prompt: 'rollback the whole session',
  rollbackScope: 'session_start',
});
if (rollback.severity !== 'review' || !rollback.approvalRequired) {
  throw new Error('Session rollback should require approval.');
}

if (inferAgentSafetyOperationKind('remove the distracting object') !== 'retouch_remove') {
  throw new Error('Prompt inference should classify remove prompts as retouch_remove.');
}
if (inferAgentSafetyOperationKind('make the subject brighter') !== 'ambiguous_subject_edit') {
  throw new Error('Prompt inference should classify subject prompts as ambiguous_subject_edit.');
}

const source = readFileSync('src/components/panel/right/ai/AgentChatShell.tsx', 'utf8');
for (const marker of [
  'evaluateAgentSafetyPolicy',
  'inferAgentSafetyOperationKind',
  'status: safetyDecision.blocked',
  'approvalId: safetyDecision.decisionId',
  'approvalId: result.safetyDecision?.decisionId',
  'data-testid="agent-live-prompt-approve-policy"',
  'data-policy-state={result.status}',
  'data-disabled-reason=',
  'data-testid="agent-live-prompt-safety-policy"',
  "data-safety-decision={result.safetyDecision?.decisionId ?? ''}",
  'data-policy-severity={result.safetyDecision.severity}',
  'result.safetyDecision.decisionId',
]) {
  if (!source.includes(marker)) throw new Error(`Agent chat shell missing safety marker: ${marker}`);
}

localeSchema.parse(JSON.parse(readFileSync('src/i18n/locales/en.json', 'utf8')));

console.log('agent safety policy ok');
