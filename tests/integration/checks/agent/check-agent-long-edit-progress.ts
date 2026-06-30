#!/usr/bin/env bun

import { readFileSync } from 'node:fs';

import { agentChatTranscriptFixture } from '../../../../src/utils/agent/session/agentChatTranscriptFixture.ts';

const failures: string[] = [];
const progress = agentChatTranscriptFixture.longEditProgress;

if (progress === undefined) {
  failures.push('Agent transcript fixture must include long-edit progress.');
} else {
  const expectedStages = ['planning', 'preview-render', 'apply', 'export-review', 'audit-save'];
  const actualStages = progress.stages.map((stage) => stage.id);
  if (actualStages.join(',') !== expectedStages.join(',')) {
    failures.push(`Long-edit progress stage order mismatch: ${actualStages.join(',')}`);
  }
  if (progress.completedStageCount !== progress.stages.length) {
    failures.push('Long-edit progress fixture must show completed runtime path.');
  }
  if (progress.estimatedTotalMs !== progress.stages.reduce((total, stage) => total + stage.durationMs, 0)) {
    failures.push('Long-edit progress total must equal stage durations.');
  }
  if (!progress.stages.some((stage) => stage.id === 'audit-save' && stage.toolCallId === 'tool-3')) {
    failures.push('Long-edit progress must link audit save to the apply tool call.');
  }
}

const shellSource = readFileSync('src/components/panel/right/ai/AgentChatShell.tsx', 'utf8');
for (const marker of [
  'data-testid="agent-long-edit-progress"',
  'data-testid="agent-long-edit-progress-bar"',
  'data-testid="agent-long-edit-progress-stages"',
]) {
  if (!shellSource.includes(marker)) failures.push(`Agent chat shell missing marker: ${marker}`);
}

if (failures.length > 0) {
  console.error(`agent long edit progress failed (${failures.length})`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`agent long edit progress ok (${progress?.stages.length ?? 0} stages)`);
