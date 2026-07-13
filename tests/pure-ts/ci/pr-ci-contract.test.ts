import { describe, expect, test } from 'bun:test';
import {
  PR_REQUIRED_BUDGET_SECONDS,
  PR_REQUIRED_JOBS,
  parseWorkflowJobTimings,
  planPrValidation,
  requiredExecutionElapsedSeconds,
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
    expect(plan.deferredToMain).toContain('native optional-dependency boundary and system-library closure');
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

  test('measures the parallel critical path without charging runner or aggregate queue delay', () => {
    const jobs = parseWorkflowJobTimings({
      jobs: [
        {
          completed_at: '2026-07-13T23:23:49.000Z',
          name: 'validation: affected fast-lane plan',
          started_at: '2026-07-13T23:23:31.000Z',
        },
        {
          completed_at: '2026-07-13T23:24:54.000Z',
          name: 'pr fast: affected native feedback',
          started_at: '2026-07-13T23:24:05.000Z',
        },
        {
          completed_at: null,
          name: 'PR CI / required',
          started_at: '2026-07-13T23:30:07.000Z',
        },
      ],
    });
    expect(
      requiredExecutionElapsedSeconds(jobs, {
        js: false,
        frontend: false,
        schema: false,
        dependencies: false,
        rust: true,
        workflow: false,
        docs: false,
      }),
    ).toBe(67);
  });

  test('fails closed on missing selected timings and preserves the 240-second execution budget', () => {
    const selected = {
      js: false,
      frontend: false,
      schema: false,
      dependencies: false,
      rust: true,
      workflow: false,
      docs: false,
    };
    const plan = {
      completedAt: '2026-07-13T23:23:49.000Z',
      name: 'validation: affected fast-lane plan',
      startedAt: '2026-07-13T23:23:31.000Z',
    };
    expect(() => requiredExecutionElapsedSeconds([plan], selected)).toThrow('missing or incomplete');
    const elapsed = requiredExecutionElapsedSeconds(
      [
        plan,
        {
          completedAt: '2026-07-13T23:27:48.000Z',
          name: 'pr fast: affected native feedback',
          startedAt: '2026-07-13T23:24:05.000Z',
        },
      ],
      selected,
    );
    expect(elapsed).toBe(241);
    expect(verifyRequiredResults({}, selected, elapsed)).toContain('required validation exceeded 240s (241s)');
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
    expect(
      verifyRequiredResults({ ...jsSuccess, ...skipped, 'fast-contract-tests': 'failure' }, selected, 60),
    ).toContain('fast-contract-tests=failure');
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
