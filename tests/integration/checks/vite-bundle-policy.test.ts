import { describe, expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';

import {
  formatBundlePolicyBytes,
  getViteChunkSizeWarningLimitKb,
  VITE_BUNDLE_BUDGET_POLICY,
} from '../../../scripts/lib/vite-bundle-policy.ts';

describe('Vite bundle policy', () => {
  test('Vite config imports and applies the shared bundle policy', async () => {
    const viteConfig = await readFile('vite.config.js', 'utf8');

    expect(viteConfig).toContain("from './scripts/lib/vite-bundle-policy.ts'");
    expect(viteConfig).toContain('chunkSizeWarningLimit: getViteChunkSizeWarningLimitKb()');
  });

  test('docs budget table matches the shared policy', async () => {
    const docs = await readFile('docs/tooling/vite-bundle-budget-2026-06-11.md', 'utf8');
    const rows = docs.split('\n');

    for (const budget of VITE_BUNDLE_BUDGET_POLICY.budgets) {
      const expectedCells = [
        budget.label,
        formatBundlePolicyBytes(budget.warnBytes),
        formatBundlePolicyBytes(budget.warnGzipBytes),
        formatBundlePolicyBytes(budget.maxBytes),
        formatBundlePolicyBytes(budget.maxGzipBytes),
      ];
      expect(rows.some((line) => expectedCells.every((expectedCell) => line.includes(expectedCell)))).toBe(true);
    }

    const initialEntryBudget = VITE_BUNDLE_BUDGET_POLICY.initialEntryAggregate;
    expect(
      rows.some((line) =>
        [
          initialEntryBudget.label,
          formatBundlePolicyBytes(initialEntryBudget.warnBytes),
          formatBundlePolicyBytes(initialEntryBudget.warnGzipBytes),
          formatBundlePolicyBytes(initialEntryBudget.maxBytes),
          formatBundlePolicyBytes(initialEntryBudget.maxGzipBytes),
        ].every((expectedCell) => line.includes(expectedCell)),
      ),
    ).toBe(true);
  });

  test('docs include derived warning limit and policy copy', async () => {
    const docs = await readFile('docs/tooling/vite-bundle-budget-2026-06-11.md', 'utf8');
    const normalizedDocs = docs.replace(/\s+/gu, ' ');

    expect(docs).toContain(`Vite warning limit: ${getViteChunkSizeWarningLimitKb().toLocaleString('en-US')} KiB`);
    expect(normalizedDocs).toContain(VITE_BUNDLE_BUDGET_POLICY.headroomPolicy);
    expect(normalizedDocs).toContain(VITE_BUNDLE_BUDGET_POLICY.warningTierPolicy);
  });
});
