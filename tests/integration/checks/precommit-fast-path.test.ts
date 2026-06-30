import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

describe('pre-commit hook policy', () => {
  const hook = readFileSync('.githooks/pre-commit', 'utf8');

  test('does not use stale staged-only routing', () => {
    for (const stalePattern of ['lint-staged', 'staged_files=', 'git diff --cached', 'check:eslint-gaps']) {
      expect(hook).not.toContain(stalePattern);
    }
  });

  test('runs autofix, restages updates, and keeps full parallel gates', () => {
    for (const required of [
      'bun run lint:fix',
      'git add -u',
      'run_gate lint bun run lint',
      'run_gate format bun run format:check',
      'run_gate typecheck bun run typecheck',
      'run_gate test bun run test',
      'run_gate rust bun run check:rust',
      'run_gate bundle bun run check:bundle',
      'run_gate i18n bun scripts/run-compact-command.ts --label i18n:lint -- bunx i18next-cli lint',
      'run_gate unused-deps bun scripts/run-compact-command.ts --label unused-deps -- bunx knip --config knip.jsonc --dependencies --reporter compact',
      'run_gate docs bun run check:docs',
      'run_gate schema bun run check:schema',
      'run_gate schema-routing bun tests/integration/checks/check-schema-contract-gate.ts --self-test',
    ]) {
      expect(hook).toContain(required);
    }
  });

  test('still blocks direct commits on main', () => {
    expect(hook).toContain('Direct commits on main are blocked');
  });
});
