#!/usr/bin/env bun

import { readFileSync } from 'node:fs';

import { BUN_COVERAGE_FLOORS } from '../../../scripts/ci/check-bun-coverage.ts';
import { buildBunCoverageCommand } from '../../../scripts/ci/run-bun-coverage.ts';
import { buildRandomizedTestArgs } from '../../../scripts/ci/run-bun-randomized-tests.ts';
import { buildBunUnitCommand } from '../../../scripts/ci/run-bun-unit.ts';
import { MAIN_FRONTEND_LANES, mainFrontendClosureFailures } from '../../../scripts/ci/verify-main-frontend-closure.ts';

type Step = {
  env?: Record<string, string>;
  name?: string;
  run?: string;
  uses?: string;
  with?: Record<string, unknown>;
};
type Job = {
  if?: string;
  name?: string;
  needs?: string[];
  'runs-on'?: string;
  steps?: Step[];
  'timeout-minutes'?: number;
};
type Workflow = { jobs?: Record<string, Job> };

const workflow = Bun.YAML.parse(readFileSync('.github/workflows/main-long-validation.yml', 'utf8')) as Workflow;
const jobs = workflow.jobs ?? {};
const packageScripts =
  (JSON.parse(readFileSync('package.json', 'utf8')) as { scripts?: Record<string, string> }).scripts ?? {};
const expectedCommands: Readonly<Record<(typeof MAIN_FRONTEND_LANES)[number], readonly string[]>> = {
  'frontend-static': ['bun run lint', 'bun run format:check', 'bun run typecheck'],
  'frontend-contracts': [
    'bun run check:schema',
    'bunx i18next-cli lint',
    'bunx i18next-cli extract --ci --dry-run',
    'bunx knip --config knip.jsonc --dependencies --reporter compact',
    'bun tests/integration/checks/check-script-extension-policy.ts',
    'bun tests/integration/checks/check-unsafe-casts.ts',
    'bun tests/integration/checks/editor/check-editor-render-authority-boundary.ts',
    'bun run check:docs',
  ],
  'frontend-unit': ['bun run test:unit'],
  'frontend-coverage': ['bun run test:coverage'],
  'frontend-randomized': ['bun run test:randomized'],
  'frontend-browser': [
    'bunx playwright install chromium',
    'bun run check:browser-harness',
    'bun tests/integration/checks/editor/check-section-disclosure-edit-authority-browser.ts',
    'bun scripts/proofs/capture-visual-smoke.ts --scenario empty-library',
  ],
  'frontend-bundle': ['bun run check:bundle', 'bun scripts/ci/write-vite-bundle-step-summary.ts'],
};

for (const lane of MAIN_FRONTEND_LANES) {
  const job = jobs[lane];
  if (job === undefined) throw new Error(`Main frontend workflow is missing ${lane}.`);
  if (job.needs !== undefined) throw new Error(`${lane} must start independently, without needs.`);
  if (job['runs-on'] !== 'ubuntu-latest') throw new Error(`${lane} must use the maintained Linux runner.`);
  if ((job['timeout-minutes'] ?? 0) <= 0 || (job['timeout-minutes'] ?? 0) > 25)
    throw new Error(`${lane} must retain a bounded, lane-sized timeout.`);
  if (!job.steps?.some((step) => step.uses === './.github/actions/setup-bun-deps'))
    throw new Error(`${lane} must use the maintained Bun dependency setup.`);
  const commands =
    job.steps?.flatMap(
      (step) =>
        step.run
          ?.split('\n')
          .map((line) => line.trim())
          .filter(Boolean) ?? [],
    ) ?? [];
  for (const command of expectedCommands[lane]) {
    if (commands.filter((candidate) => candidate === command).length !== 1)
      throw new Error(`${lane} must execute ${command} exactly once.`);
  }
  if (commands.some((command) => /\bturbo\b|--cache|run-resource-coordinated/u.test(command)))
    throw new Error(`${lane} introduced a cache or custom scheduler instead of native Bun/GHA execution.`);
}

const allLaneCommands = MAIN_FRONTEND_LANES.flatMap(
  (lane) => jobs[lane]?.steps?.flatMap((step) => step.run?.split('\n').map((line) => line.trim()) ?? []) ?? [],
);
if (allLaneCommands.filter((command) => command === 'bun run check:bundle').length !== 1)
  throw new Error('The production Vite bundle must be built and validated exactly once.');
if (allLaneCommands.some((command) => command === 'bun scripts/ci/generate-vite-bundle-report.ts'))
  throw new Error('Bundle reporting must consume the report already produced by check:bundle.');
const unitCommand = buildBunUnitCommand();
const coverageCommand = buildBunCoverageCommand();
const randomizedCommand = ['bun', ...buildRandomizedTestArgs(42)];
for (const [name, command] of [
  ['unit', unitCommand],
  ['coverage', coverageCommand],
  ['randomized', randomizedCommand],
] as const) {
  if (!command.includes('--parallel')) throw new Error(`${name} lost Bun-native parallel scheduling.`);
  if (command.some((argument) => /^--parallel=|^--parallel-delay=|^--shard|^--retry$/u.test(argument)))
    throw new Error(`${name} introduced worker staging, shards, retries, or a forced worker count.`);
}
if (!unitCommand.includes('--only-failures')) throw new Error('The Bun unit boundary lost actionable failure output.');
if (!coverageCommand.includes('--coverage')) throw new Error('The Bun coverage boundary lost native LCOV generation.');
if (!randomizedCommand.some((argument) => argument === '--seed=42'))
  throw new Error('The randomized boundary lost its reproducible seed.');

const bunConfig = Bun.TOML.parse(readFileSync('bunfig.toml', 'utf8')) as {
  test?: {
    coverageDir?: string;
    coveragePathIgnorePatterns?: string[];
    coverageReporter?: string[];
    coverageSkipTestFiles?: boolean;
  };
};
const coverageConfig = bunConfig.test;
if (BUN_COVERAGE_FLOORS.lines < 0.66 || BUN_COVERAGE_FLOORS.functions < 0.69)
  throw new Error('Bun native LCOV coverage thresholds may only ratchet upward from the measured baseline.');
if (coverageConfig?.coverageSkipTestFiles !== true)
  throw new Error('Bun native coverage must exclude test files from product coverage.');
if (coverageConfig?.coverageDir !== 'artifacts/bun-coverage')
  throw new Error('Bun native coverage must write to the ignored artifact tree.');
if (coverageConfig?.coverageReporter?.toSorted().join(',') !== 'lcov')
  throw new Error('Bun native coverage must publish the compact LCOV report consumed by its global summary gate.');
const allowedCoverageExclusions = ['fixtures/**', 'src/@types/resources.d.ts', 'tests/**'];
if (coverageConfig?.coveragePathIgnorePatterns?.toSorted().join(',') !== allowedCoverageExclusions.join(','))
  throw new Error('Bun coverage exclusions must remain limited to documented generated/test-only paths.');
for (const command of [
  'bun run build',
  'check-vite-product-bundle-guard.ts',
  'check-vite-production-payload.ts',
  'check-vite-bundle-budget.ts',
  'generate-vite-bundle-report.ts',
]) {
  if (!packageScripts['check:bundle']?.includes(command)) throw new Error(`The single bundle lane lost ${command}.`);
}
for (const command of ['check-edit-command-bus.ts', 'check-schema-contract-gate.ts']) {
  if (!packageScripts['check:schema']?.includes(command)) throw new Error(`The schema lane lost ${command}.`);
}

const bundle = jobs['frontend-bundle'];
const upload = bundle?.steps?.find((step) => step.name === 'Upload bundle analysis report');
if (!upload?.uses?.startsWith('actions/upload-artifact@')) throw new Error('Bundle report upload must stay pinned.');
if (!String(upload.with?.name).includes('github.sha') || upload.with?.['if-no-files-found'] !== 'error')
  throw new Error('Bundle report artifact must be commit-addressed and fail closed when missing.');

const coverage = jobs['frontend-coverage'];
const coverageUpload = coverage?.steps?.find((step) => step.name === 'Upload Bun coverage report');
if (!coverageUpload?.uses?.startsWith('actions/upload-artifact@'))
  throw new Error('Bun coverage upload must stay pinned.');
if (
  !String(coverageUpload.with?.name).includes('github.sha') ||
  coverageUpload.with?.path !== 'artifacts/bun-coverage/lcov.info' ||
  coverageUpload.with?.['if-no-files-found'] !== 'error'
)
  throw new Error('Bun coverage artifact must be commit-addressed, compact, and fail closed when missing.');
const randomizedStep = jobs['frontend-randomized']?.steps?.find(
  (step) => step.name === 'Repeat the Bun suite in a reproducible random order',
);
if (randomizedStep?.env?.RAWENGINE_BUN_TEST_SEED !== '${{ github.run_id }}')
  throw new Error('Randomized Bun tests must derive a reproducible seed from the main workflow run.');

const closure = jobs['frontend-full'];
if (closure?.if !== '${{ always() }}') throw new Error('Frontend closure must run after failures.');
if (closure.needs?.toSorted().join(',') !== [...MAIN_FRONTEND_LANES].toSorted().join(','))
  throw new Error('Frontend closure must depend on every parallel lane exactly once.');
const closureStep = closure.steps?.find((step) => step.name === 'Fail closed on any frontend lane failure');
if (
  closureStep?.run !== 'bun scripts/ci/verify-main-frontend-closure.ts' ||
  closureStep.env?.NEEDS_CONTEXT === undefined
)
  throw new Error('Frontend closure must verify the complete native needs context.');

const successes = Object.fromEntries(MAIN_FRONTEND_LANES.map((lane) => [lane, { result: 'success' }]));
if (mainFrontendClosureFailures(successes).length !== 0) throw new Error('Successful frontend lanes did not close.');
const failed = { ...successes, 'frontend-browser': { result: 'failure' } };
if (mainFrontendClosureFailures(failed).join(',') !== 'frontend-browser=failure')
  throw new Error('Frontend closure did not fail on a failed independent lane.');

console.log('main-long frontend contract ok (seven parallel native Bun/GHA lanes, fail-closed aggregate)');
