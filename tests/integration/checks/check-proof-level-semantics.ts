#!/usr/bin/env bun

import { readFile } from 'node:fs/promises';

import { z } from 'zod';

const packageJsonSchema = z
  .object({
    scripts: z.record(z.string(), z.string()),
  })
  .passthrough();

const overclaimingAliases = [
  {
    reason: 'No denoise script currently proves full app E2E execution.',
    script: 'check:denoise-e2e',
  },
  {
    reason: 'Denoise preview/export parity is still pending independent preview and export paths.',
    script: 'check:denoise-preview-export-parity',
  },
] as const;
const requiredHonestScripts = [
  'check:denoise-workflow-smoke',
  'check:denoise-preview-runtime',
  'check:ai-denoise-runtime-apply',
  'check:ai-denoise-app-server-tool',
] as const;
const requiredDocPhrases = [
  'preview/export parity proof remains pending',
  '`bun run check:denoise-workflow-smoke`',
] as const;

const packageJson = packageJsonSchema.parse(JSON.parse(await readFile('package.json', 'utf8')));
const failures: Array<string> = [];

failures.push(...collectOverclaimingAliasFailures(packageJson.scripts));

for (const script of requiredHonestScripts) {
  if (packageJson.scripts[script] === undefined) {
    failures.push(`${script}: missing honest denoise validation script.`);
  }
}

for (const [path, text] of await Promise.all([
  readText('docs/detail/ai-denoise-path-decision-2026-06-18.md'),
  readText('RAW_EDITOR_PLAN.md'),
  readText('tests/integration/checks/check-denoise-ui-api.ts'),
])) {
  for (const alias of overclaimingAliases) {
    if (text.includes(alias.script)) {
      failures.push(`${path}: still references overclaiming alias ${alias.script}.`);
    }
  }
}

const denoiseDecisionDoc = await Bun.file('docs/detail/ai-denoise-path-decision-2026-06-18.md').text();
for (const phrase of requiredDocPhrases) {
  if (!denoiseDecisionDoc.includes(phrase)) {
    failures.push(`docs/detail/ai-denoise-path-decision-2026-06-18.md: missing phrase ${phrase}.`);
  }
}

if (process.argv.includes('--self-test')) {
  const invalidPackage = packageJsonSchema.parse({
    scripts: {
      'check:denoise-e2e': 'bun tests/integration/checks/check-denoise-workflow-smoke.ts',
      'check:denoise-workflow-smoke': 'bun tests/integration/checks/check-denoise-workflow-smoke.ts',
    },
  });
  if (collectOverclaimingAliasFailures(invalidPackage.scripts).length === 0) {
    failures.push('self-test did not reject an overclaiming denoise e2e alias.');
  }
}

if (failures.length > 0) {
  console.error(`proof-level semantics failed (${failures.length})`);
  for (const failure of failures.slice(0, 12)) console.error(`- ${failure}`);
  process.exit(1);
}

console.log('proof-level semantics ok');

async function readText(path: string): Promise<[string, string]> {
  return [path, await readFile(path, 'utf8')];
}

function collectOverclaimingAliasFailures(scripts: Record<string, string>): Array<string> {
  return overclaimingAliases.flatMap((alias) =>
    scripts[alias.script] === undefined
      ? []
      : [`${alias.script}: remove or replace with real proof before reintroducing. ${alias.reason}`],
  );
}
