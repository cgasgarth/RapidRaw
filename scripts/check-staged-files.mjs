#!/usr/bin/env bun

import { spawnSync } from 'node:child_process';

import { writeBoundedOutput } from './compact-output.mjs';

const FORMAT_EXTENSIONS = new Set([
  '.cjs',
  '.css',
  '.html',
  '.js',
  '.json',
  '.jsx',
  '.md',
  '.mjs',
  '.ts',
  '.tsx',
  '.yaml',
  '.yml',
]);
const ESLINT_EXTENSIONS = new Set(['.cjs', '.js', '.jsx', '.mjs', '.ts', '.tsx']);

const run = (label, command, args) => {
  const result = spawnSync(command, args, { encoding: 'utf8' });
  if (result.status === 0) {
    return label;
  }

  console.error(`${label} failed: ${command} ${args.join(' ')}`);
  writeBoundedOutput('stdout', result.stdout);
  writeBoundedOutput('stderr', result.stderr);

  process.exit(result.status ?? 1);
};

const git = (args) => {
  const result = spawnSync('git', args, { encoding: 'utf8' });
  if (result.status !== 0) {
    process.stderr.write(result.stderr);
    process.exit(result.status ?? 1);
  }

  return result.stdout;
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
  checks.push(run('format', 'bun', ['prettier', '--check', '--log-level', 'warn', ...formatFiles]));
}

if (eslintFiles.length > 0) {
  checks.push(run('lint', 'bun', ['eslint', '--max-warnings', '0', '--no-warn-ignored', ...eslintFiles]));
}

const checkSummary = checks.length > 0 ? `, ${checks.length} checks` : '';
console.log(`staged ok (${stagedFiles.length}${checkSummary})`);
