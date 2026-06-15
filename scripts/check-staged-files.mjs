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

const run = (label, command, args) => {
  const result = spawnSync(command, args, { encoding: 'utf8' });
  if (result.status === 0) {
    console.log(`${label} ok`);
    return;
  }

  console.error(`${label} failed: ${command} ${args.join(' ')}`);
  if (result.stdout) process.stderr.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);

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

if (formatFiles.length > 0) {
  run('format', 'bun', ['prettier', '--check', '--log-level', 'warn', ...formatFiles]);
}

if (eslintFiles.length > 0) {
  run('lint', 'bun', ['eslint', '--max-warnings', '0', '--no-warn-ignored', ...eslintFiles]);
}

console.log(`staged ok (${stagedFiles.length})`);
