#!/usr/bin/env bun

import { spawnSync } from 'node:child_process';

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

const run = (command, args) => {
  console.log(`$ ${[command, ...args].join(' ')}`);
  const result = spawnSync(command, args, { stdio: 'inherit' });
  if (result.status === 0) return;

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
  console.log('No staged files to check.');
  process.exit(0);
}

const formatFiles = stagedFiles.filter((filePath) => FORMAT_EXTENSIONS.has(extensionOf(filePath)));
const eslintFiles = stagedFiles.filter((filePath) => ESLINT_EXTENSIONS.has(extensionOf(filePath)));

if (formatFiles.length > 0) {
  run('bunx', ['prettier@3.8.3', '--check', ...formatFiles]);
}

if (eslintFiles.length > 0) {
  run('bunx', ['eslint', '--max-warnings', '0', '--no-warn-ignored', ...eslintFiles]);
}

console.log(`Checked ${stagedFiles.length} staged file(s).`);
