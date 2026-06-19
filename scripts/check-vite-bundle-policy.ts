#!/usr/bin/env bun

import { readFile } from 'node:fs/promises';

import {
  VITE_BUNDLE_BUDGET_POLICY,
  formatBundlePolicyBytes,
  getViteChunkSizeWarningLimitKb,
} from './lib/vite-bundle-policy.ts';

const failures: string[] = [];

const [viteConfig, docs] = await Promise.all([
  readFile('vite.config.js', 'utf8'),
  readFile('docs/tooling/vite-bundle-budget-2026-06-11.md', 'utf8'),
]);
const normalizedDocs = docs.replace(/\s+/gu, ' ');

if (!viteConfig.includes("from './scripts/lib/vite-bundle-policy.ts'")) {
  failures.push('vite.config.js must import the shared Vite bundle policy.');
}

if (!viteConfig.includes('chunkSizeWarningLimit: getViteChunkSizeWarningLimitKb()')) {
  failures.push('vite.config.js must derive chunkSizeWarningLimit from getViteChunkSizeWarningLimitKb().');
}

for (const budget of VITE_BUNDLE_BUDGET_POLICY.budgets) {
  const expectedCells = [
    budget.label,
    formatBundlePolicyBytes(budget.warnBytes),
    formatBundlePolicyBytes(budget.warnGzipBytes),
    formatBundlePolicyBytes(budget.maxBytes),
    formatBundlePolicyBytes(budget.maxGzipBytes),
  ];
  const hasExpectedRow = docs
    .split('\n')
    .some((line) => expectedCells.every((expectedCell) => line.includes(expectedCell)));
  if (!hasExpectedRow) failures.push(`docs bundle budget table is stale for ${budget.label}.`);
}

const initialEntryBudget = VITE_BUNDLE_BUDGET_POLICY.initialEntryAggregate;
const hasInitialEntryRow = docs
  .split('\n')
  .some((line) =>
    [
      initialEntryBudget.label,
      formatBundlePolicyBytes(initialEntryBudget.warnBytes),
      formatBundlePolicyBytes(initialEntryBudget.warnGzipBytes),
      formatBundlePolicyBytes(initialEntryBudget.maxBytes),
      formatBundlePolicyBytes(initialEntryBudget.maxGzipBytes),
    ].every((expectedCell) => line.includes(expectedCell)),
  );
if (!hasInitialEntryRow) failures.push(`docs bundle budget table is stale for ${initialEntryBudget.label}.`);

if (!docs.includes(`Vite warning limit: ${getViteChunkSizeWarningLimitKb().toLocaleString('en-US')} KiB`)) {
  failures.push('docs bundle policy is missing the derived Vite warning limit.');
}

if (!normalizedDocs.includes(VITE_BUNDLE_BUDGET_POLICY.headroomPolicy)) {
  failures.push('docs bundle policy is missing the shared headroom policy text.');
}

if (!normalizedDocs.includes(VITE_BUNDLE_BUDGET_POLICY.warningTierPolicy)) {
  failures.push('docs bundle policy is missing the shared warning tier policy text.');
}

if (failures.length > 0) {
  console.error('vite bundle policy drift:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log('vite bundle policy ok');
