#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import { EOL } from 'node:os';

const SMOKE_MODES = {
  NONE: 'none',
  DEBUG: 'debug',
  RELEASE: 'release',
};

const SMOKE_ARGS = {
  [SMOKE_MODES.NONE]: '',
  [SMOKE_MODES.DEBUG]: '--verbose --ci --no-bundle --debug --target aarch64-apple-darwin',
  [SMOKE_MODES.RELEASE]: '--verbose --ci --no-bundle --target aarch64-apple-darwin',
};

const MODE_PRIORITY = new Map([
  [SMOKE_MODES.NONE, 0],
  [SMOKE_MODES.DEBUG, 1],
  [SMOKE_MODES.RELEASE, 2],
]);

const DEBUG_PREFIXES = ['.github/actions/', '.github/workflows/'];
const RELEASE_PREFIXES = ['src-tauri/'];

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
    return { mode: SMOKE_MODES.RELEASE, reason: 'build configuration changed' };
  }

  if (RELEASE_PREFIXES.some((prefix) => path.startsWith(prefix))) {
    return { mode: SMOKE_MODES.RELEASE, reason: 'Rust or Tauri path changed' };
  }

  if (DEBUG_PREFIXES.some((prefix) => path.startsWith(prefix))) {
    return { mode: SMOKE_MODES.DEBUG, reason: 'workflow or action path changed' };
  }

  if (path.startsWith('.github/')) {
    return { mode: SMOKE_MODES.DEBUG, reason: 'GitHub repository automation changed' };
  }

  if (path.startsWith('src/') && path.endsWith('.rs')) {
    return { mode: SMOKE_MODES.RELEASE, reason: 'Rust source changed' };
  }

  if (SAFE_TOOLING_FILES.has(path) || isSafeValidationScript(path)) {
    return { mode: SMOKE_MODES.DEBUG, reason: 'tooling validation path changed' };
  }

  if (
    SAFE_ROOT_FILES.has(path) ||
    isMarkdown(path) ||
    path.startsWith('docs/') ||
    path.startsWith('fixtures/docs/') ||
    isSafeFrontendLeaf(path)
  ) {
    return { mode: SMOKE_MODES.NONE, reason: 'covered by faster frontend/docs validation gates' };
  }

  return { mode: SMOKE_MODES.RELEASE, reason: 'unclassified path changed' };
}

function maxMode(left, right) {
  return MODE_PRIORITY.get(right) > MODE_PRIORITY.get(left) ? right : left;
}

export function classifyFiles(files) {
  const normalizedFiles = files.map((file) => file.trim()).filter(Boolean);

  if (normalizedFiles.length === 0) {
    return {
      macosSmokeRequired: true,
      macosSmokeMode: SMOKE_MODES.RELEASE,
      macosSmokeArgs: SMOKE_ARGS[SMOKE_MODES.RELEASE],
      reason: 'no changed files were reported; failing closed',
      requiredPaths: [],
      safePaths: [],
    };
  }

  const requiredPaths = [];
  const safePaths = [];
  let macosSmokeMode = SMOKE_MODES.NONE;

  for (const path of normalizedFiles) {
    const classification = classifyPath(path);
    const entry = `${path} (${classification.reason})`;
    macosSmokeMode = maxMode(macosSmokeMode, classification.mode);

    if (classification.mode === SMOKE_MODES.NONE) {
      safePaths.push(entry);
    } else {
      requiredPaths.push(entry);
    }
  }

  return {
    macosSmokeRequired: macosSmokeMode !== SMOKE_MODES.NONE,
    macosSmokeMode,
    macosSmokeArgs: SMOKE_ARGS[macosSmokeMode],
    reason:
      macosSmokeMode === SMOKE_MODES.NONE
        ? `macOS smoke skipped; ${safePaths.length} changed path(s) are covered by faster gates`
        : `macOS ${macosSmokeMode} smoke required for ${requiredPaths.length} changed path(s)`,
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
  console.log(`macos_smoke_mode=${result.macosSmokeMode}`);
  console.log(`macos_smoke_args=${result.macosSmokeArgs}`);
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

function assertClassification(name, files, expectedMode) {
  const result = classifyFiles(files);
  const expectedRequired = expectedMode !== SMOKE_MODES.NONE;

  if (result.macosSmokeRequired !== expectedRequired || result.macosSmokeMode !== expectedMode) {
    throw new Error(
      `${name}: expected macOS smoke mode=${expectedMode}, required=${expectedRequired}; got mode=${result.macosSmokeMode}, required=${result.macosSmokeRequired}. ${result.reason}`,
    );
  }
}

function runSelfTest() {
  assertClassification('empty file list fails closed', [], SMOKE_MODES.RELEASE);
  assertClassification('workflow changes require debug smoke', ['.github/workflows/lint.yml'], SMOKE_MODES.DEBUG);
  assertClassification(
    'github action changes require debug smoke',
    ['.github/actions/setup-bun-deps/action.yml'],
    SMOKE_MODES.DEBUG,
  );
  assertClassification('tauri changes require release smoke', ['src-tauri/src/main.rs'], SMOKE_MODES.RELEASE);
  assertClassification('package changes require release smoke', ['package.json'], SMOKE_MODES.RELEASE);
  assertClassification('unknown paths require release smoke', ['tools/new-helper.sh'], SMOKE_MODES.RELEASE);
  assertClassification(
    'frontend leaf changes can skip smoke',
    ['src/components/panel/library/LibraryGrid.tsx'],
    SMOKE_MODES.NONE,
  );
  assertClassification('public styles can skip smoke', ['public/theme.css'], SMOKE_MODES.NONE);
  assertClassification('lint config changes require debug smoke', ['eslint.config.js'], SMOKE_MODES.DEBUG);
  assertClassification(
    'validation scripts require debug smoke',
    ['scripts/check-eslint-escape-hatches.mjs'],
    SMOKE_MODES.DEBUG,
  );
  assertClassification('docs can skip smoke', ['RAW_EDITOR_PLAN.md', 'docs/validation.md'], SMOKE_MODES.NONE);
  assertClassification(
    'mixed safe and debug paths require debug smoke',
    ['README.md', '.github/workflows/lint.yml'],
    SMOKE_MODES.DEBUG,
  );
  assertClassification(
    'mixed safe and release paths require release smoke',
    ['README.md', 'src-tauri/Cargo.toml'],
    SMOKE_MODES.RELEASE,
  );
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
