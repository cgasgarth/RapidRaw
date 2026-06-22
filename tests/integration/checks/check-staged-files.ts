#!/usr/bin/env bun

import { formatCommandForLog, readBoundedStream, writeBoundedOutput } from '../../../scripts/compact-output.ts';

const FORMAT_EXTENSIONS = new Set([
  '.cjs',
  '.css',
  '.html',
  '.js',
  '.json',
  '.jsx',
  '.md',
  '.ts',
  '.tsx',
  '.yaml',
  '.yml',
]);
const ESLINT_EXTENSIONS = new Set(['.cjs', '.js', '.jsx', '.ts', '.tsx']);

const run = async (label, command, args) => {
  const proc = Bun.spawn([command, ...args], {
    stdout: 'pipe',
    stderr: 'pipe',
  });

  const stdout = readBoundedStream(proc.stdout);
  const stderr = readBoundedStream(proc.stderr);
  const exitCode = await proc.exited;

  if (exitCode === 0) {
    return label;
  }

  console.error(`${label} failed: ${formatCommandForLog(command, args)}`);
  writeBoundedOutput('stdout', await stdout);
  writeBoundedOutput('stderr', await stderr);

  process.exit(exitCode || 1);
};

const git = (args) => {
  const result = Bun.spawnSync(['git', ...args], {
    stdout: 'pipe',
    stderr: 'pipe',
  });
  if (result.exitCode !== 0) {
    writeBoundedOutput('stderr', result.stderr.toString());
    process.exit(result.exitCode || 1);
  }

  return result.stdout.toString();
};

const extensionOf = (filePath) => {
  const dotIndex = filePath.lastIndexOf('.');
  return dotIndex >= 0 ? filePath.slice(dotIndex) : '';
};

const stagedFiles = git(['diff', '--cached', '--name-only', '--diff-filter=ACMR'])
  .split(/\r?\n/u)
  .map((filePath) => filePath.trim())
  .filter(Boolean);

if (stagedFiles.length === 0) {
  console.log('staged 0');
  process.exit(0);
}

const formatFiles = stagedFiles.filter((filePath) => FORMAT_EXTENSIONS.has(extensionOf(filePath)));
const eslintFiles = stagedFiles.filter((filePath) => ESLINT_EXTENSIONS.has(extensionOf(filePath)));
const i18nFiles = stagedFiles.filter(
  (filePath) => filePath === 'src/i18n/locales/en.json' || /^src\/.*\.(?:js|jsx|ts|tsx)$/u.test(filePath),
);
const fixFiles = Array.from(new Set([...formatFiles, ...eslintFiles]));
const checks = [];

const unstagedStagedFiles =
  fixFiles.length === 0
    ? []
    : git(['diff', '--name-only', '--diff-filter=ACMR', '--', ...fixFiles])
        .split(/\r?\n/u)
        .map((filePath) => filePath.trim())
        .filter(Boolean);

if (unstagedStagedFiles.length > 0) {
  console.error(`precommit autofix needs fully staged files: ${unstagedStagedFiles.slice(0, 8).join(', ')}`);
  if (unstagedStagedFiles.length > 8) {
    console.error(`...and ${unstagedStagedFiles.length - 8} more`);
  }
  process.exit(1);
}

if (eslintFiles.length > 0) {
  checks.push(
    await run('lint:fix', 'bun', ['eslint', '--fix', '--max-warnings', '0', '--no-warn-ignored', ...eslintFiles]),
  );
}

if (formatFiles.length > 0) {
  checks.push(await run('format:fix', 'bun', ['prettier', '--write', '--log-level', 'warn', ...formatFiles]));
}

if (fixFiles.length > 0) {
  git(['add', '--', ...fixFiles]);
}

if (formatFiles.length > 0) {
  checks.push(await run('format', 'bun', ['prettier', '--check', '--log-level', 'warn', ...formatFiles]));
}

if (eslintFiles.length > 0) {
  checks.push(await run('lint', 'bun', ['eslint', '--max-warnings', '0', '--no-warn-ignored', ...eslintFiles]));
}

if (i18nFiles.length > 0) {
  checks.push(await run('i18n:check', 'bun', ['run', 'i18n:check']));
  checks.push(await run('i18n:lint', 'bun', ['run', 'i18n:lint']));
}

const checkSummary = checks.length > 0 ? `, ${checks.length} checks` : '';
console.log(`staged ok (${stagedFiles.length}${checkSummary})`);
