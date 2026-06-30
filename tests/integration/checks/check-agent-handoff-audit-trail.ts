#!/usr/bin/env bun

import { readFileSync } from 'node:fs';

import { agentChatTranscriptFixture } from '../../../src/utils/agentChatTranscriptFixture.ts';

const failures: string[] = [];
const handoff = agentChatTranscriptFixture.reviewHandoff;
const audit = agentChatTranscriptFixture.auditTranscript;

if (handoff === undefined) {
  failures.push('Agent fixture must include a review handoff.');
} else {
  const applyEntry = handoff.auditTrail.find((entry) => entry.stage === 'apply');
  if (applyEntry?.approvalState !== 'approved') failures.push('Apply audit trail entry must be approved.');
  if (applyEntry?.toolName !== 'tonecolor.apply_command')
    failures.push('Apply audit trail must expose exact tool path.');
  if (!applyEntry?.artifactIds.includes(handoff.afterArtifactId)) {
    failures.push('Apply audit trail must link the handoff after artifact.');
  }

  const dryRunEntry = handoff.auditTrail.find((entry) => entry.stage === 'dry_run');
  if (dryRunEntry?.approvalState !== 'required')
    failures.push('Dry-run audit trail entry must show required approval.');
  if (!dryRunEntry?.artifactIds.includes(handoff.beforeArtifactId)) {
    failures.push('Dry-run audit trail must link the handoff before artifact.');
  }

  const transcriptToolNames = new Set(audit?.records.map((record) => record.toolName) ?? []);
  for (const entry of handoff.auditTrail) {
    if (!transcriptToolNames.has(entry.toolName)) {
      failures.push(`Handoff audit trail entry is missing from transcript: ${entry.toolName}`);
    }
  }
}

const shellSource = readFileSync('src/components/panel/right/ai/AgentChatShell.tsx', 'utf8');
for (const marker of [
  'data-testid="agent-review-handoff-audit-trail"',
  'data-tool-name={entry.toolName}',
  'data-artifact-ids={entry.artifactIds.join',
]) {
  if (!shellSource.includes(marker)) failures.push(`Agent chat shell missing marker: ${marker}`);
}

if (failures.length > 0) {
  console.error(`agent handoff audit trail failed (${failures.length})`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`agent handoff audit trail ok (${handoff?.auditTrail.length ?? 0} entries)`);
