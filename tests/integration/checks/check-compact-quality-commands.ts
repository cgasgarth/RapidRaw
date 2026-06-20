#!/usr/bin/env bun
// @ts-check

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join, relative } from 'node:path';

import yaml from 'js-yaml';

const ROOT = process.cwd();
const WORKFLOW_DIR = '.github/workflows';
const COMPACT_WRAPPERS = ['scripts/run-compact-command.ts', 'scripts/run-compact-checks.ts'];
const QUALITY_COMMAND_PATTERNS = [
  /\beslint\b/u,
  /\btsc\b/u,
  /\bprettier\b/u,
  /\bbun audit\b/u,
  /\bcargo (audit|check|clippy|deny|fmt|test)\b/u,
  /\bgo run github\.com\/rhysd\/actionlint\/cmd\/actionlint/u,
];

const ALLOWED_WORKFLOW_COMMANDS = new Map([
  ['cargo fmt -p RapidRAW -- --check', 'Rust-only CI path avoids Bun setup; output is bounded to fmt failures.'],
  [
    'cargo audit --ignore RUSTSEC-2024-0429',
    'Rust-only CI path avoids Bun setup; waiver ledger is checked in package gates.',
  ],
  ['cargo deny check licenses', 'Rust-only CI path avoids Bun setup; deny output is bounded to license failures.'],
  [
    'cargo check --locked --no-default-features --features required-ci',
    'Main-only long validation keeps direct Rust command for compiler diagnostics.',
  ],
  [
    'cargo clippy --locked --all-targets --no-default-features --features required-ci -- -D warnings',
    'Main-only long validation keeps direct Rust command for clippy diagnostics.',
  ],
  [
    'cargo test --quiet --locked --all-targets --no-default-features --features required-ci --no-fail-fast',
    'Main-only long validation uses quiet cargo test output.',
  ],
  [
    'cargo check --locked --all-targets --all-features',
    'Scheduled OpenCV feature matrix keeps direct Rust command for optional-feature diagnostics.',
  ],
  [
    'cargo test --locked --all-targets --all-features opencv_spike -- --nocapture',
    'Scheduled OpenCV feature matrix intentionally captures spike diagnostics.',
  ],
]);

const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'));
const isQualityCommand = (command) => QUALITY_COMMAND_PATTERNS.some((pattern) => pattern.test(command));
const usesCompactWrapper = (command) => COMPACT_WRAPPERS.some((wrapper) => command.includes(wrapper));
const delegatesToPackageScript = (command) => /^bun run [a-z0-9:-]+$/u.test(command.trim());
const runsSelfContainedChecker = (command) =>
  /^bun tests\/integration\/checks\/check-[a-z0-9-]+\.ts(?:\s|$)/u.test(command.trim());
const normalizeCommand = (command) =>
  command
    .trim()
    .replace(/\\\n\s*/gu, ' ')
    .replace(/\s+/gu, ' ');
const shouldFlagCommand = (command) =>
  isQualityCommand(command) &&
  !usesCompactWrapper(command) &&
  !delegatesToPackageScript(command) &&
  !runsSelfContainedChecker(command);

const listWorkflowFiles = () => {
  const files = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir)) {
      const absolutePath = join(dir, entry);
      const stat = statSync(absolutePath);
      if (stat.isDirectory()) {
        walk(absolutePath);
        continue;
      }
      if (stat.isFile() && ['.yml', '.yaml'].includes(extname(entry))) {
        files.push(absolutePath);
      }
    }
  };
  walk(join(ROOT, WORKFLOW_DIR));
  return files;
};

const collectWorkflowRuns = (value, path = []) => {
  if (!value || typeof value !== 'object') return [];
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => collectWorkflowRuns(item, [...path, String(index)]));
  }

  const runs = [];
  for (const [key, child] of Object.entries(value)) {
    if (key === 'run' && typeof child === 'string') {
      runs.push({ path: [...path, key].join('.'), command: child });
      continue;
    }
    runs.push(...collectWorkflowRuns(child, [...path, key]));
  }
  return runs;
};

export const checkPackageScripts = (scripts) => {
  const violations = [];
  for (const [name, command] of Object.entries(scripts)) {
    if (typeof command !== 'string') continue;
    if (shouldFlagCommand(command)) {
      violations.push(`package.json:${name}: quality command must use compact wrapper or delegate to a package script`);
    }
  }
  return violations;
};

export const checkWorkflowRuns = (workflowRuns, allowlist = ALLOWED_WORKFLOW_COMMANDS) => {
  const violations = [];
  for (const { path, command } of workflowRuns) {
    const normalized = normalizeCommand(command);
    if (!shouldFlagCommand(normalized)) continue;
    if (
      [...allowlist.keys()].some(
        (allowedCommand) => normalized === allowedCommand || normalized.includes(allowedCommand),
      )
    )
      continue;
    violations.push(`${path}: raw quality command lacks compact wrapper or allowlist reason: ${normalized}`);
  }
  return violations;
};

const checkRepository = () => {
  const violations = checkPackageScripts(readJson('package.json').scripts ?? {});
  for (const file of listWorkflowFiles()) {
    const repoPath = relative(ROOT, file);
    const parsed = yaml.load(readFileSync(file, 'utf8'));
    const workflowRuns = collectWorkflowRuns(parsed).map((run) => ({
      path: `${repoPath}:${run.path}`,
      command: run.command,
    }));
    violations.push(...checkWorkflowRuns(workflowRuns));
  }
  return violations;
};

const runSelfTest = () => {
  const packageViolations = checkPackageScripts({
    good: 'bun scripts/run-compact-command.ts --label lint -- eslint .',
    delegated: 'bun run check:lint',
    bad: 'eslint . --max-warnings 0',
  });
  const workflowViolations = checkWorkflowRuns(
    [
      { path: 'workflow.good', command: 'bun run check:lint' },
      { path: 'workflow.allowed', command: 'cargo fmt -p RapidRAW -- --check' },
      { path: 'workflow.bad', command: 'cargo check --locked' },
    ],
    new Map([['cargo fmt -p RapidRAW -- --check', 'bounded fmt output']]),
  );

  if (packageViolations.length !== 1 || !packageViolations[0].includes('bad')) {
    throw new Error('self-test failed: package raw command policy mismatch');
  }
  if (workflowViolations.length !== 1 || !workflowViolations[0].includes('workflow.bad')) {
    throw new Error('self-test failed: workflow raw command policy mismatch');
  }
  console.log('compact quality command self-test ok');
};

if (process.argv.includes('--self-test')) {
  runSelfTest();
  process.exit(0);
}

const violations = checkRepository();
if (violations.length > 0) {
  console.error('Compact quality command policy failed:');
  console.error(violations.slice(0, 20).join('\n'));
  process.exit(1);
}

console.log('compact quality commands ok');
