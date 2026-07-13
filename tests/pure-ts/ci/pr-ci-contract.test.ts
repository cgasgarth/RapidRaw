import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import {
  DEFERRED_MAIN_COVERAGE,
  PR_REQUIRED_BUDGET_SECONDS,
  planPrValidation,
  resolveWorkflowStartedEpoch,
  verifyRequiredResults,
} from '../../../scripts/ci/pr-ci-contract';

describe('four-minute PR CI contract', () => {
  test.each([
    [['src/components/Editor.tsx'], { js: true, rust: false, workflow: false, docs: false }],
    [['src-tauri/src/lib.rs'], { js: false, rust: true, workflow: false, docs: false }],
    [['src/components/Editor.tsx', 'src-tauri/src/lib.rs'], { js: true, rust: true, workflow: false, docs: false }],
  ])('plans representative paths %p', (paths, expected) => {
    const plan = planPrValidation(paths);
    expect(plan.lanes).toEqual(expected);
    expect(plan.deferredToMain).toContain('full native required closure');
    expect(plan.deferredToMain).toContain('exhaustive dependency security and license audits');
  });

  test('fails closed when changed paths are unavailable', () => {
    expect(planPrValidation([]).lanes).toEqual({ js: true, rust: true, workflow: true, docs: true });
  });

  test('uses the Actions run_started_at epoch and rejects late or invalid substitutes', () => {
    expect(resolveWorkflowStartedEpoch('100', 120)).toBe(100);
    expect(() => resolveWorkflowStartedEpoch('121', 120)).toThrow('Actions run_started_at');
    expect(() => resolveWorkflowStartedEpoch(undefined, 120)).toThrow('Actions run_started_at');
  });

  test('blocks selected failures, unexpected skips, and budget overruns', () => {
    const selected = { js: true, rust: false, workflow: false, docs: false };
    expect(
      verifyRequiredResults(
        { 'fast-js': 'failure', 'fast-rust': 'skipped', 'fast-workflow': 'skipped', 'fast-docs': 'skipped' },
        selected,
        60,
      ),
    ).toContain('fast-js=failure');
    expect(
      verifyRequiredResults(
        { 'fast-js': 'success', 'fast-rust': 'skipped', 'fast-workflow': 'skipped', 'fast-docs': 'skipped' },
        selected,
        PR_REQUIRED_BUDGET_SECONDS + 1,
      ),
    ).toContain('required validation exceeded 240s (241s)');
  });

  test('accepts an in-budget affected plan only when every lane has an exact disposition', () => {
    expect(
      verifyRequiredResults(
        { 'fast-js': 'success', 'fast-rust': 'success', 'fast-workflow': 'skipped', 'fast-docs': 'skipped' },
        { js: true, rust: true, workflow: false, docs: false },
        239,
      ),
    ).toEqual([]);
  });

  test('every disclosed deferred lane has explicit non-canceling main closure', () => {
    const workflow = readFileSync('.github/workflows/main-long-validation.yml', 'utf8');
    expect(workflow).toContain('cancel-in-progress: false');
    for (const [lane, markers] of Object.entries(DEFERRED_MAIN_COVERAGE)) {
      expect(planPrValidation(['README.md']).deferredToMain).toContain(lane);
      for (const marker of markers) expect(workflow).toContain(marker);
    }
  });
});
