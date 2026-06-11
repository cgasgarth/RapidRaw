#!/usr/bin/env bun

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = process.cwd();
const CHECKED_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']);
const IGNORED_DIRS = new Set(['.git', 'dist', 'node_modules', 'src-tauri/target', 'target']);
const BANNED_PATTERNS = [
  { label: 'double assertion through unknown', pattern: new RegExp(String.raw`\bas\s+${'unknown'}\s+as\b`, 'g') },
  { label: 'assertion to any', pattern: new RegExp(String.raw`\bas\s+${'any'}\b`, 'g') },
];

const isIgnored = (path) => {
  const normalized = path.split('/').join('/');
  return [...IGNORED_DIRS].some((ignored) => normalized === ignored || normalized.startsWith(`${ignored}/`));
};

const hasCheckedExtension = (path) => {
  const index = path.lastIndexOf('.');
  return index >= 0 && CHECKED_EXTENSIONS.has(path.slice(index));
};

const files = [];
const walk = (dir) => {
  for (const entry of readdirSync(dir)) {
    const absolutePath = join(dir, entry);
    const repoPath = relative(ROOT, absolutePath);
    if (isIgnored(repoPath)) continue;

    const stat = statSync(absolutePath);
    if (stat.isDirectory()) {
      walk(absolutePath);
      continue;
    }

    if (stat.isFile() && hasCheckedExtension(repoPath)) {
      files.push(absolutePath);
    }
  }
};

walk(ROOT);

const violations = [];
for (const file of files) {
  const contents = readFileSync(file, 'utf8');
  const lines = contents.split(/\r?\n/);
  lines.forEach((line, index) => {
    for (const banned of BANNED_PATTERNS) {
      banned.pattern.lastIndex = 0;
      if (banned.pattern.test(line)) {
        violations.push(`${relative(ROOT, file)}:${index + 1}: banned unsafe cast "${banned.label}"`);
      }
    }
  });
}

if (violations.length > 0) {
  console.error('Unsafe casts are banned. Replace them with typed helpers, schema parsing, or narrowed types.');
  console.error(violations.join('\n'));
  process.exit(1);
}

console.log('No banned unsafe casts found.');
