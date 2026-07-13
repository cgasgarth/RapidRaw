import { describe, expect, test } from 'bun:test';
import {
  PR_REQUIRED_BUDGET_SECONDS,
  PR_REQUIRED_JOBS,
  planPrValidation,
  resolveWorkflowStartedEpoch,
  verifyRequiredResults,
} from '../../../scripts/ci/pr-ci-contract';

describe('four-minute PR CI contract', () => {
  test.each([
    [
      ['src/components/Editor.tsx'],
      { js: true, frontend: true, schema: true, dependencies: false, rust: false, workflow: false, docs: false },
    ],
    [
      ['src-tauri/src/lib.rs'],
      { js: false, frontend: false, schema: false, dependencies: false, rust: true, workflow: false, docs: false },
    ],
    [
      ['src/components/Editor.tsx', 'src-tauri/src/lib.rs'],
      { js: true, frontend: true, schema: true, dependencies: false, rust: true, workflow: false, docs: false },
    ],
  ])('plans representative paths %p', (paths, expected) => {
    const plan = planPrValidation(paths);
    expect(plan.lanes).toEqual(expected);
    expect(plan.deferredToMain).toContain('full native required closure');
    expect(plan.deferredToMain).toContain('exhaustive dependency security and license audits');
  });

  test('fails closed when changed paths are unavailable', () => {
    expect(planPrValidation([]).lanes).toEqual({
      js: true,
      frontend: true,
      schema: true,
      dependencies: true,
      rust: true,
      workflow: true,
      docs: true,
    });
  });

  test('dependency changes select JavaScript, schema, native, and audit closure', () => {
    expect(planPrValidation(['src-tauri/Cargo.lock']).lanes).toEqual({
      js: true,
      frontend: true,
      schema: true,
      dependencies: true,
      rust: true,
      workflow: false,
      docs: false,
    });
  });

  test('uses the Actions run_started_at epoch and rejects late or invalid substitutes', () => {
    expect(resolveWorkflowStartedEpoch('100', 120)).toBe(100);
    expect(() => resolveWorkflowStartedEpoch('121', 120)).toThrow('Actions run_started_at');
    expect(() => resolveWorkflowStartedEpoch(undefined, 120)).toThrow('Actions run_started_at');
  });

  test('blocks selected failures, unexpected skips, and budget overruns', () => {
    const selected = {
      js: true,
      frontend: false,
      schema: false,
      dependencies: false,
      rust: false,
      workflow: false,
      docs: false,
    };
    const skipped = Object.fromEntries(
      [
        ...PR_REQUIRED_JOBS.frontend,
        ...PR_REQUIRED_JOBS.schema,
        ...PR_REQUIRED_JOBS.dependencies,
        ...PR_REQUIRED_JOBS.rust,
        ...PR_REQUIRED_JOBS.workflow,
        ...PR_REQUIRED_JOBS.docs,
      ].map((job) => [job, 'skipped']),
    );
    const jsSuccess = Object.fromEntries(PR_REQUIRED_JOBS.js.map((job) => [job, 'success']));
    expect(verifyRequiredResults({ ...jsSuccess, ...skipped, 'fast-unit-3': 'failure' }, selected, 60)).toContain(
      'fast-unit-3=failure',
    );
    expect(verifyRequiredResults({ ...jsSuccess, ...skipped }, selected, PR_REQUIRED_BUDGET_SECONDS + 1)).toContain(
      'required validation exceeded 240s (241s)',
    );
  });

  test('accepts an in-budget affected plan only when every lane has an exact disposition', () => {
    const results: Record<string, string> = Object.fromEntries(
      [...PR_REQUIRED_JOBS.js, ...PR_REQUIRED_JOBS.rust].map((job) => [job, 'success']),
    );
    for (const job of [
      ...PR_REQUIRED_JOBS.frontend,
      ...PR_REQUIRED_JOBS.schema,
      ...PR_REQUIRED_JOBS.dependencies,
      ...PR_REQUIRED_JOBS.workflow,
      ...PR_REQUIRED_JOBS.docs,
    ])
      results[job] = 'skipped';
    expect(
      verifyRequiredResults(
        results,
        {
          js: true,
          frontend: false,
          schema: false,
          dependencies: false,
          rust: true,
          workflow: false,
          docs: false,
        },
        239,
      ),
    ).toEqual([]);
  });
});
