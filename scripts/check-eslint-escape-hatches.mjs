#!/usr/bin/env bun

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join, relative } from 'node:path';

const ROOT = process.cwd();
const SELF_PATH = 'scripts/check-eslint-escape-hatches.mjs';
const CHECKED_EXTENSIONS = new Set(['.cjs', '.js', '.jsx', '.mjs', '.ts', '.tsx']);
const IGNORED_DIRS = new Set(['.git', 'dist', 'node_modules', 'src-tauri/target', 'target']);
const ALLOWED_DIRECTIVE_PATTERN =
  /eslint-disable-next-line\s+[@a-z0-9-/, ]+\s+--\s+[A-Z0-9][A-Za-z0-9 .,:;'"()/_-]{11,}/u;

const isIgnored = (path) => {
  const normalized = path.split('/').join('/');
  return [...IGNORED_DIRS].some((ignored) => normalized === ignored || normalized.startsWith(`${ignored}/`));
};

const files = [];
const walk = (dir) => {
  for (const entry of readdirSync(dir)) {
    const absolutePath = join(dir, entry);
    const repoPath = relative(ROOT, absolutePath);
    if (isIgnored(repoPath)) continue;
    if (repoPath === SELF_PATH) continue;

    const stat = statSync(absolutePath);
    if (stat.isDirectory()) {
      walk(absolutePath);
      continue;
    }

    if (stat.isFile() && CHECKED_EXTENSIONS.has(extname(entry))) {
      files.push(absolutePath);
    }
  }
};

walk(ROOT);

const violations = [];

for (const file of files) {
  const contents = readFileSync(file, 'utf8');
  const lines = contents.split(/\r?\n/u);

  lines.forEach((line, index) => {
    if (!line.includes('eslint-disable')) return;

    if (!line.includes('eslint-disable-next-line')) {
      violations.push(`${relative(ROOT, file)}:${index + 1}: use eslint-disable-next-line, not broader disable scopes`);
      return;
    }

    if (!ALLOWED_DIRECTIVE_PATTERN.test(line)) {
      violations.push(
        `${relative(ROOT, file)}:${index + 1}: eslint-disable-next-line requires rule names and a descriptive "-- reason"`,
      );
    }
  });
}

if (violations.length > 0) {
  console.error('ESLint escape hatch policy failed.');
  console.error(violations.join('\n'));
  process.exit(1);
}

console.log('ESLint escape hatches are scoped and documented.');
