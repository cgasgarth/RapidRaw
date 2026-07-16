import { describe, expect, test } from 'bun:test';
import {
  fetchWorkflowJobsJson,
  PR_REQUIRED_BUDGET_SECONDS,
  PR_REQUIRED_JOBS,
  parseWorkflowJobTimings,
  planPrValidation,
  requiredExecutionElapsedSeconds,
  verifyRequiredResults,
} from '../../../scripts/ci/pr-ci-contract';

describe('four-minute PR CI contract', () => {
  test('retries transient GitHub API responses with bounded deterministic backoff', async () => {
    const responses = [503, 429, 502, 200].map(
      (status) => new Response(status === 200 ? '{"jobs":[]}' : '{"message":"transient"}', { status }),
    );
    const delays: number[] = [];
    const diagnostics: string[] = [];
    const body = await fetchWorkflowJobsJson('owner/repo', '123', 'token', {
      fetchImpl: async () => responses.shift() ?? new Response('missing', { status: 500 }),
      jitter: () => 0,
      onDiagnostic: (message) => diagnostics.push(message),
      sleep: async (delayMs) => {
        delays.push(delayMs);
      },
    });
    expect(body).toBe('{"jobs":[]}');
    expect(delays).toEqual([250, 500, 1_000]);
    expect(diagnostics).toEqual([
      'GitHub API jobs request HTTP 503; retry 1/5 in 250ms',
      'GitHub API jobs request HTTP 429; retry 2/5 in 500ms',
      'GitHub API jobs request HTTP 502; retry 3/5 in 1000ms',
    ]);
  });

  test('fails immediately for authentication and other client errors', async () => {
    const calls: number[] = [];
    await expect(
      fetchWorkflowJobsJson('owner/repo', '123', 'token', {
        fetchImpl: async () => {
          calls.push(1);
          return new Response('{"message":"bad credentials"}', { status: 401 });
        },
        sleep: async () => undefined,
      }),
    ).rejects.toThrow('GitHub API jobs request failed HTTP 401: {"message":"bad credentials"}');
    expect(calls).toHaveLength(1);
  });

  test('fails closed after exhausting transient retries', async () => {
    const delays: number[] = [];
    await expect(
      fetchWorkflowJobsJson('owner/repo', '123', 'token', {
        fetchImpl: async () => new Response('{"message":"unavailable"}', { status: 503 }),
        jitter: () => 1,
        onDiagnostic: () => undefined,
        sleep: async (delayMs) => {
          delays.push(delayMs);
        },
      }),
    ).rejects.toThrow('GitHub API jobs request failed HTTP 503 after 6 attempts');
    expect(delays).toEqual([500, 750, 1_250, 2_250, 4_000]);
  });

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
          completed_at: '2026-07-13T23:24:45.000Z',
          name: 'pr fast: validation harness compile',
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
        {
          completedAt: '2026-07-13T23:25:05.000Z',
          name: 'pr fast: validation harness compile',
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
