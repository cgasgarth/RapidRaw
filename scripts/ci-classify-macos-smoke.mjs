#!/usr/bin/env bun

import { readFileSync } from 'node:fs';
import { EOL } from 'node:os';

const SMOKE_MODES = {
  NONE: 'none',
  DEBUG: 'debug',
  RELEASE: 'release',
};

const SMOKE_DECISIONS = {
  FAIL_CLOSED: 'unclassified-fail-closed',
  MAIN: 'main-smoke-needed',
  MANUAL: 'manual-smoke-recommended',
  NONE: 'no-smoke-needed',
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

const SAFE_TOOLING_FILES = new Set(['eslint.config.js', 'i18next.config.ts', 'knip.jsonc']);

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
const SAFE_PURE_TEST_EXTENSIONS = new Set(['.js', '.mjs', '.ts']);

const SAFE_PACKAGE_JSON_SCRIPT_VALUES = new Map([
  [
    'check:actions',
    new Set([
      'bun run check:actions:lint && bun run check:workflow-policy',
      'bun run check:actions:lint && bun run check:workflow-policy && bun run check:workflow-policy:self-test',
      'bun run check:actions:lint && bun run check:workflow-policy && bun run check:workflow-policy:self-test && bun run check:compact-commands && bun run check:rust-feature-policy && bun run schema:contract-gate:self-test',
      'bun run check:actions:lint && bun run check:workflow-policy && bun run check:workflow-policy:self-test && bun run check:compact-commands && bun run check:compact-commands:self-test && bun run check:rust-feature-policy && bun run schema:contract-gate:self-test',
      'bun run check:actions:lint && bun run check:workflow-policy && bun run check:workflow-policy:self-test && bun run check:compact-commands && bun run check:compact-commands:self-test && bun run check:rust-feature-policy && bun run check:rust-feature-policy:self-test && bun run schema:contract-gate:self-test',
    ]),
  ],
  [
    'check:quick',
    new Set([
      'bun run check:types && bun run check:i18n && bun run check:unsafe-casts && bun run check:film-fixtures',
      'bun run check:types && bun run check:i18n && bun run check:unsafe-casts && bun run check:film-fixtures && bun run check:release-notes',
      'bun run check:types && bun run check:i18n && bun run check:unsafe-casts && bun run check:film-fixtures && bun run check:release-notes && bun run check:ai-fallbacks',
    ]),
  ],
  ['check:ai-fallbacks', new Set(['bun scripts/check-ai-provider-fallbacks.mjs'])],
  [
    'check:command-palette-workflows',
    new Set(['bun scripts/capture-visual-smoke.mjs --scenario command-palette-workflows']),
  ],
  ['check:film-look-browser-smoke', new Set(['bun scripts/capture-visual-smoke.mjs --scenario film-look-browser'])],
  ['check:focus-ui-api', new Set(['bun scripts/check-focus-ui-api.mjs'])],
  ['check:focus-ui-smoke', new Set(['bun scripts/capture-visual-smoke.mjs --scenario focus-ui'])],
  ['check:hdr-ui-smoke', new Set(['bun scripts/capture-visual-smoke.mjs --scenario hdr-ui'])],
  ['check:panorama-ui-api', new Set(['bun scripts/check-panorama-ui-api.mjs'])],
  ['check:panorama-ui-smoke', new Set(['bun scripts/capture-visual-smoke.mjs --scenario panorama-ui'])],
  ['check:sr-ui-api', new Set(['bun scripts/check-sr-ui-api.mjs'])],
  ['check:sr-ui-smoke', new Set(['bun scripts/capture-visual-smoke.mjs --scenario sr-ui'])],
  ['check:negative-lab-fixtures', new Set(['bun scripts/check-negative-lab-fixtures.mjs'])],
  ['check:negative-lab-fixtures:update', new Set(['bun scripts/check-negative-lab-fixtures.mjs --update'])],
  ['check:negative-lab-frame-health', new Set(['bun scripts/check-negative-lab-frame-health-report.mjs'])],
  ['check:negative-lab-ui-presets', new Set(['bun scripts/check-negative-lab-ui-presets.mjs'])],
  ['check:private-raw-evidence', new Set(['bun scripts/check-private-raw-evidence-ledger.mjs'])],
  ['check:raw-open-edit-export-proof', new Set(['bun scripts/check-raw-open-edit-export-proof.mjs'])],
  [
    'check:negative-lab-workspace-smoke',
    new Set(['bun scripts/capture-visual-smoke.mjs --scenario negative-lab-workspace']),
  ],
  ['check:performance-smoke', new Set(['bun scripts/check-performance-smoke.mjs'])],
  [
    'check:pure-ts-tests',
    new Set(['bun scripts/run-compact-command.mjs --label pure-ts-tests -- bun test --reporter=dot tests/pure-ts']),
  ],
  ['check:release-notes', new Set(['bun scripts/generate-release-notes.mjs --self-test'])],
  ['check:workflow-policy:self-test', new Set(['bun scripts/check-github-workflow-policy.mjs --self-test'])],
  ['check:validation-gates', new Set(['bun run check:compact-commands && bun run check:compact-commands:self-test'])],
  ['check:compact-commands', new Set(['bun scripts/check-compact-quality-commands.mjs'])],
  ['check:compact-commands:self-test', new Set(['bun scripts/check-compact-quality-commands.mjs --self-test'])],
  ['check:rust-feature-policy', new Set(['bun scripts/check-rust-feature-policy.mjs'])],
  ['check:rust-feature-policy:self-test', new Set(['bun scripts/check-rust-feature-policy.mjs --self-test'])],
  ['deps:audit:check', new Set(['bun scripts/audit-dependency-versions.mjs --fail-on-missing-major-issues'])],
  ['release:notes', new Set(['bun scripts/generate-release-notes.mjs'])],
  [
    'schema:check',
    new Set([
      'tsc -p packages/rawengine-schema/tsconfig.json --noEmit --pretty false && bun packages/rawengine-schema/scripts/check-samples.ts',
      'tsc -p packages/rawengine-schema/tsconfig.json --noEmit --pretty false && bun packages/rawengine-schema/scripts/check-samples.ts && bun run schema:samples',
    ]),
  ],
  ['schema:samples', new Set(['bun packages/rawengine-schema/scripts/check-sample-artifacts.mjs'])],
  ['schema:samples:update', new Set(['bun packages/rawengine-schema/scripts/check-sample-artifacts.mjs --update'])],
  ['schema:contract-gate', new Set(['bun scripts/ci-schema-contract-gate.mjs'])],
  ['schema:contract-gate:self-test', new Set(['bun scripts/ci-schema-contract-gate.mjs --self-test'])],
  [
    'schema:sr-app-server',
    new Set(['bun packages/rawengine-schema/scripts/check-super-resolution-app-server-command-bus.ts']),
  ],
  [
    'schema:panorama-app-server',
    new Set(['bun packages/rawengine-schema/scripts/check-panorama-app-server-command-bus.ts']),
  ],
  ['check:sr-synthetic-smoke', new Set(['bun scripts/check-super-resolution-synthetic-smoke.mjs'])],
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

function isSafePureTestPath(path) {
  return path.startsWith('tests/pure-ts/') && hasExtension(path, SAFE_PURE_TEST_EXTENSIONS);
}

function isSafeFixturePath(path) {
  return (
    (path.startsWith('fixtures/color/') && path.endsWith('.json')) ||
    (path.startsWith('fixtures/detail/') && path.endsWith('.json')) ||
    path.startsWith('fixtures/docs/') ||
    (path.startsWith('fixtures/film-simulation/') && path.endsWith('.json')) ||
    (path.startsWith('fixtures/layers/') && path.endsWith('.json')) ||
    (path.startsWith('fixtures/negative-lab/') && path.endsWith('.json')) ||
    path.startsWith('fixtures/sidecar-roundtrip/') ||
    (path.startsWith('fixtures/validation/') && path.endsWith('.json'))
  );
}

function isSafeValidationScript(path) {
  return path.startsWith('scripts/') && (path.endsWith('.mjs') || path.endsWith('.ts'));
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

  if (path === 'package-lock.json' && change.status === 'removed') {
    return {
      decision: SMOKE_DECISIONS.NONE,
      mode: SMOKE_MODES.NONE,
      reason: 'removed stale npm lockfile after Bun migration',
    };
  }

  if (path === 'package.json' && isSafePackageJsonScriptPatch(change.patch)) {
    return {
      decision: SMOKE_DECISIONS.NONE,
      mode: SMOKE_MODES.NONE,
      reason: 'schema-only package script change is covered by schema validation',
    };
  }

  if (ALWAYS_REQUIRE_FILES.has(path)) {
    return { decision: SMOKE_DECISIONS.MAIN, mode: SMOKE_MODES.RELEASE, reason: 'build configuration changed' };
  }

  if (RELEASE_PREFIXES.some((prefix) => path.startsWith(prefix))) {
    return { decision: SMOKE_DECISIONS.MAIN, mode: SMOKE_MODES.RELEASE, reason: 'Rust or Tauri path changed' };
  }

  if (path.startsWith('.github/')) {
    return {
      decision: SMOKE_DECISIONS.MAIN,
      mode: SMOKE_MODES.RELEASE,
      reason: 'GitHub automation changed; main smoke should observe the merged workflow',
    };
  }

  if (path.startsWith('src/') && path.endsWith('.rs')) {
    return { decision: SMOKE_DECISIONS.MAIN, mode: SMOKE_MODES.RELEASE, reason: 'Rust source changed' };
  }

  if (
    SAFE_ROOT_FILES.has(path) ||
    SAFE_TOOLING_FILES.has(path) ||
    isMarkdown(path) ||
    path.startsWith('docs/') ||
    isSafeFixturePath(path) ||
    isSafePureTestPath(path) ||
    isSafeSchemaPackagePath(path) ||
    isSafeValidationScript(path) ||
    isSafeFrontendLeaf(path)
  ) {
    return {
      decision: SMOKE_DECISIONS.NONE,
      mode: SMOKE_MODES.NONE,
      reason: 'covered by faster frontend/docs validation gates',
    };
  }

  return { decision: SMOKE_DECISIONS.FAIL_CLOSED, mode: SMOKE_MODES.RELEASE, reason: 'unclassified path changed' };
}

function maxMode(left, right) {
  return MODE_PRIORITY.get(right) > MODE_PRIORITY.get(left) ? right : left;
}

export function classifyFileChanges(changes) {
  const normalizedChanges = changes
    .map((change) => ({
      filename: (change.filename ?? change.path ?? '').trim(),
      patch: change.patch,
      status: change.status,
    }))
    .filter((change) => change.filename);

  if (normalizedChanges.length === 0) {
    return {
      macosSmokeRequired: true,
      macosSmokeMode: SMOKE_MODES.RELEASE,
      macosSmokeArgs: SMOKE_ARGS[SMOKE_MODES.RELEASE],
      smokeDecision: SMOKE_DECISIONS.FAIL_CLOSED,
      reason: 'no changed files were reported; failing closed',
      requiredPaths: [],
      safePaths: [],
    };
  }

  const requiredPaths = [];
  const safePaths = [];
  let macosSmokeMode = SMOKE_MODES.NONE;
  let smokeDecision = SMOKE_DECISIONS.NONE;

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

    if (classification.decision === SMOKE_DECISIONS.FAIL_CLOSED) {
      smokeDecision = SMOKE_DECISIONS.FAIL_CLOSED;
    } else if (smokeDecision !== SMOKE_DECISIONS.FAIL_CLOSED && classification.decision === SMOKE_DECISIONS.MAIN) {
      smokeDecision = SMOKE_DECISIONS.MAIN;
    } else if (smokeDecision === SMOKE_DECISIONS.NONE && classification.decision === SMOKE_DECISIONS.MANUAL) {
      smokeDecision = SMOKE_DECISIONS.MANUAL;
    }
  }

  return {
    macosSmokeRequired: macosSmokeMode !== SMOKE_MODES.NONE,
    macosSmokeMode,
    macosSmokeArgs: SMOKE_ARGS[macosSmokeMode],
    smokeDecision,
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
  console.log(`macos_smoke_decision=${result.smokeDecision}`);
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
    filename: typeof entry.filename === 'string' ? entry.filename : typeof entry.path === 'string' ? entry.path : '',
    patch: typeof entry.patch === 'string' ? entry.patch : undefined,
    status: typeof entry.status === 'string' ? entry.status : undefined,
  }));
}

function readPullFilesNdjsonFromArg(path) {
  return readFileSync(path, 'utf8')
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const entry = JSON.parse(line);
      return {
        filename: typeof entry.filename === 'string' ? entry.filename : '',
        patch: typeof entry.patch === 'string' ? entry.patch : undefined,
        status: typeof entry.status === 'string' ? entry.status : undefined,
      };
    });
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

function assertDecision(name, files, expectedDecision) {
  const result = classifyFiles(files);
  if (result.smokeDecision !== expectedDecision) {
    throw new Error(`${name}: expected decision=${expectedDecision}; got ${result.smokeDecision}. ${result.reason}`);
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
  assertClassification(
    'workflow changes require main smoke decision',
    ['.github/workflows/lint.yml'],
    SMOKE_MODES.RELEASE,
  );
  assertDecision('workflow changes are main-smoke-needed', ['.github/workflows/lint.yml'], SMOKE_DECISIONS.MAIN);
  assertClassification(
    'github action changes require main smoke decision',
    ['.github/actions/setup-bun-deps/action.yml'],
    SMOKE_MODES.RELEASE,
  );
  assertDecision('empty file list fails closed decision', [], SMOKE_DECISIONS.FAIL_CLOSED);
  assertClassification('tauri changes require release smoke', ['src-tauri/src/main.rs'], SMOKE_MODES.RELEASE);
  assertClassification('package changes require release smoke', ['package.json'], SMOKE_MODES.RELEASE);
  assertClassification(
    'package-lock file lists fail closed without removal status',
    ['package-lock.json'],
    SMOKE_MODES.RELEASE,
  );
  assertChangeClassification(
    'removed npm lockfile skips smoke',
    [{ filename: 'package-lock.json', status: 'removed' }],
    SMOKE_MODES.NONE,
  );
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
    'release notes package script changes skip smoke',
    [
      {
        filename: 'package.json',
        patch:
          '@@ -17,7 +17,7 @@\n-    "check:quick": "bun run check:types && bun run check:i18n && bun run check:unsafe-casts && bun run check:film-fixtures",\n+    "check:quick": "bun run check:types && bun run check:i18n && bun run check:unsafe-casts && bun run check:film-fixtures && bun run check:release-notes",\n+    "release:notes": "bun scripts/generate-release-notes.mjs",\n+    "check:release-notes": "bun scripts/generate-release-notes.mjs --self-test",',
      },
    ],
    SMOKE_MODES.NONE,
  );
  assertChangeClassification(
    'dependency audit package script changes skip smoke',
    [
      {
        filename: 'package.json',
        patch:
          '@@ -40,6 +40,7 @@\n+    "deps:audit:check": "bun scripts/audit-dependency-versions.mjs --fail-on-missing-major-issues",',
      },
    ],
    SMOKE_MODES.NONE,
  );
  assertChangeClassification(
    'performance smoke package script changes skip smoke',
    [
      {
        filename: 'package.json',
        patch: '@@ -42,6 +42,7 @@\n+    "check:performance-smoke": "bun scripts/check-performance-smoke.mjs",',
      },
    ],
    SMOKE_MODES.NONE,
  );
  assertChangeClassification(
    'film look browser smoke package script changes skip smoke',
    [
      {
        filename: 'package.json',
        patch:
          '@@ -120,6 +120,7 @@\n+    "check:film-look-browser-smoke": "bun scripts/capture-visual-smoke.mjs --scenario film-look-browser",',
      },
    ],
    SMOKE_MODES.NONE,
  );
  assertChangeClassification(
    'command palette workflow package script changes skip smoke',
    [
      {
        filename: 'package.json',
        patch:
          '@@ -120,6 +120,7 @@\n+    "check:command-palette-workflows": "bun scripts/capture-visual-smoke.mjs --scenario command-palette-workflows",',
      },
    ],
    SMOKE_MODES.NONE,
  );
  assertChangeClassification(
    'focus UI smoke package script changes skip smoke',
    [
      {
        filename: 'package.json',
        patch:
          '@@ -120,6 +120,7 @@\n+    "check:focus-ui-smoke": "bun scripts/capture-visual-smoke.mjs --scenario focus-ui",',
      },
    ],
    SMOKE_MODES.NONE,
  );
  assertChangeClassification(
    'HDR UI smoke package script changes skip smoke',
    [
      {
        filename: 'package.json',
        patch:
          '@@ -120,6 +120,7 @@\n+    "check:hdr-ui-smoke": "bun scripts/capture-visual-smoke.mjs --scenario hdr-ui",',
      },
    ],
    SMOKE_MODES.NONE,
  );
  assertChangeClassification(
    'panorama UI smoke package script changes skip smoke',
    [
      {
        filename: 'package.json',
        patch:
          '@@ -120,6 +120,7 @@\n+    "check:panorama-ui-smoke": "bun scripts/capture-visual-smoke.mjs --scenario panorama-ui",',
      },
    ],
    SMOKE_MODES.NONE,
  );
  assertChangeClassification(
    'super-resolution UI smoke package script changes skip smoke',
    [
      {
        filename: 'package.json',
        patch:
          '@@ -120,6 +120,7 @@\n+    "check:sr-ui-smoke": "bun scripts/capture-visual-smoke.mjs --scenario sr-ui",',
      },
    ],
    SMOKE_MODES.NONE,
  );
  assertChangeClassification(
    'negative lab UI preset package script changes skip smoke',
    [
      {
        filename: 'package.json',
        patch:
          '@@ -125,6 +125,7 @@\n+    "check:negative-lab-ui-presets": "bun scripts/check-negative-lab-ui-presets.mjs",',
      },
    ],
    SMOKE_MODES.NONE,
  );
  assertChangeClassification(
    'negative lab workspace smoke package script changes skip smoke',
    [
      {
        filename: 'package.json',
        patch:
          '@@ -125,6 +125,7 @@\n+    "check:negative-lab-workspace-smoke": "bun scripts/capture-visual-smoke.mjs --scenario negative-lab-workspace",',
      },
    ],
    SMOKE_MODES.NONE,
  );
  assertChangeClassification(
    'negative lab fixture package script changes skip smoke',
    [
      {
        filename: 'package.json',
        patch:
          '@@ -125,6 +125,8 @@\n+    "check:negative-lab-fixtures": "bun scripts/check-negative-lab-fixtures.mjs",\n+    "check:negative-lab-fixtures:update": "bun scripts/check-negative-lab-fixtures.mjs --update",',
      },
    ],
    SMOKE_MODES.NONE,
  );
  assertChangeClassification(
    'negative lab frame health package script changes skip smoke',
    [
      {
        filename: 'package.json',
        patch:
          '@@ -125,6 +125,7 @@\n+    "check:negative-lab-frame-health": "bun scripts/check-negative-lab-frame-health-report.mjs",',
      },
    ],
    SMOKE_MODES.NONE,
  );
  assertChangeClassification(
    'raw open edit export proof package script changes skip smoke',
    [
      {
        filename: 'package.json',
        patch:
          '@@ -110,6 +110,7 @@\n+    "check:raw-open-edit-export-proof": "bun scripts/check-raw-open-edit-export-proof.mjs",',
      },
    ],
    SMOKE_MODES.NONE,
  );
  assertChangeClassification(
    'pure TS test package script changes skip smoke',
    [
      {
        filename: 'package.json',
        patch:
          '@@ -29,6 +29,7 @@\n+    "check:pure-ts-tests": "bun scripts/run-compact-command.mjs --label pure-ts-tests -- bun test --reporter=dot tests/pure-ts",',
      },
    ],
    SMOKE_MODES.NONE,
  );
  assertChangeClassification(
    'AI fallback package script changes skip smoke',
    [
      {
        filename: 'package.json',
        patch:
          '@@ -17,7 +17,7 @@\n-    "check:quick": "bun run check:types && bun run check:i18n && bun run check:unsafe-casts && bun run check:film-fixtures && bun run check:release-notes",\n+    "check:quick": "bun run check:types && bun run check:i18n && bun run check:unsafe-casts && bun run check:film-fixtures && bun run check:release-notes && bun run check:ai-fallbacks",\n+    "check:ai-fallbacks": "bun scripts/check-ai-provider-fallbacks.mjs",',
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
  assertDecision('unknown paths fail closed', ['tools/new-helper.sh'], SMOKE_DECISIONS.FAIL_CLOSED);
  assertClassification(
    'frontend leaf changes can skip smoke',
    ['src/components/panel/library/LibraryGrid.tsx'],
    SMOKE_MODES.NONE,
  );
  assertClassification('public styles can skip smoke', ['public/theme.css'], SMOKE_MODES.NONE);
  assertClassification('color fixture outputs can skip smoke', ['fixtures/color/channel-mixer.json'], SMOKE_MODES.NONE);
  assertClassification(
    'film fixture outputs can skip smoke',
    ['fixtures/film-simulation/film-look-fixture-outputs.json'],
    SMOKE_MODES.NONE,
  );
  assertClassification(
    'negative lab fixture outputs can skip smoke',
    ['fixtures/negative-lab/negative-lab-synthetic-fixture-proof.json'],
    SMOKE_MODES.NONE,
  );
  assertClassification(
    'private RAW evidence fixture ledger can skip smoke',
    ['fixtures/detail/private-raw-evidence-ledger.json'],
    SMOKE_MODES.NONE,
  );
  assertClassification(
    'validation fixture contracts can skip smoke',
    ['fixtures/validation/raw-open-edit-export-proof.json'],
    SMOKE_MODES.NONE,
  );
  assertClassification(
    'layer fixture outputs can skip smoke',
    ['fixtures/layers/layer-stack-operations.json'],
    SMOKE_MODES.NONE,
  );
  assertClassification(
    'sidecar roundtrip fixture outputs can skip smoke',
    ['fixtures/sidecar-roundtrip/IMG_0001.CR3.rrdata'],
    SMOKE_MODES.NONE,
  );
  assertChangeClassification(
    'GitHub pull files with path fields can skip smoke',
    [{ path: 'fixtures/film-simulation/film-look-fixture-outputs.json' }],
    SMOKE_MODES.NONE,
  );
  assertClassification('pure TS tests can skip smoke', ['tests/pure-ts/edit-command-bus.test.mjs'], SMOKE_MODES.NONE);
  assertClassification('lint config changes can skip smoke', ['eslint.config.js'], SMOKE_MODES.NONE);
  assertClassification('unused-code config changes can skip smoke', ['knip.jsonc'], SMOKE_MODES.NONE);
  assertClassification(
    'validation scripts can skip smoke',
    ['scripts/check-eslint-escape-hatches.mjs'],
    SMOKE_MODES.NONE,
  );
  assertClassification(
    'typed validation script helpers can skip smoke',
    ['scripts/lib/computational-ui-api-smoke.ts'],
    SMOKE_MODES.NONE,
  );
  assertClassification('docs can skip smoke', ['RAW_EDITOR_PLAN.md', 'docs/validation.md'], SMOKE_MODES.NONE);
  assertClassification(
    'mixed safe and workflow paths require main smoke decision',
    ['README.md', '.github/workflows/lint.yml'],
    SMOKE_MODES.RELEASE,
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
  const pullFilesNdjsonIndex = args.indexOf('--pull-files-ndjson');
  const pullFilesNdjsonPath = pullFilesNdjsonIndex >= 0 ? args[pullFilesNdjsonIndex + 1] : undefined;
  const fileArgIndex = args.indexOf('--files');
  const filesPath = fileArgIndex >= 0 ? args[fileArgIndex + 1] : undefined;

  if (!filesPath && !pullFilesJsonPath && !pullFilesNdjsonPath) {
    throw new Error(
      'Usage: bun scripts/ci-classify-macos-smoke.mjs --files <changed-files.txt> | --pull-files-json <pull-files.json> | --pull-files-ndjson <pull-files.ndjson>',
    );
  }

  const result = pullFilesNdjsonPath
    ? classifyFileChanges(readPullFilesNdjsonFromArg(pullFilesNdjsonPath))
    : pullFilesJsonPath
      ? classifyFileChanges(readPullFilesFromArg(pullFilesJsonPath))
      : classifyFiles(readFilesFromArg(filesPath));
  emitGitHubOutput(result);
}
