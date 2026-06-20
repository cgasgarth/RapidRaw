#!/usr/bin/env bun

import { readFileSync } from 'node:fs';
import { z } from 'zod';

import { buildAgentAppServerToolReadinessSummary } from '../../../src/utils/agentAppServerToolReadiness.ts';

const failures: Array<string> = [];
const summary = buildAgentAppServerToolReadinessSummary();
const expectedFamilies = ['ai', 'computational_merge', 'detail', 'film_look', 'negative_lab', 'tone_color'];
const localeSchema = z
  .object({
    editor: z.object({
      ai: z.object({
        agent: z.object({
          readiness: z.object({
            appServer: z.string().min(1),
            applies: z.string().min(1),
            dryRuns: z.string().min(1),
            registeredOnly: z.string().min(1),
            routes: z.string().min(1),
            title: z.string().min(1),
            tools: z.string().min(1),
          }),
        }),
      }),
    }),
  })
  .passthrough();

for (const family of expectedFamilies) {
  if (!summary.families.some((entry) => entry.family === family)) {
    failures.push(`Route catalog summary missing ${family}.`);
  }
}

if (summary.toolCount === 0) failures.push('Tool count should be visible.');
if (summary.dryRunRouteCount === 0) failures.push('Dry-run route count should be visible.');
if (summary.applyRouteCount === 0) failures.push('Apply route count should be visible.');
if (summary.runtimeCheckCount === 0) failures.push('Runtime check count should be visible.');

const source = readFileSync('src/components/panel/right/AgentChatShell.tsx', 'utf8');
for (const marker of [
  'buildAgentAppServerToolReadinessSummary',
  'data-testid="agent-app-server-tool-readiness"',
  'data-testid="agent-app-server-tool-readiness-counts"',
  'data-testid="agent-app-server-tool-readiness-families"',
  'editor.ai.agent.readiness.registeredOnly',
  'data-apply-route-count={summary.applyRouteCount}',
  'data-dry-run-route-count={summary.dryRunRouteCount}',
  'data-runtime-check-count={summary.runtimeCheckCount}',
]) {
  if (!source.includes(marker)) failures.push(`Agent chat shell missing marker: ${marker}`);
}

localeSchema.parse(JSON.parse(readFileSync('src/i18n/locales/en.json', 'utf8')));

if (failures.length > 0) {
  console.error(`agent tool readiness UI failed (${failures.length})`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`agent tool readiness UI ok (${summary.toolCount} tools, ${summary.familyCount} families)`);
