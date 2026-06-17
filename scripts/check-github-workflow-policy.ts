#!/usr/bin/env bun

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join, relative } from 'node:path';

import yaml from 'js-yaml';

const ROOT = process.cwd();
const WORKFLOW_DIR = join(ROOT, '.github/workflows');
const MAIN_BUILD_WORKFLOW_PATH = '.github/workflows/ci.yml';
const MAIN_LONG_WORKFLOW_PATH = '.github/workflows/main-long-validation.yml';
const REQUIRED_PR_WORKFLOW_PATH = '.github/workflows/lint.yml';
const REQUIRED_AGGREGATE_JOB_ID = 'pr-ci-required';
const REQUIRED_AGGREGATE_JOB_NAME = 'PR CI / required';
const WRITE_PERMISSION_ALLOWLIST = new Map([
  ['.github/workflows/ci.yml', 'manual build workflow publishes release artifacts'],
  [
    '.github/workflows/optional-platform-builds.yml',
    'manual optional build workflow publishes artifacts when requested',
  ],
  ['.github/workflows/release.yml', 'release workflow writes release notes and package artifacts'],
]);

function* walkYamlFiles(dir) {
  for (const entry of readdirSync(dir)) {
    const absolutePath = join(dir, entry);
    const stat = statSync(absolutePath);

    if (stat.isDirectory()) {
      yield* walkYamlFiles(absolutePath);
      continue;
    }

    if (stat.isFile() && ['.yaml', '.yml'].includes(extname(entry))) {
      yield absolutePath;
    }
  }
}

const stripComment = (line) => line.replace(/\s+#.*$/u, '');
const indentation = (line) => line.match(/^\s*/u)?.[0].length ?? 0;
const hasMainListEntry = (line) => /^\s*-\s*['"]?main['"]?\s*$/u.test(stripComment(line));
const hasMainInlineBranch = (line) => {
  const cleanLine = stripComment(line);
  return (
    /^\s*branches\s*:\s*['"]?main['"]?\s*$/u.test(cleanLine) ||
    /^\s*branches\s*:\s*\[[^\]]*['"]?main['"]?[^\]]*\]\s*$/u.test(cleanLine)
  );
};
const hasConcurrencyKey = (line) => /^\s*concurrency\s*:/u.test(stripComment(line));
const normalizeEventName = (eventName) => (eventName === true ? 'on' : eventName);
const getWorkflowEvents = (workflow) => workflow.on ?? workflow.true;
const hasWritePermission = (value) =>
  value === 'write' || (value && typeof value === 'object' && Object.values(value).some((child) => child === 'write'));
const isMacosRunner = (runsOn) =>
  Array.isArray(runsOn)
    ? runsOn.some(isMacosRunner)
    : typeof runsOn === 'string' && runsOn.toLowerCase().startsWith('macos-');

function getTopLevelSection(lines, key) {
  const startIndex = lines.findIndex((line) => new RegExp(`^${key}:`, 'u').test(stripComment(line)));
  if (startIndex < 0) return [];

  const section = [];
  for (let index = startIndex + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (line.trim() && indentation(line) === 0) break;
    section.push({ line, number: index + 1 });
  }

  return section;
}

function hasMainPushTrigger(lines) {
  const inlineOn = lines.find((line) => /^on:\s+/u.test(stripComment(line)));
  if (inlineOn && /\bpush\b/u.test(inlineOn)) {
    return true;
  }

  const onSection = getTopLevelSection(lines, 'on');
  const pushIndex = onSection.findIndex(({ line }) => /^\s*push\s*:/u.test(stripComment(line)));
  if (pushIndex < 0) {
    return onSection.some(({ line }) => /^\s*-\s*push\s*$/u.test(stripComment(line)));
  }

  const pushIndent = indentation(onSection[pushIndex].line);
  const pushBlock = [];
  for (let index = pushIndex + 1; index < onSection.length; index += 1) {
    const entry = onSection[index];
    if (entry.line.trim() && indentation(entry.line) <= pushIndent) break;
    pushBlock.push(entry);
  }

  if (pushBlock.length === 0) {
    return true;
  }

  const branchIndex = pushBlock.findIndex(({ line }) => /^\s*branches\s*:/u.test(stripComment(line)));
  if (branchIndex < 0) {
    return true;
  }

  if (hasMainInlineBranch(pushBlock[branchIndex].line)) {
    return true;
  }

  const branchIndent = indentation(pushBlock[branchIndex].line);
  const branchBlock = [];
  for (let index = branchIndex + 1; index < pushBlock.length; index += 1) {
    const entry = pushBlock[index];
    if (entry.line.trim() && indentation(entry.line) <= branchIndent) break;
    branchBlock.push(entry);
  }

  return branchBlock.some(({ line }) => hasMainListEntry(line));
}

function checkWorkflowFiles(files) {
  const violations = [];

  for (const { path, source } of files) {
    const lines = source.split(/\r?\n/u);

    if (hasMainPushTrigger(lines)) {
      lines.forEach((line, index) => {
        if (hasConcurrencyKey(line)) {
          violations.push(
            `${path}:${index + 1}: workflows that run on push to main must not define concurrency; main runs must proceed independently`,
          );
        }
      });
    }

    let parsed;
    try {
      parsed = yaml.load(source);
    } catch (error) {
      violations.push(
        `${path}: workflow YAML failed to parse: ${error instanceof Error ? error.message : String(error)}`,
      );
      continue;
    }

    if (!parsed || typeof parsed !== 'object') continue;

    const events = getWorkflowEvents(parsed);
    const eventKeys =
      events && typeof events === 'object' && !Array.isArray(events)
        ? Object.keys(events).map(normalizeEventName)
        : Array.isArray(events)
          ? events.map(normalizeEventName)
          : typeof events === 'string'
            ? [events]
            : [];

    if (eventKeys.includes('pull_request_target')) {
      violations.push(`${path}: pull_request_target is not allowed without an explicit policy allowlist`);
    }

    if (hasWritePermission(parsed.permissions) && !WRITE_PERMISSION_ALLOWLIST.has(path)) {
      violations.push(`${path}: write permissions require an allowlist reason`);
    }

    if (path === MAIN_BUILD_WORKFLOW_PATH && eventKeys.includes('push')) {
      violations.push(`${path}: full package build must stay manual to avoid main push macOS runner backlogs`);
    }

    if (path === MAIN_LONG_WORKFLOW_PATH) {
      const jobs = parsed.jobs;
      if (!jobs || typeof jobs !== 'object' || Array.isArray(jobs)) {
        violations.push(`${path}: main long validation must define jobs`);
      } else {
        for (const [jobId, job] of Object.entries(jobs)) {
          if (!job || typeof job !== 'object' || Array.isArray(job) || !isMacosRunner(job['runs-on'])) {
            continue;
          }

          const jobIf = job.if;
          if (typeof jobIf !== 'string' || !jobIf.includes('workflow_dispatch') || jobIf.includes('push')) {
            violations.push(
              `${path}: macOS job ${jobId} must not run on main push; use manual or scheduled validation to avoid runner backlogs`,
            );
          }
        }
      }
    }

    if (path !== REQUIRED_PR_WORKFLOW_PATH) continue;

    if (!eventKeys.includes('pull_request')) {
      violations.push(`${path}: required PR workflow must include pull_request`);
    }

    const pullRequestEvent =
      events && typeof events === 'object' && !Array.isArray(events) ? events.pull_request : undefined;
    if (
      pullRequestEvent &&
      typeof pullRequestEvent === 'object' &&
      ('paths' in pullRequestEvent || 'paths-ignore' in pullRequestEvent)
    ) {
      violations.push(`${path}: required PR workflow pull_request trigger must not use paths or paths-ignore`);
    }

    const jobs = parsed.jobs;
    const aggregateJob =
      jobs && typeof jobs === 'object' && !Array.isArray(jobs) ? jobs[REQUIRED_AGGREGATE_JOB_ID] : undefined;
    if (!aggregateJob || typeof aggregateJob !== 'object' || Array.isArray(aggregateJob)) {
      violations.push(`${path}: missing required aggregate job ${REQUIRED_AGGREGATE_JOB_ID}`);
      continue;
    }

    if (aggregateJob.name !== REQUIRED_AGGREGATE_JOB_NAME) {
      violations.push(`${path}: aggregate job name must remain "${REQUIRED_AGGREGATE_JOB_NAME}"`);
    }

    if (typeof aggregateJob.if !== 'string' || !aggregateJob.if.includes('always()')) {
      violations.push(`${path}: aggregate job must use if: always()`);
    }

    const aggregateSource = JSON.stringify(aggregateJob);
    if (
      !aggregateSource.includes('.value.result') ||
      !aggregateSource.includes('!=') ||
      !aggregateSource.includes('success') ||
      !aggregateSource.includes('exit 1')
    ) {
      violations.push(`${path}: aggregate job must fail when any needs result is not success`);
    }
  }

  return violations;
}

function checkRepositoryWorkflows() {
  const files = [];

  for (const file of walkYamlFiles(WORKFLOW_DIR)) {
    files.push({
      path: relative(ROOT, file),
      source: readFileSync(file, 'utf8'),
    });
  }

  return checkWorkflowFiles(files);
}

function runSelfTest() {
  const cases = [
    {
      name: 'rejects block main push concurrency',
      expectedViolations: 1,
      source: `name: blocked
on:
  push:
    branches:
      - main
concurrency:
  group: blocked-main
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - run: true
`,
    },
    {
      name: 'rejects inline main push concurrency',
      expectedViolations: 1,
      source: `name: blocked
on:
  push:
    branches: [main]
concurrency:
  group: blocked-main
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - run: true
`,
    },
    {
      name: 'rejects scalar main push concurrency',
      expectedViolations: 1,
      source: `name: blocked
on:
  push:
    branches: main
concurrency:
  group: blocked-main
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - run: true
`,
    },
    {
      name: 'rejects main push job concurrency',
      expectedViolations: 1,
      source: `name: blocked
on:
  push:
    branches:
      - main
jobs:
  test:
    runs-on: ubuntu-latest
    concurrency:
      group: blocked-main-job
    steps:
      - run: true
`,
    },
    {
      name: 'rejects main push matrix job concurrency',
      expectedViolations: 1,
      source: `name: blocked
on:
  push:
    branches:
      - main
jobs:
  test:
    strategy:
      matrix:
        lane:
          - a
          - b
    runs-on: ubuntu-latest
    concurrency:
      group: blocked-main-\${{ matrix.lane }}
    steps:
      - run: true
`,
    },
    {
      name: 'allows pull request concurrency',
      expectedViolations: 0,
      source: `name: allowed
on:
  pull_request:
concurrency:
  group: pr-validation
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - run: true
`,
    },
    {
      name: 'allows non-main push concurrency',
      expectedViolations: 0,
      source: `name: allowed
on:
  push:
    branches:
      - release
concurrency:
  group: release-validation
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - run: true
`,
    },
    {
      name: 'rejects main package build push',
      expectedViolations: 1,
      path: MAIN_BUILD_WORKFLOW_PATH,
      source: `name: CI Build
on:
  push:
    branches:
      - main
  workflow_dispatch:
jobs:
  build:
    runs-on: macos-14
    steps:
      - run: true
`,
    },
    {
      name: 'allows manual package build',
      expectedViolations: 0,
      path: MAIN_BUILD_WORKFLOW_PATH,
      source: `name: CI Build
on:
  workflow_dispatch:
jobs:
  build:
    runs-on: macos-14
    steps:
      - run: true
`,
    },
    {
      name: 'rejects main long macOS push job',
      expectedViolations: 1,
      path: MAIN_LONG_WORKFLOW_PATH,
      source: `name: Main Long Validation
on:
  push:
    branches:
      - main
jobs:
  main-macos-app-build:
    runs-on: macos-14
    steps:
      - run: true
`,
    },
    {
      name: 'allows manual main long macOS job',
      expectedViolations: 0,
      path: MAIN_LONG_WORKFLOW_PATH,
      source: `name: Main Long Validation
on:
  push:
    branches:
      - main
  schedule:
    - cron: '37 8 * * *'
  workflow_dispatch:
jobs:
  main-macos-app-build:
    if: \${{ github.event_name == 'workflow_dispatch' || github.event_name == 'schedule' }}
    runs-on: macos-14
    steps:
      - run: true
`,
    },
    {
      name: 'allows required PR aggregate policy',
      expectedViolations: 0,
      path: REQUIRED_PR_WORKFLOW_PATH,
      source: `name: Baseline Validation
on:
  push:
    branches:
      - main
  pull_request:
permissions:
  contents: read
jobs:
  frontend-lint:
    runs-on: ubuntu-latest
    steps:
      - run: true
  pr-ci-required:
    name: PR CI / required
    runs-on: ubuntu-latest
    needs:
      - frontend-lint
    if: always() && github.event_name == 'pull_request'
    steps:
      - run: |
          failures="$(jq -r 'to_entries[] | select(.value.result != "success")' <<< "$NEEDS_CONTEXT")"
          if [[ -n "$failures" ]]; then
            exit 1
          fi
`,
    },
    {
      name: 'rejects required PR workflow without pull_request',
      expectedViolations: 1,
      path: REQUIRED_PR_WORKFLOW_PATH,
      source: `name: Baseline Validation
on:
  push:
    branches:
      - main
jobs:
  pr-ci-required:
    name: PR CI / required
    if: always()
    steps:
      - run: |
          failures="$(jq -r 'to_entries[] | select(.value.result != "success")' <<< "$NEEDS_CONTEXT")"
          if [[ -n "$failures" ]]; then
            exit 1
          fi
`,
    },
    {
      name: 'rejects required PR paths filter',
      expectedViolations: 1,
      path: REQUIRED_PR_WORKFLOW_PATH,
      source: `name: Baseline Validation
on:
  pull_request:
    paths:
      - src/**
jobs:
  pr-ci-required:
    name: PR CI / required
    if: always()
    steps:
      - run: |
          failures="$(jq -r 'to_entries[] | select(.value.result != "success")' <<< "$NEEDS_CONTEXT")"
          if [[ -n "$failures" ]]; then
            exit 1
          fi
`,
    },
    {
      name: 'rejects renamed aggregate',
      expectedViolations: 1,
      path: REQUIRED_PR_WORKFLOW_PATH,
      source: `name: Baseline Validation
on:
  pull_request:
jobs:
  pr-ci-required:
    name: PR CI / optional
    if: always()
    steps:
      - run: |
          failures="$(jq -r 'to_entries[] | select(.value.result != "success")' <<< "$NEEDS_CONTEXT")"
          if [[ -n "$failures" ]]; then
            exit 1
          fi
`,
    },
    {
      name: 'rejects aggregate without always',
      expectedViolations: 1,
      path: REQUIRED_PR_WORKFLOW_PATH,
      source: `name: Baseline Validation
on:
  pull_request:
jobs:
  pr-ci-required:
    name: PR CI / required
    if: github.event_name == 'pull_request'
    steps:
      - run: |
          failures="$(jq -r 'to_entries[] | select(.value.result != "success")' <<< "$NEEDS_CONTEXT")"
          if [[ -n "$failures" ]]; then
            exit 1
          fi
`,
    },
    {
      name: 'rejects aggregate without needs failure check',
      expectedViolations: 1,
      path: REQUIRED_PR_WORKFLOW_PATH,
      source: `name: Baseline Validation
on:
  pull_request:
jobs:
  pr-ci-required:
    name: PR CI / required
    if: always()
    steps:
      - run: echo ok
`,
    },
    {
      name: 'rejects pull_request_target',
      expectedViolations: 1,
      source: `name: unsafe
on:
  pull_request_target:
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - run: true
`,
    },
    {
      name: 'rejects unallowlisted write permissions',
      expectedViolations: 1,
      source: `name: unsafe
on:
  pull_request:
permissions:
  contents: write
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - run: true
`,
    },
    {
      name: 'allows allowlisted write permissions',
      expectedViolations: 0,
      path: '.github/workflows/release.yml',
      source: `name: release
on:
  release:
    types: [created]
jobs:
  release:
    permissions:
      contents: write
    runs-on: ubuntu-latest
    steps:
      - run: true
`,
    },
  ];

  const failures = cases
    .map((testCase) => {
      const violations = checkWorkflowFiles([
        { path: testCase.path ?? `${testCase.name}.yml`, source: testCase.source },
      ]);
      if (violations.length === testCase.expectedViolations) {
        return null;
      }

      return `${testCase.name}: expected ${testCase.expectedViolations} violation(s), got ${violations.length}`;
    })
    .filter(Boolean);

  if (failures.length > 0) {
    console.error('GitHub workflow policy self-test failed.');
    console.error(failures.join('\n'));
    process.exit(1);
  }

  console.log('Validated GitHub workflow policy self-tests.');
}

if (process.argv.includes('--self-test')) {
  runSelfTest();
  process.exit(0);
}

const violations = checkRepositoryWorkflows();

if (violations.length > 0) {
  console.error('GitHub workflow policy validation failed.');
  console.error(violations.join('\n'));
  process.exit(1);
}

console.log('Validated GitHub workflow policies.');
