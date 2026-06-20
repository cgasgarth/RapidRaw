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
  '.ts',
  '.tsx',
  '.yaml',
  '.yml',
]);
const ESLINT_EXTENSIONS = new Set(['.cjs', '.js', '.jsx', '.ts', '.ts', '.tsx']);

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
const checks = [];

if (formatFiles.length > 0) {
  checks.push(await run('format', 'bun', ['prettier', '--list-different', '--log-level', 'warn', ...formatFiles]));
}

if (eslintFiles.length > 0) {
  checks.push(await run('lint', 'bun', ['eslint', '--max-warnings', '0', '--no-warn-ignored', ...eslintFiles]));
}

const checkSummary = checks.length > 0 ? `, ${checks.length} checks` : '';
console.log(`staged ok (${stagedFiles.length}${checkSummary})`);
