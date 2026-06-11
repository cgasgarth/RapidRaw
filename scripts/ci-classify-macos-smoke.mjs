#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import { EOL } from 'node:os';

const ALWAYS_REQUIRE_PREFIXES = ['.github/actions/', '.github/workflows/', 'src-tauri/'];

const ALWAYS_REQUIRE_FILES = new Set([
  'bun.lock',
  'Cargo.lock',
  'Cargo.toml',
  'index.html',
  'package.json',
  'package-lock.json',
  'pnpm-lock.yaml',
  'tsconfig.json',
  'tsconfig.app.json',
  'tsconfig.node.json',
  'vite.config.js',
  'vite.config.mjs',
  'vite.config.ts',
  'vitest.config.js',
  'vitest.config.mjs',
  'vitest.config.ts',
]);

const SAFE_ROOT_FILES = new Set(['.gitignore', 'AGENTS.md', 'LICENSE', 'README.md', 'RAW_EDITOR_PLAN.md']);

const SAFE_TOOLING_FILES = new Set(['eslint.config.js', 'i18next.config.ts']);

const SAFE_FRONTEND_EXTENSIONS = new Set([
  '.css',
  '.d.ts',
  '.json',
  '.less',
  '.module.css',
  '.module.scss',
  '.sass',
  '.scss',
  '.ts',
  '.tsx',
]);

function hasExtension(path, extensions) {
  return [...extensions].some((extension) => path.endsWith(extension));
}

function isMarkdown(path) {
  return path.endsWith('.md') || path.endsWith('.mdx');
}

function isSafeFrontendLeaf(path) {
  return (path.startsWith('src/') || path.startsWith('public/')) && hasExtension(path, SAFE_FRONTEND_EXTENSIONS);
}

function isSafeValidationScript(path) {
  return path.startsWith('scripts/') && path.endsWith('.mjs');
}

function classifyPath(path) {
  if (ALWAYS_REQUIRE_FILES.has(path)) {
    return { required: true, reason: 'build configuration changed' };
  }

  if (ALWAYS_REQUIRE_PREFIXES.some((prefix) => path.startsWith(prefix))) {
    return { required: true, reason: 'workflow, action, Rust, or Tauri path changed' };
  }

  if (path.startsWith('.github/')) {
    return { required: true, reason: 'GitHub repository automation changed' };
  }

  if (path.startsWith('src/') && path.endsWith('.rs')) {
    return { required: true, reason: 'Rust source changed' };
  }

  if (
    SAFE_ROOT_FILES.has(path) ||
    SAFE_TOOLING_FILES.has(path) ||
    isMarkdown(path) ||
    path.startsWith('docs/') ||
    path.startsWith('fixtures/docs/') ||
    isSafeFrontendLeaf(path) ||
    isSafeValidationScript(path)
  ) {
    return { required: false, reason: 'safe for frontend/docs validation gates' };
  }

  return { required: true, reason: 'unclassified path changed' };
}

export function classifyFiles(files) {
  const normalizedFiles = files.map((file) => file.trim()).filter(Boolean);

  if (normalizedFiles.length === 0) {
    return {
      macosSmokeRequired: true,
      reason: 'no changed files were reported; failing closed',
      requiredPaths: [],
      safePaths: [],
    };
  }

  const requiredPaths = [];
  const safePaths = [];

  for (const path of normalizedFiles) {
    const classification = classifyPath(path);
    const entry = `${path} (${classification.reason})`;

    if (classification.required) {
      requiredPaths.push(entry);
    } else {
      safePaths.push(entry);
    }
  }

  if (requiredPaths.length > 0) {
    return {
      macosSmokeRequired: true,
      reason: `macOS smoke required for ${requiredPaths.length} changed path(s)`,
      requiredPaths,
      safePaths,
    };
  }

  return {
    macosSmokeRequired: false,
    reason: `macOS smoke skipped; ${safePaths.length} changed path(s) are covered by faster gates`,
    requiredPaths,
    safePaths,
  };
}

function writeMultilineOutput(name, value) {
  const delimiter = `EOF_${name}`;
  console.log(`${name}<<${delimiter}`);
  console.log(value);
  console.log(delimiter);
}

function emitGitHubOutput(result) {
  console.log(`macos_smoke_required=${result.macosSmokeRequired ? 'true' : 'false'}`);
  writeMultilineOutput('macos_smoke_reason', result.reason);
  writeMultilineOutput('macos_smoke_required_paths', result.requiredPaths.join(EOL));
  writeMultilineOutput('macos_smoke_safe_paths', result.safePaths.join(EOL));
}

function readFilesFromArg(path) {
  return readFileSync(path, 'utf8')
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean);
}

function assertClassification(name, files, expectedRequired) {
  const result = classifyFiles(files);

  if (result.macosSmokeRequired !== expectedRequired) {
    throw new Error(
      `${name}: expected macOS smoke required=${expectedRequired}, got ${result.macosSmokeRequired}. ${result.reason}`,
    );
  }
}

function runSelfTest() {
  assertClassification('empty file list fails closed', [], true);
  assertClassification('workflow changes require smoke', ['.github/workflows/lint.yml'], true);
  assertClassification('github action changes require smoke', ['.github/actions/setup-bun-deps/action.yml'], true);
  assertClassification('tauri changes require smoke', ['src-tauri/src/main.rs'], true);
  assertClassification('package changes require smoke', ['package.json'], true);
  assertClassification('unknown paths require smoke', ['tools/new-helper.sh'], true);
  assertClassification('frontend leaf changes can skip smoke', ['src/components/panel/library/LibraryGrid.tsx'], false);
  assertClassification('public styles can skip smoke', ['public/theme.css'], false);
  assertClassification('lint config changes can skip smoke', ['eslint.config.js'], false);
  assertClassification('validation scripts can skip smoke', ['scripts/check-eslint-escape-hatches.mjs'], false);
  assertClassification('docs can skip smoke', ['RAW_EDITOR_PLAN.md', 'docs/validation.md'], false);
  assertClassification('mixed safe and required paths require smoke', ['README.md', 'src-tauri/Cargo.toml'], true);
  console.log('ci-classify-macos-smoke self-test passed');
}

const args = process.argv.slice(2);

if (args.includes('--self-test')) {
  runSelfTest();
} else {
  const fileArgIndex = args.indexOf('--files');
  const filesPath = fileArgIndex >= 0 ? args[fileArgIndex + 1] : undefined;

  if (!filesPath) {
    throw new Error('Usage: node scripts/ci-classify-macos-smoke.mjs --files <changed-files.txt>');
  }

  const result = classifyFiles(readFilesFromArg(filesPath));
  emitGitHubOutput(result);
}
