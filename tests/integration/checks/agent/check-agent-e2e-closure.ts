#!/usr/bin/env bun

import { readFileSync } from 'node:fs';

import { z } from 'zod';

import { agentChatTranscriptFixture } from '../../../../src/utils/agent/session/agentChatTranscriptFixture.ts';

const failures: string[] = [];
const closure = agentChatTranscriptFixture.e2eClosure;

const privateProofSchema = z
  .object({
    changedPixelCount: z.number().int().positive(),
    sourceHashUnchanged: z.literal(true),
    validationMode: z.literal('agent_real_raw_private_runtime_apply'),
  })
  .passthrough();

if (closure === undefined) {
  failures.push('Agent transcript fixture must include E2E closure.');
} else {
  const stepIds = new Set(closure.steps.map((step) => step.id));
  for (const id of ['prompt', 'plan', 'approval', 'apply', 'private-raw', 'replay', 'rollback']) {
    if (!stepIds.has(id)) failures.push(`E2E closure missing ${id} step.`);
  }
  if (closure.steps.some((step) => step.status !== 'verified'))
    failures.push('Every E2E closure step must be verified.');
}

const privateProof = privateProofSchema.parse(
  JSON.parse(readFileSync('docs/validation/proofs/agent/agent-real-raw-private-edit-proof-2026-06-22.json', 'utf8')),
);
if (privateProof.changedPixelCount < 4) failures.push('Private RAW proof must show changed output pixels.');

const shellSource = readFileSync('src/components/panel/right/ai/AgentChatShell.tsx', 'utf8');
for (const marker of ['data-testid="agent-e2e-closure"', 'data-testid="agent-e2e-closure-steps"']) {
  if (!shellSource.includes(marker)) failures.push(`Agent chat shell missing marker: ${marker}`);
}

if (failures.length > 0) {
  console.error(`agent e2e closure failed (${failures.length})`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`agent e2e closure ok (${closure?.steps.length ?? 0} verified steps)`);
