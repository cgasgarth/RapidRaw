#!/usr/bin/env bun

import { classesForPath } from '../validation/ownership';

export const PR_REQUIRED_BUDGET_SECONDS = 240;

export const resolveWorkflowStartedEpoch = (value: string | undefined, nowEpoch: number): number => {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0 || parsed > nowEpoch) {
    throw new Error('workflow start epoch must come from the Actions run_started_at timestamp');
  }
  return parsed;
};

export type PrFastLane = 'js' | 'frontend' | 'schema' | 'dependencies' | 'rust' | 'workflow' | 'docs';

export const PR_REQUIRED_JOBS: Readonly<Record<PrFastLane, readonly string[]>> = {
  js: ['fast-lint', 'fast-typecheck', 'fast-contract-tests', 'fast-format'],
  frontend: ['fast-build-i18n', 'fast-unsafe-unused', 'fast-visual'],
  schema: ['fast-schema'],
  dependencies: ['fast-js-security'],
  rust: ['fast-rust'],
  workflow: ['fast-workflow'],
  docs: ['fast-docs'],
};

export interface PrValidationPlan {
  lanes: Record<PrFastLane, boolean>;
  deferredToMain: string[];
  changedPaths: string[];
}

const allDeferred = [
  'environment-sensitive full unit suite',
  'full native required closure',
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
  if (process.argv.includes('--verify')) {
    const needs = JSON.parse(process.env.NEEDS_CONTEXT ?? '{}') as Record<string, { result?: string }>;
    const plan = JSON.parse(process.env.PLAN_JSON ?? '{}') as PrValidationPlan;
    const startedEpoch = Number(process.env.STARTED_EPOCH);
    const elapsedSeconds = Math.max(0, Math.floor(Date.now() / 1000) - startedEpoch);
    const failures = verifyRequiredResults(
      Object.fromEntries(Object.entries(needs).map(([job, value]) => [job, value.result ?? 'missing'])),
      plan.lanes,
      elapsedSeconds,
    );
    const summary = process.env.GITHUB_STEP_SUMMARY;
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
  const nowEpoch = Math.floor(Date.now() / 1000);
  const startedEpoch = resolveWorkflowStartedEpoch(process.env.WORKFLOW_STARTED_EPOCH, nowEpoch);
  const output = process.env.GITHUB_OUTPUT;
  if (output) {
    const lines = [
      ...Object.entries(plan.lanes).map(([lane, selected]) => `${lane}=${selected}`),
      `plan_json=${JSON.stringify(plan)}`,
      `started_epoch=${startedEpoch}`,
    ];
    await Bun.write(
      output,
      `${await Bun.file(output)
        .text()
        .catch(() => '')}${lines.join('\n')}\n`,
    );
  }
  const summary = process.env.GITHUB_STEP_SUMMARY;
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
