#!/usr/bin/env bun

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

const SAFE_SCHEMA_PACKAGE_EXTENSIONS = new Set(['.json', '.md', '.mjs', '.ts']);

const SAFE_PACKAGE_JSON_SCRIPT_VALUES = new Map([
  [
    'check:actions',
    new Set([
      'bun run check:actions:lint && bun run check:workflow-policy',
      'bun run check:actions:lint && bun run check:workflow-policy && bun run check:workflow-policy:self-test',
    ]),
  ],
  ['check:workflow-policy:self-test', new Set(['bun scripts/check-github-workflow-policy.mjs --self-test'])],
  [
    'schema:check',
    new Set([
      'tsc -p packages/rawengine-schema/tsconfig.json --noEmit --pretty false && bun packages/rawengine-schema/scripts/check-samples.ts',
      'tsc -p packages/rawengine-schema/tsconfig.json --noEmit --pretty false && bun packages/rawengine-schema/scripts/check-samples.ts && bun run schema:samples',
    ]),
  ],
  ['schema:samples', new Set(['bun packages/rawengine-schema/scripts/check-sample-artifacts.mjs'])],
  ['schema:samples:update', new Set(['bun packages/rawengine-schema/scripts/check-sample-artifacts.mjs --update'])],
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

function isSafeSchemaPackagePath(path) {
  return path.startsWith('packages/rawengine-schema/') && hasExtension(path, SAFE_SCHEMA_PACKAGE_EXTENSIONS);
}

function isSafeValidationScript(path) {
  return path.startsWith('scripts/') && path.endsWith('.mjs');
}

function isSafePackageJsonScriptPatch(patch) {
  if (!patch) return false;

  const changedLines = patch
    .split(/\r?\n/u)
    .filter((line) => /^[+-]/u.test(line) && !line.startsWith('+++') && !line.startsWith('---'));

  if (changedLines.length === 0) return false;

  return changedLines.every((line) => {
    const content = line.slice(1).trim();
    const match = /^"(?<scriptName>[^"]+)":\s*"(?<scriptValue>[^"]+)"\s*,?$/u.exec(content);
    if (!match?.groups) return false;

    return SAFE_PACKAGE_JSON_SCRIPT_VALUES.get(match.groups.scriptName)?.has(match.groups.scriptValue) ?? false;
  });
}

function classifyPathChange(change) {
  const path = change.filename;

  if (path === 'package.json' && isSafePackageJsonScriptPatch(change.patch)) {
    return { mode: SMOKE_MODES.NONE, reason: 'schema-only package script change is covered by schema validation' };
  }

  if (ALWAYS_REQUIRE_FILES.has(path)) {
    return { mode: SMOKE_MODES.RELEASE, reason: 'build configuration changed' };
  }

  if (RELEASE_PREFIXES.some((prefix) => path.startsWith(prefix))) {
    return { mode: SMOKE_MODES.RELEASE, reason: 'Rust or Tauri path changed' };
  }

  if (path.startsWith('.github/')) {
    return { mode: SMOKE_MODES.NONE, reason: 'GitHub automation is covered by actionlint and pin audits' };
  }

  if (path.startsWith('src/') && path.endsWith('.rs')) {
    return { mode: SMOKE_MODES.RELEASE, reason: 'Rust source changed' };
  }

  if (
    SAFE_ROOT_FILES.has(path) ||
    SAFE_TOOLING_FILES.has(path) ||
    isMarkdown(path) ||
    path.startsWith('docs/') ||
    path.startsWith('fixtures/docs/') ||
    isSafeSchemaPackagePath(path) ||
    isSafeValidationScript(path) ||
    isSafeFrontendLeaf(path)
  ) {
    return { mode: SMOKE_MODES.NONE, reason: 'covered by faster frontend/docs validation gates' };
  }

  return { mode: SMOKE_MODES.RELEASE, reason: 'unclassified path changed' };
}

function maxMode(left, right) {
  return MODE_PRIORITY.get(right) > MODE_PRIORITY.get(left) ? right : left;
}

export function classifyFileChanges(changes) {
  const normalizedChanges = changes
    .map((change) => ({
      filename: change.filename.trim(),
      patch: change.patch,
    }))
    .filter((change) => change.filename);

  if (normalizedChanges.length === 0) {
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

  for (const change of normalizedChanges) {
    const path = change.filename;
    const classification = classifyPathChange(change);
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

export function classifyFiles(files) {
  return classifyFileChanges(files.map((filename) => ({ filename })));
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

function readPullFilesFromArg(path) {
  const pullFiles = JSON.parse(readFileSync(path, 'utf8'));
  const entries = Array.isArray(pullFiles) && Array.isArray(pullFiles[0]) ? pullFiles.flat() : pullFiles;

  if (!Array.isArray(entries)) {
    throw new Error(`Expected ${path} to contain a GitHub pull files array`);
  }

  return entries.map((entry) => ({
    filename: typeof entry.filename === 'string' ? entry.filename : '',
    patch: typeof entry.patch === 'string' ? entry.patch : undefined,
  }));
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

function assertChangeClassification(name, changes, expectedMode) {
  const result = classifyFileChanges(changes);
  const expectedRequired = expectedMode !== SMOKE_MODES.NONE;

  if (result.macosSmokeRequired !== expectedRequired || result.macosSmokeMode !== expectedMode) {
    throw new Error(
      `${name}: expected macOS smoke mode=${expectedMode}, required=${expectedRequired}; got mode=${result.macosSmokeMode}, required=${result.macosSmokeRequired}. ${result.reason}`,
    );
  }
}

function runSelfTest() {
  assertClassification('empty file list fails closed', [], SMOKE_MODES.RELEASE);
  assertClassification('workflow changes skip smoke', ['.github/workflows/lint.yml'], SMOKE_MODES.NONE);
  assertClassification(
    'github action changes skip smoke',
    ['.github/actions/setup-bun-deps/action.yml'],
    SMOKE_MODES.NONE,
  );
  assertClassification('tauri changes require release smoke', ['src-tauri/src/main.rs'], SMOKE_MODES.RELEASE);
  assertClassification('package changes require release smoke', ['package.json'], SMOKE_MODES.RELEASE);
  assertChangeClassification(
    'schema package changes skip smoke',
    [
      { filename: 'packages/rawengine-schema/src/rawEngineSchemas.ts' },
      { filename: 'packages/rawengine-schema/samples/panorama-artifact-v1.json' },
    ],
    SMOKE_MODES.NONE,
  );
  assertChangeClassification(
    'schema package script changes skip smoke',
    [
      {
        filename: 'package.json',
        patch:
          '@@ -45,6 +45,7 @@\n+    "schema:check": "tsc -p packages/rawengine-schema/tsconfig.json --noEmit --pretty false && bun packages/rawengine-schema/scripts/check-samples.ts",',
      },
    ],
    SMOKE_MODES.NONE,
  );
  assertChangeClassification(
    'workflow policy package script changes skip smoke',
    [
      {
        filename: 'package.json',
        patch:
          '@@ -25,9 +25,10 @@\n-    "check:actions": "bun run check:actions:lint && bun run check:workflow-policy",\n+    "check:actions": "bun run check:actions:lint && bun run check:workflow-policy && bun run check:workflow-policy:self-test",\n+    "check:workflow-policy:self-test": "bun scripts/check-github-workflow-policy.mjs --self-test",',
      },
    ],
    SMOKE_MODES.NONE,
  );
  assertChangeClassification(
    'non-schema package changes require release smoke',
    [
      {
        filename: 'package.json',
        patch: '@@ -100,6 +100,7 @@\n+    "new-build-tool": "^1.0.0",',
      },
    ],
    SMOKE_MODES.RELEASE,
  );
  assertClassification('unknown paths require release smoke', ['tools/new-helper.sh'], SMOKE_MODES.RELEASE);
  assertClassification(
    'frontend leaf changes can skip smoke',
    ['src/components/panel/library/LibraryGrid.tsx'],
    SMOKE_MODES.NONE,
  );
  assertClassification('public styles can skip smoke', ['public/theme.css'], SMOKE_MODES.NONE);
  assertClassification('lint config changes can skip smoke', ['eslint.config.js'], SMOKE_MODES.NONE);
  assertClassification(
    'validation scripts can skip smoke',
    ['scripts/check-eslint-escape-hatches.mjs'],
    SMOKE_MODES.NONE,
  );
  assertClassification('docs can skip smoke', ['RAW_EDITOR_PLAN.md', 'docs/validation.md'], SMOKE_MODES.NONE);
  assertClassification(
    'mixed safe and workflow paths skip smoke',
    ['README.md', '.github/workflows/lint.yml'],
    SMOKE_MODES.NONE,
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
  const pullFilesJsonIndex = args.indexOf('--pull-files-json');
  const pullFilesJsonPath = pullFilesJsonIndex >= 0 ? args[pullFilesJsonIndex + 1] : undefined;
  const fileArgIndex = args.indexOf('--files');
  const filesPath = fileArgIndex >= 0 ? args[fileArgIndex + 1] : undefined;

  if (!filesPath && !pullFilesJsonPath) {
    throw new Error(
      'Usage: bun scripts/ci-classify-macos-smoke.mjs --files <changed-files.txt> | --pull-files-json <pull-files.json>',
    );
  }

  const result = pullFilesJsonPath
    ? classifyFileChanges(readPullFilesFromArg(pullFilesJsonPath))
    : classifyFiles(readFilesFromArg(filesPath));
  emitGitHubOutput(result);
}
