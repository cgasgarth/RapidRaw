#!/usr/bin/env bun

import { z } from 'zod';
import { classesForPath } from '../validation/ownership';

export const PR_REQUIRED_BUDGET_SECONDS = 240;

export const PR_CI_GITHUB_API_RETRY = {
  baseDelayMs: 250,
  jitterMs: 250,
  maxAttempts: 6,
  maxDelayMs: 4_000,
} as const;

export interface GitHubApiRetryOptions {
  fetchImpl?: (input: string, init?: RequestInit) => Promise<Response>;
  jitter?: () => number;
  onDiagnostic?: (message: string) => void;
  sleep?: (delayMs: number) => Promise<void>;
}

const compactApiDetail = (body: string): string => body.replace(/\s+/gu, ' ').trim().slice(0, 160);

const isRetryableGitHubStatus = (status: number): boolean => status === 429 || (status >= 500 && status <= 599);

export const fetchWorkflowJobsJson = async (
  repository: string,
  runId: string,
  token: string,
  options: GitHubApiRetryOptions = {},
): Promise<string> => {
  const fetchImpl = options.fetchImpl ?? fetch;
  const jitter = options.jitter ?? Math.random;
  const onDiagnostic = options.onDiagnostic ?? ((message: string) => console.error(message));
  const sleep = options.sleep ?? ((delayMs: number) => Bun.sleep(delayMs));
  const endpoint = `https://api.github.com/repos/${repository}/actions/runs/${runId}/jobs?filter=latest&per_page=100`;

  for (let attempt = 1; attempt <= PR_CI_GITHUB_API_RETRY.maxAttempts; attempt += 1) {
    let response: Response;
    try {
      response = await fetchImpl(endpoint, {
        headers: {
          Accept: 'application/vnd.github+json',
          Authorization: `Bearer ${token}`,
          'X-GitHub-Api-Version': '2022-11-28',
        },
      });
    } catch (error) {
      const detail = error instanceof Error ? compactApiDetail(error.message) : 'request failed';
      if (attempt === PR_CI_GITHUB_API_RETRY.maxAttempts) {
        throw new Error(`GitHub API jobs request failed after ${attempt} attempts: ${detail}`);
      }
      const delayMs = Math.min(
        PR_CI_GITHUB_API_RETRY.maxDelayMs,
        PR_CI_GITHUB_API_RETRY.baseDelayMs * 2 ** (attempt - 1) +
          Math.floor(Math.max(0, Math.min(1, jitter())) * PR_CI_GITHUB_API_RETRY.jitterMs),
      );
      onDiagnostic(
        `GitHub API jobs request error (${detail}); retry ${attempt}/${PR_CI_GITHUB_API_RETRY.maxAttempts - 1} in ${delayMs}ms`,
      );
      await sleep(delayMs);
      continue;
    }

    const body = await response.text();
    if (response.ok) return body;
    const detail = compactApiDetail(body);
    if (!isRetryableGitHubStatus(response.status)) {
      throw new Error(`GitHub API jobs request failed HTTP ${response.status}${detail ? `: ${detail}` : ''}`);
    }
    if (attempt === PR_CI_GITHUB_API_RETRY.maxAttempts) {
      throw new Error(
        `GitHub API jobs request failed HTTP ${response.status} after ${attempt} attempts${detail ? `: ${detail}` : ''}`,
      );
    }
    const delayMs = Math.min(
      PR_CI_GITHUB_API_RETRY.maxDelayMs,
      PR_CI_GITHUB_API_RETRY.baseDelayMs * 2 ** (attempt - 1) +
        Math.floor(Math.max(0, Math.min(1, jitter())) * PR_CI_GITHUB_API_RETRY.jitterMs),
    );
    onDiagnostic(
      `GitHub API jobs request HTTP ${response.status}; retry ${attempt}/${PR_CI_GITHUB_API_RETRY.maxAttempts - 1} in ${delayMs}ms`,
    );
    await sleep(delayMs);
  }
  throw new Error('GitHub API jobs request exhausted retry budget');
};

export type PrFastLane = 'js' | 'frontend' | 'schema' | 'dependencies' | 'rust' | 'workflow' | 'docs';

export const PR_REQUIRED_JOBS: Readonly<Record<PrFastLane, readonly string[]>> = {
  js: ['fast-lint', 'fast-typecheck', 'fast-fallow-health', 'fast-contract-tests', 'fast-format'],
  frontend: ['fast-build-i18n', 'fast-unsafe-unused', 'fast-visual'],
  schema: ['fast-schema'],
  dependencies: ['fast-js-security'],
  rust: ['fast-rust', 'fast-validation-harness'],
  workflow: ['fast-workflow'],
  docs: ['fast-docs'],
};

export const PR_REQUIRED_JOB_NAMES: Readonly<Record<string, string>> = {
  'fast-build-i18n': 'pr fast: frontend build and i18n',
  'fast-contract-tests': 'pr fast: affected contract tests',
  'fast-docs': 'pr fast: documentation contracts',
  'fast-format': 'pr fast: format',
  'fast-fallow-health': 'pr fast: Fallow health',
  'fast-js-security': 'pr fast: JavaScript audit',
  'fast-lint': 'pr fast: lint',
  'fast-rust': 'pr fast: affected native feedback',
  'fast-validation-harness': 'pr fast: validation harness compile',
  'fast-schema': 'pr fast: schema contracts',
  'fast-typecheck': 'pr fast: typecheck',
  'fast-unsafe-unused': 'pr fast: unsafe and unused dependency policy',
  'fast-visual': 'pr fast: visual smoke',
  'fast-workflow': 'pr fast: workflow contracts',
};

const workflowJobsSchema = z.object({
  jobs: z.array(
    z.object({
      completed_at: z.string().datetime().nullable(),
      name: z.string(),
      started_at: z.string().datetime(),
    }),
  ),
});

export interface WorkflowJobTiming {
  completedAt: string | null;
  name: string;
  startedAt: string;
}

export const parseWorkflowJobTimings = (value: unknown): WorkflowJobTiming[] =>
  workflowJobsSchema.parse(value).jobs.map((job) => ({
    completedAt: job.completed_at,
    name: job.name,
    startedAt: job.started_at,
  }));

export const requiredExecutionElapsedSeconds = (
  jobs: readonly WorkflowJobTiming[],
  selected: Readonly<Record<PrFastLane, boolean>>,
): number => {
  const plan = jobs.find((job) => job.name === 'validation: affected fast-lane plan');
  if (!plan || plan.completedAt === null) throw new Error('required validation plan timing is missing or incomplete');
  const selectedJobNames = Object.entries(PR_REQUIRED_JOBS).flatMap(([lane, jobIds]) =>
    selected[lane as PrFastLane] ? jobIds.map((jobId) => PR_REQUIRED_JOB_NAMES[jobId]) : [],
  );
  if (selectedJobNames.some((name) => name === undefined)) throw new Error('required job name mapping is incomplete');
  const selectedJobs = selectedJobNames.map((name) => jobs.find((job) => job.name === name));
  const completedSelectedJobs = selectedJobs.filter(
    (job): job is WorkflowJobTiming => job !== undefined && job.completedAt !== null,
  );
  if (completedSelectedJobs.length !== selectedJobs.length) {
    throw new Error('selected required job timing is missing or incomplete');
  }
  const durationMs = (job: WorkflowJobTiming): number => {
    const startedAt = Date.parse(job.startedAt);
    const completedAt = Date.parse(job.completedAt ?? '');
    if (!Number.isFinite(startedAt) || !Number.isFinite(completedAt) || completedAt < startedAt) {
      throw new Error(`required validation timing is invalid for ${job.name}`);
    }
    return completedAt - startedAt;
  };
  const slowestSelectedMs = Math.max(0, ...completedSelectedJobs.map(durationMs));
  return Math.ceil((durationMs(plan) + slowestSelectedMs) / 1000);
};

export interface PrValidationPlan {
  lanes: Record<PrFastLane, boolean>;
  deferredToMain: string[];
  changedPaths: string[];
}

const allDeferred = [
  'environment-sensitive full unit suite',
  'validation DAG resource-coordinator suite tracked by #5440',
  'full native required closure',
  'native optional-dependency boundary and system-library closure',
  'full Rust clippy and capability matrices',
  'macOS app build and startup benchmark',
  'hardware and long runtime validation',
  'exhaustive dependency security and license audits',
] as const;

export const planPrValidation = (paths: readonly string[]): PrValidationPlan => {
  const changedPaths = [...new Set(paths.filter(Boolean))].sort();
  const failClosed = changedPaths.length === 0;
  const classes = new Set(changedPaths.flatMap((path) => classesForPath(path)));
  const dependencies = classes.has('dependencies');
  return {
    lanes: {
      js: failClosed || dependencies || classes.has('frontend') || classes.has('schema') || classes.has('scripts'),
      frontend: failClosed || dependencies || classes.has('frontend') || classes.has('schema'),
      schema: failClosed || dependencies || classes.has('schema') || classes.has('frontend'),
      dependencies: failClosed || dependencies,
      rust: failClosed || dependencies || classes.has('rust'),
      workflow: failClosed || classes.has('workflows'),
      docs: failClosed || classes.has('docs'),
    },
    deferredToMain: [...allDeferred],
    changedPaths,
  };
};

export const verifyRequiredResults = (
  results: Readonly<Record<string, string>>,
  selected: Readonly<Record<PrFastLane, boolean>>,
  elapsedSeconds: number,
): string[] => {
  const failures: string[] = [];
  for (const lane of ['js', 'frontend', 'schema', 'dependencies', 'rust', 'workflow', 'docs'] as const) {
    for (const job of PR_REQUIRED_JOBS[lane]) {
      const result = results[job];
      if (selected[lane] && result !== 'success') failures.push(`${job}=${result ?? 'missing'}`);
      if (!selected[lane] && result !== 'skipped') failures.push(`${job}=${result ?? 'missing'} (expected skipped)`);
    }
  }
  if (!Number.isFinite(elapsedSeconds) || elapsedSeconds < 0) failures.push('invalid elapsed time');
  if (elapsedSeconds > PR_REQUIRED_BUDGET_SECONDS) {
    failures.push(`required validation exceeded ${PR_REQUIRED_BUDGET_SECONDS}s (${elapsedSeconds}s)`);
  }
  return failures;
};

const valueAfter = (flag: string): string | undefined => {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : undefined;
};

if (import.meta.main) {
  if (process.argv.includes('--fetch-jobs')) {
    const repository = process.env['GITHUB_REPOSITORY'];
    const runId = process.env['GITHUB_RUN_ID'];
    const token = process.env['GH_TOKEN'];
    if (!repository || !runId || !token) {
      console.error('GITHUB_REPOSITORY, GITHUB_RUN_ID, and GH_TOKEN are required to fetch workflow jobs');
      process.exit(1);
    }
    try {
      process.stdout.write(await fetchWorkflowJobsJson(repository, runId, token));
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
    process.exit(0);
  }
  if (process.argv.includes('--verify')) {
    const needs = JSON.parse(process.env['NEEDS_CONTEXT'] ?? '{}') as Record<string, { result?: string }>;
    const plan = JSON.parse(process.env['PLAN_JSON'] ?? '{}') as PrValidationPlan;
    const jobs = parseWorkflowJobTimings(JSON.parse(process.env['JOBS_CONTEXT'] ?? '{}'));
    const elapsedSeconds = requiredExecutionElapsedSeconds(jobs, plan.lanes);
    const failures = verifyRequiredResults(
      Object.fromEntries(Object.entries(needs).map(([job, value]) => [job, value.result ?? 'missing'])),
      plan.lanes,
      elapsedSeconds,
    );
    const summary = process.env['GITHUB_STEP_SUMMARY'];
    if (summary) {
      const previous = await Bun.file(summary)
        .text()
        .catch(() => '');
      await Bun.write(
        summary,
        `${previous}## Required aggregate\n\n- Elapsed: ${elapsedSeconds}s / ${PR_REQUIRED_BUDGET_SECONDS}s\n- Deferred to main: ${plan.deferredToMain.join('; ')}\n- Result: ${failures.length === 0 ? 'pass' : `fail (${failures.join(', ')})`}\n`,
      );
    }
    if (failures.length > 0) {
      console.error(failures.join('\n'));
      process.exit(1);
    }
    console.log(`PR CI / required ok (${elapsedSeconds}s)`);
    process.exit(0);
  }
  const pathsFile = valueAfter('--paths-file');
  if (!pathsFile) throw new Error('--paths-file is required');
  const plan = planPrValidation((await Bun.file(pathsFile).text()).split(/\r?\n/));
  const output = process.env['GITHUB_OUTPUT'];
  if (output) {
    const lines = [
      ...Object.entries(plan.lanes).map(([lane, selected]) => `${lane}=${selected}`),
      `plan_json=${JSON.stringify(plan)}`,
    ];
    await Bun.write(
      output,
      `${await Bun.file(output)
        .text()
        .catch(() => '')}${lines.join('\n')}\n`,
    );
  }
  const summary = process.env['GITHUB_STEP_SUMMARY'];
  if (summary) {
    const selected = Object.entries(plan.lanes)
      .filter(([, enabled]) => enabled)
      .map(([lane]) => `\`${lane}\``)
      .join(', ');
    await Bun.write(
      summary,
      `## PR validation plan\n\nFast lanes: ${selected || 'none'}\n\nDeferred to non-canceling main validation:\n${plan.deferredToMain.map((lane) => `- ${lane}`).join('\n')}\n`,
    );
  }
  console.log(`pr-ci-plan ok (${plan.changedPaths.length} paths)`);
}
