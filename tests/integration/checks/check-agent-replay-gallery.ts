#!/usr/bin/env bun

import { readFileSync } from 'node:fs';

import { agentChatTranscriptFixture } from '../../../src/utils/agentChatTranscriptFixture.ts';

const failures: string[] = [];
const gallery = agentChatTranscriptFixture.artifactReview?.replayGallery;

if (gallery === undefined) {
  failures.push('Agent artifact review must include a replay gallery.');
} else {
  const roles = new Set(gallery.map((entry) => entry.role));
  for (const role of ['source', 'dry_run', 'output', 'rollback']) {
    if (!roles.has(role)) failures.push(`Replay gallery missing ${role} role.`);
  }
  if (!gallery.every((entry) => entry.href.includes('agent-expert-edit-demo-workflow'))) {
    failures.push('Replay gallery entries must link to the runtime proof gallery.');
  }
  if (!gallery.some((entry) => entry.role === 'rollback' && entry.artifactId.includes('graph_rev'))) {
    failures.push('Replay gallery rollback entry must identify the graph revision.');
  }
}

const shellSource = readFileSync('src/components/panel/right/ai/AgentChatShell.tsx', 'utf8');
for (const marker of [
  'data-testid="agent-replay-gallery"',
  'data-gallery-role={entry.role}',
  'data-artifact-id={entry.artifactId}',
]) {
  if (!shellSource.includes(marker)) failures.push(`Agent chat shell missing marker: ${marker}`);
}

if (failures.length > 0) {
  console.error(`agent replay gallery failed (${failures.length})`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`agent replay gallery ok (${gallery?.length ?? 0} entries)`);
