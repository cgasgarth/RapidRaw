#!/usr/bin/env bun

import { existsSync, rmSync, writeFileSync } from 'node:fs';
import { extname } from 'node:path';

const textDecoder = new TextDecoder();
const FORMAT_EXTENSIONS = new Set(['.css', '.html', '.json', '.jsonc', '.md', '.ts', '.tsx', '.yml', '.yaml']);
const LINT_EXTENSIONS = new Set(['.js', '.jsx', '.ts', '.tsx']);

interface CommandResult {
  code: number;
  stderr: string;
  stdout: string;
}

function run(command: Array<string>, label: string, quietSuccess = false): CommandResult {
  const result = Bun.spawnSync(command, {
    stderr: 'pipe',
    stdout: 'pipe',
  });
  const stdout = textDecoder.decode(result.stdout).trim();
  const stderr = textDecoder.decode(result.stderr).trim();
  if (result.exitCode === 0) {
    if (!quietSuccess) console.log(`${label} ok`);
  } else {
    console.error(`${label} failed`);
    console.error(`$ ${command.join(' ')}`);
    const output = [stdout, stderr].filter(Boolean).join('\n').split('\n').slice(-20).join('\n');
    if (output) console.error(output);
  }
  return { code: result.exitCode, stderr, stdout };
}

function gitLines(args: Array<string>): Array<string> {
  const result = run(['git', ...args], `git ${args[0] ?? 'cmd'}`, true);
  if (result.code !== 0) process.exit(result.code);
  return result.stdout.length === 0 ? [] : result.stdout.split('\n').filter(Boolean);
}

function unique(values: Array<string>): Array<string> {
  return [...new Set(values)].toSorted();
}

function collectChangedFiles(baseRef: string): Array<string> {
  return unique([
    ...gitLines(['diff', '--name-only', '--diff-filter=ACMRTUXB', `${baseRef}...HEAD`]),
    ...gitLines(['diff', '--name-only', '--diff-filter=ACMRTUXB']),
    ...gitLines(['diff', '--cached', '--name-only', '--diff-filter=ACMRTUXB']),
    ...gitLines(['ls-files', '--others', '--exclude-standard']),
  ]).filter((file) => existsSync(file));
}

const baseRef = 'origin/main';
if (!existsSync('.git')) {
  console.error('current pr local failed');
  console.error('- run from repo root');
  process.exit(1);
}

if (process.argv.includes('--self-test')) {
  const probeFile = '__current_pr_local_untracked_probe__.md';
  try {
    writeFileSync(probeFile, '# current-pr-local untracked probe\n');
    const changedFiles = collectChangedFiles(baseRef);
    if (!changedFiles.includes(probeFile)) {
      console.error('current pr local self-test failed');
      console.error('- untracked files were not included in changed-file detection');
      process.exit(1);
    }
  } finally {
    rmSync(probeFile, { force: true });
  }

  console.log('current pr local self-test ok');
  process.exit(0);
}

run(['git', 'fetch', 'origin', 'main', '--quiet'], 'fetch main', true);

const changedFiles = collectChangedFiles(baseRef);

if (changedFiles.length === 0) {
  console.log('current pr local ok (no changed files)');
  process.exit(0);
}

const commands: Array<{ command: Array<string>; label: string }> = [
  { command: ['bun', 'run', 'check:agent-preflight'], label: 'agent preflight' },
  { command: ['bun', 'run', 'check:agent-pr-queue'], label: 'agent pr queue' },
];

const formatFiles = changedFiles.filter((file) => FORMAT_EXTENSIONS.has(extname(file)));
if (formatFiles.length > 0) {
  commands.push({ command: ['bun', 'prettier', '--check', ...formatFiles], label: 'format changed' });
}

const lintFiles = changedFiles.filter((file) => LINT_EXTENSIONS.has(extname(file)));
if (lintFiles.length > 0) {
  commands.push({ command: ['bun', 'eslint', ...lintFiles, '--max-warnings', '0'], label: 'lint changed' });
  commands.push({ command: ['bun', 'run', 'check:types'], label: 'types' });
}

if (changedFiles.some((file) => file.startsWith('packages/rawengine-schema/') || file.includes('/schemas/'))) {
  commands.push({ command: ['bun', 'run', 'schema:check'], label: 'schema' });
}

if (changedFiles.some((file) => file.endsWith('.tsx') || file.startsWith('src/i18n/locales/'))) {
  commands.push({ command: ['bun', 'run', 'check:i18n'], label: 'i18n' });
}

if (
  changedFiles.some(
    (file) =>
      file === 'package.json' ||
      file.startsWith('.github/') ||
      file.startsWith('scripts/') ||
      file.startsWith('tests/integration/checks/'),
  )
) {
  commands.push({ command: ['bun', 'run', 'check:compact-commands'], label: 'compact commands' });
}

if (
  changedFiles.some(
    (file) =>
      file === 'vite.config.js' ||
      file.startsWith('src/') ||
      file.startsWith('public/') ||
      file.startsWith('index.html'),
  )
) {
  commands.push({ command: ['bun', 'run', 'check:bundle'], label: 'bundle' });
}

const changedCheckFiles = changedFiles.filter(
  (file) =>
    file.startsWith('tests/integration/checks/check-') &&
    file.endsWith('.ts') &&
    !file.endsWith('check-current-pr-local.ts'),
);
if (changedCheckFiles.length > 20) {
  commands.push({ command: ['bun', 'run', 'check:validation-test-paths'], label: 'validation test paths' });
} else {
  for (const file of changedCheckFiles) {
    commands.push({ command: ['bun', file], label: file });
  }
}

const seenCommands = new Set<string>();
let failed = false;
for (const item of commands) {
  const key = item.command.join('\0');
  if (seenCommands.has(key)) continue;
  seenCommands.add(key);
  const result = run(item.command, item.label);
  if (result.code !== 0) failed = true;
}

if (failed) process.exit(1);
console.log(`current pr local ok (${changedFiles.length} files)`);
