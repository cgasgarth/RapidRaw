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

const RELEASE_PREFIXES = ['.cargo/', 'src-tauri/'];

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
  'vite.config.ts',
  'vite.config.ts',
  'vitest.config.js',
  'vitest.config.ts',
  'vitest.config.ts',
]);

const SAFE_ROOT_FILES = new Set(['.gitignore', 'AGENTS.md', 'LICENSE', 'README.md', 'RAW_EDITOR_PLAN.md']);

const SAFE_TOOLING_FILES = new Set(['.githooks/pre-commit', 'eslint.config.js', 'i18next.config.ts', 'knip.jsonc']);

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

const SAFE_SCHEMA_PACKAGE_EXTENSIONS = new Set(['.json', '.md', '.ts', '.ts']);
const SAFE_PURE_TEST_EXTENSIONS = new Set(['.js', '.ts', '.ts']);
const SAFE_VALIDATION_SCRIPT_FILES = new Set(['scripts/tsconfig.json']);

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
  ['check:ai-fallbacks', new Set(['bun tests/integration/checks/check-ai-provider-fallbacks.ts'])],
  ['check:ai-people-fake-provider', new Set(['bun tests/integration/checks/check-ai-people-fake-provider.ts'])],
  ['check:ai-people-apply-plan', new Set(['bun tests/integration/checks/check-ai-people-layer-apply-plan.ts'])],
  ['check:ai-people-picker', new Set(['bun tests/integration/checks/check-ai-people-picker-model.ts'])],
  ['check:script-type-coverage', new Set(['bun tests/integration/checks/check-script-type-coverage.ts'])],
  [
    'check:script-type-coverage:self-test',
    new Set(['bun tests/integration/checks/check-script-type-coverage.ts --self-test']),
  ],
  ['check:script-extension-policy', new Set(['bun tests/integration/checks/check-script-extension-policy.ts'])],
  [
    'check:script-extension-policy:self-test',
    new Set(['bun tests/integration/checks/check-script-extension-policy.ts --self-test']),
  ],
  [
    'check:command-palette-workflows',
    new Set(['bun scripts/capture-visual-smoke.ts --scenario command-palette-workflows']),
  ],
  ['check:colorchecker-fixtures', new Set(['bun tests/integration/checks/check-colorchecker-fixtures.ts'])],
  [
    'check:camera-profile-input-transform',
    new Set(['bun tests/integration/checks/check-camera-profile-input-transform-proof.ts']),
  ],
  ['check:brush-mask-command', new Set(['bun tests/integration/checks/check-brush-mask-command.ts'])],
  ['check:capture-sharpening', new Set(['bun tests/integration/checks/check-capture-sharpening-fixtures.ts'])],
  ['check:compare-survey', new Set(['bun tests/integration/checks/check-compare-survey-fixtures.ts'])],
  ['check:defringe', new Set(['bun tests/integration/checks/check-defringe-fixtures.ts'])],
  ['check:detail-artifacts', new Set(['bun tests/integration/checks/check-detail-artifacts.ts'])],
  ['check:detail-workspace-smoke', new Set(['bun scripts/capture-visual-smoke.ts --scenario detail-workspace'])],
  ['check:dust-spot-visualization', new Set(['bun tests/integration/checks/check-dust-spot-visualization.ts'])],
  ['check:dust-spot-visualization-smoke', new Set(['bun scripts/capture-visual-smoke.ts --scenario detail-dust-spot'])],
  ['check:export-batch-proof', new Set(['bun tests/integration/checks/check-export-batch-proof.ts'])],
  ['check:export-batch-proof:update', new Set(['bun tests/integration/checks/check-export-batch-proof.ts --update'])],
  ['check:export-recipes-ui', new Set(['bun tests/integration/checks/check-export-recipes-ui.ts'])],
  ['check:film-look-browser-smoke', new Set(['bun scripts/capture-visual-smoke.ts --scenario film-look-browser'])],
  [
    'check:focus-alignment-sharpness-proof',
    new Set(['bun tests/integration/checks/check-focus-alignment-sharpness-proof.ts']),
  ],
  [
    'check:focus-alignment-sharpness-proof:update',
    new Set(['bun tests/integration/checks/check-focus-alignment-sharpness-proof.ts --update']),
  ],
  ['check:focus-blend-halo-proof', new Set(['bun tests/integration/checks/check-focus-blend-halo-proof.ts'])],
  [
    'check:focus-blend-halo-proof:update',
    new Set(['bun tests/integration/checks/check-focus-blend-halo-proof.ts --update']),
  ],
  ['check:focus-ui-api', new Set(['bun tests/integration/checks/check-focus-ui-api.ts'])],
  ['check:focus-ui-smoke', new Set(['bun scripts/capture-visual-smoke.ts --scenario focus-ui'])],
  ['check:hdr-alignment-bracket-proof', new Set(['bun tests/integration/checks/check-hdr-alignment-bracket-proof.ts'])],
  [
    'check:hdr-alignment-bracket-proof:update',
    new Set(['bun tests/integration/checks/check-hdr-alignment-bracket-proof.ts --update']),
  ],
  ['check:hdr-deghost-tone-artifact', new Set(['bun tests/integration/checks/check-hdr-deghost-tone-artifact.ts'])],
  [
    'check:hdr-deghost-tone-artifact:update',
    new Set(['bun tests/integration/checks/check-hdr-deghost-tone-artifact.ts --update']),
  ],
  ['check:hdr-ui-smoke', new Set(['bun scripts/capture-visual-smoke.ts --scenario hdr-ui'])],
  ['check:hue-memory-color', new Set(['bun tests/integration/checks/check-hue-memory-color-gate.ts'])],
  ['check:import-presets', new Set(['bun tests/integration/checks/check-import-preset-fixtures.ts'])],
  ['check:keyboard-shortcut-conflicts', new Set(['bun tests/integration/checks/check-keyboard-shortcut-conflicts.ts'])],
  ['check:keyboard-shortcuts', new Set(['bun tests/integration/checks/check-keyboard-shortcuts.ts'])],
  ['check:layer-blend-runtime', new Set(['bun tests/integration/checks/check-layer-blend-runtime.ts'])],
  ['check:layer-runtime-parent-status', new Set(['bun tests/integration/checks/check-layer-runtime-parent-status.ts'])],
  [
    'check:linear-gradient-mask-command',
    new Set(['bun tests/integration/checks/check-linear-gradient-mask-command.ts']),
  ],
  ['check:session-import-reload-proof', new Set(['bun tests/integration/checks/check-session-import-reload-proof.ts'])],
  ['check:library-session-ui', new Set(['bun tests/integration/checks/check-library-session-ui.ts'])],
  ['check:library-workflow-smoke', new Set(['bun scripts/capture-visual-smoke.ts --scenario library-workflow'])],
  ['check:panorama-ui-api', new Set(['bun tests/integration/checks/check-panorama-ui-api.ts'])],
  ['check:panorama-feature-transform', new Set(['bun tests/integration/checks/check-panorama-feature-transform.ts'])],
  ['check:panorama-blend-exposure', new Set(['bun tests/integration/checks/check-panorama-blend-exposure.ts'])],
  [
    'check:panorama-seam-exposure-proof',
    new Set(['bun tests/integration/checks/check-panorama-seam-exposure-proof.ts']),
  ],
  [
    'check:panorama-seam-exposure-proof:update',
    new Set(['bun tests/integration/checks/check-panorama-seam-exposure-proof.ts --update']),
  ],
  ['check:panorama-projection-crop', new Set(['bun tests/integration/checks/check-panorama-projection-crop.ts'])],
  [
    'check:panorama-projection-memory-proof',
    new Set(['bun tests/integration/checks/check-panorama-projection-memory-proof.ts']),
  ],
  [
    'check:panorama-projection-memory-proof:update',
    new Set(['bun tests/integration/checks/check-panorama-projection-memory-proof.ts --update']),
  ],
  ['check:panorama-ui-smoke', new Set(['bun scripts/capture-visual-smoke.ts --scenario panorama-ui'])],
  [
    'check:sr-alignment-detail-proof',
    new Set(['bun tests/integration/checks/check-super-resolution-alignment-detail-proof.ts']),
  ],
  [
    'check:sr-alignment-detail-proof:update',
    new Set(['bun tests/integration/checks/check-super-resolution-alignment-detail-proof.ts --update']),
  ],
  [
    'check:sr-artifact-performance-proof',
    new Set(['bun tests/integration/checks/check-super-resolution-artifact-performance-proof.ts']),
  ],
  [
    'check:sr-artifact-performance-proof:update',
    new Set(['bun tests/integration/checks/check-super-resolution-artifact-performance-proof.ts --update']),
  ],
  ['check:sr-ui-api', new Set(['bun tests/integration/checks/check-sr-ui-api.ts'])],
  ['check:sr-ui-smoke', new Set(['bun scripts/capture-visual-smoke.ts --scenario sr-ui'])],
  ['check:negative-lab-fixtures', new Set(['bun tests/integration/checks/check-negative-lab-fixtures.ts'])],
  [
    'check:negative-lab-fixtures:update',
    new Set(['bun tests/integration/checks/check-negative-lab-fixtures.ts --update']),
  ],
  [
    'check:negative-lab-frame-health',
    new Set(['bun tests/integration/checks/check-negative-lab-frame-health-report.ts']),
  ],
  [
    'check:negative-lab-stock-metadata-coverage',
    new Set(['bun tests/integration/checks/check-negative-lab-stock-metadata-coverage.ts']),
  ],
  [
    'check:negative-lab-stock-metadata-coverage:update',
    new Set(['bun tests/integration/checks/check-negative-lab-stock-metadata-coverage.ts --update']),
  ],
  ['check:negative-lab-ui-presets', new Set(['bun tests/integration/checks/check-negative-lab-ui-presets.ts'])],
  ['check:noise-separation', new Set(['bun tests/integration/checks/check-noise-separation-fixtures.ts'])],
  ['check:output-sharpening', new Set(['bun tests/integration/checks/check-output-sharpening-fixtures.ts'])],
  ['check:mask-refine-command-ui', new Set(['bun tests/integration/checks/check-mask-refinement-command-ui.ts'])],
  ['check:mask-refine-controls', new Set(['bun tests/integration/checks/check-mask-refinement-controls.ts'])],
  ['check:mask-compose-command', new Set(['bun tests/integration/checks/check-mask-compose-command.ts'])],
  ['check:metadata-templates', new Set(['bun tests/integration/checks/check-metadata-template-fixtures.ts'])],
  ['check:public-fixture-manifest', new Set(['bun tests/integration/checks/check-public-fixture-manifest.ts'])],
  ['check:raw-open-edit-export-proof', new Set(['bun tests/integration/checks/check-raw-open-edit-export-proof.ts'])],
  [
    'check:raw-open-edit-export-command-wrapper',
    new Set(['bun tests/integration/checks/check-raw-open-edit-export-command-wrapper.ts']),
  ],
  [
    'check:raw-open-edit-export-private-report-collector',
    new Set(['bun scripts/collect-raw-open-edit-export-private-run-reports.ts --self-test']),
  ],
  [
    'check:raw-open-edit-export-private-proof-acceptance',
    new Set(['bun scripts/accept-raw-open-edit-export-private-proof.ts --self-test']),
  ],
  ['check:reference-images', new Set(['bun tests/integration/checks/check-reference-image-fixtures.ts'])],
  [
    'check:negative-lab-workspace-smoke',
    new Set(['bun scripts/capture-visual-smoke.ts --scenario negative-lab-workspace']),
  ],
  ['check:performance-smoke', new Set(['bun tests/integration/checks/check-performance-smoke.ts'])],
  [
    'check:pure-ts-tests',
    new Set(['bun scripts/run-compact-command.ts --label pure-ts-tests -- bun test --reporter=dot tests/pure-ts']),
  ],
  ['check:pure-ts-coverage', new Set(['bun tests/integration/checks/check-pure-ts-coverage.ts'])],
  ['check:release-notes', new Set(['bun scripts/generate-release-notes.ts --self-test'])],
  [
    'check:workflow-policy:self-test',
    new Set(['bun tests/integration/checks/check-github-workflow-policy.ts --self-test']),
  ],
  ['check:compact-commands', new Set(['bun tests/integration/checks/check-compact-quality-commands.ts'])],
  [
    'check:compact-commands:self-test',
    new Set(['bun tests/integration/checks/check-compact-quality-commands.ts --self-test']),
  ],
  ['check:rust-feature-policy', new Set(['bun tests/integration/checks/check-rust-feature-policy.ts'])],
  [
    'check:rust-feature-policy:self-test',
    new Set(['bun tests/integration/checks/check-rust-feature-policy.ts --self-test']),
  ],
  ['deps:audit:check', new Set(['bun scripts/audit-dependency-versions.ts --fail-on-missing-major-issues'])],
  ['release:notes', new Set(['bun scripts/generate-release-notes.ts'])],
  [
    'schema:check',
    new Set([
      'tsc -p packages/rawengine-schema/tsconfig.json --noEmit --pretty false && bun packages/rawengine-schema/scripts/check-samples.ts',
      'tsc -p packages/rawengine-schema/tsconfig.json --noEmit --pretty false && bun packages/rawengine-schema/scripts/check-samples.ts && bun run schema:samples',
    ]),
  ],
  ['schema:samples', new Set(['bun packages/rawengine-schema/scripts/check-sample-artifacts.ts'])],
  ['schema:samples:update', new Set(['bun packages/rawengine-schema/scripts/check-sample-artifacts.ts --update'])],
  ['schema:contract-gate', new Set(['bun tests/integration/checks/check-schema-contract-gate.ts'])],
  [
    'schema:contract-gate:self-test',
    new Set(['bun tests/integration/checks/check-schema-contract-gate.ts --self-test']),
  ],
  [
    'schema:sr-app-server',
    new Set(['bun packages/rawengine-schema/scripts/check-super-resolution-app-server-command-bus.ts']),
  ],
  [
    'schema:panorama-app-server',
    new Set(['bun packages/rawengine-schema/scripts/check-panorama-app-server-command-bus.ts']),
  ],
  ['check:sr-synthetic-smoke', new Set(['bun tests/integration/checks/check-super-resolution-synthetic-smoke.ts'])],
  ['check:tauri-schema-validation', new Set(['bun tests/integration/checks/check-tauri-schema-validation.ts'])],
  ['check:wavelet-detail', new Set(['bun tests/integration/checks/check-wavelet-detail-fixtures.ts'])],
  ['check:workspace-layouts', new Set(['bun tests/integration/checks/check-workspace-layout-fixtures.ts'])],
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
    (path.startsWith('fixtures/export/') && path.endsWith('.json')) ||
    (path.startsWith('fixtures/film-simulation/') && path.endsWith('.json')) ||
    (path.startsWith('fixtures/layers/') && path.endsWith('.json')) ||
    (path.startsWith('fixtures/masks/') && path.endsWith('.json')) ||
    (path.startsWith('fixtures/negative-lab/') && path.endsWith('.json')) ||
    (path.startsWith('fixtures/negative-lab/public/') && hasExtension(path, new Set(['.jpg', '.jpeg', '.png']))) ||
    (path.startsWith('fixtures/panorama/') && path.endsWith('.json')) ||
    path.startsWith('fixtures/sidecar-roundtrip/') ||
    (path.startsWith('fixtures/ui/') && path.endsWith('.json')) ||
    (path.startsWith('fixtures/validation/') && path.endsWith('.json')) ||
    (path.startsWith('fixtures/workflow/') && path.endsWith('.json'))
  );
}

function isSafeValidationScript(path) {
  return (
    ((path.startsWith('scripts/') || path.startsWith('tests/integration/checks/')) && path.endsWith('.ts')) ||
    SAFE_VALIDATION_SCRIPT_FILES.has(path)
  );
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
  assertClassification('cargo config changes require release smoke', ['.cargo/config.toml'], SMOKE_MODES.RELEASE);
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
          '@@ -25,9 +25,10 @@\n-    "check:actions": "bun run check:actions:lint && bun run check:workflow-policy",\n+    "check:actions": "bun run check:actions:lint && bun run check:workflow-policy && bun run check:workflow-policy:self-test",\n+    "check:workflow-policy:self-test": "bun tests/integration/checks/check-github-workflow-policy.ts --self-test",',
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
          '@@ -17,7 +17,7 @@\n-    "check:quick": "bun run check:types && bun run check:i18n && bun run check:unsafe-casts && bun run check:film-fixtures",\n+    "check:quick": "bun run check:types && bun run check:i18n && bun run check:unsafe-casts && bun run check:film-fixtures && bun run check:release-notes",\n+    "release:notes": "bun scripts/generate-release-notes.ts",\n+    "check:release-notes": "bun scripts/generate-release-notes.ts --self-test",',
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
          '@@ -40,6 +40,7 @@\n+    "deps:audit:check": "bun scripts/audit-dependency-versions.ts --fail-on-missing-major-issues",',
      },
    ],
    SMOKE_MODES.NONE,
  );
  assertChangeClassification(
    'performance smoke package script changes skip smoke',
    [
      {
        filename: 'package.json',
        patch:
          '@@ -42,6 +42,7 @@\n+    "check:performance-smoke": "bun tests/integration/checks/check-performance-smoke.ts",',
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
          '@@ -120,6 +120,7 @@\n+    "check:film-look-browser-smoke": "bun scripts/capture-visual-smoke.ts --scenario film-look-browser",',
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
          '@@ -120,6 +120,7 @@\n+    "check:command-palette-workflows": "bun scripts/capture-visual-smoke.ts --scenario command-palette-workflows",',
      },
    ],
    SMOKE_MODES.NONE,
  );
  assertChangeClassification(
    'brush mask command package script changes skip smoke',
    [
      {
        filename: 'package.json',
        patch:
          '@@ -80,6 +80,7 @@\n+    "check:brush-mask-command": "bun tests/integration/checks/check-brush-mask-command.ts",',
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
          '@@ -120,6 +120,7 @@\n+    "check:focus-ui-smoke": "bun scripts/capture-visual-smoke.ts --scenario focus-ui",',
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
          '@@ -120,6 +120,7 @@\n+    "check:hdr-ui-smoke": "bun scripts/capture-visual-smoke.ts --scenario hdr-ui",',
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
          '@@ -120,6 +120,7 @@\n+    "check:panorama-ui-smoke": "bun scripts/capture-visual-smoke.ts --scenario panorama-ui",',
      },
    ],
    SMOKE_MODES.NONE,
  );
  assertChangeClassification(
    'super-resolution UI smoke package script changes skip smoke',
    [
      {
        filename: 'package.json',
        patch: '@@ -120,6 +120,7 @@\n+    "check:sr-ui-smoke": "bun scripts/capture-visual-smoke.ts --scenario sr-ui",',
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
          '@@ -125,6 +125,7 @@\n+    "check:negative-lab-ui-presets": "bun tests/integration/checks/check-negative-lab-ui-presets.ts",',
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
          '@@ -125,6 +125,7 @@\n+    "check:negative-lab-workspace-smoke": "bun scripts/capture-visual-smoke.ts --scenario negative-lab-workspace",',
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
          '@@ -125,6 +125,8 @@\n+    "check:negative-lab-fixtures": "bun tests/integration/checks/check-negative-lab-fixtures.ts",\n+    "check:negative-lab-fixtures:update": "bun tests/integration/checks/check-negative-lab-fixtures.ts --update",',
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
          '@@ -125,6 +125,7 @@\n+    "check:negative-lab-frame-health": "bun tests/integration/checks/check-negative-lab-frame-health-report.ts",',
      },
    ],
    SMOKE_MODES.NONE,
  );
  assertChangeClassification(
    'negative lab stock metadata coverage package script changes skip smoke',
    [
      {
        filename: 'package.json',
        patch:
          '@@ -125,6 +125,8 @@\n+    "check:negative-lab-stock-metadata-coverage": "bun tests/integration/checks/check-negative-lab-stock-metadata-coverage.ts",\n+    "check:negative-lab-stock-metadata-coverage:update": "bun tests/integration/checks/check-negative-lab-stock-metadata-coverage.ts --update",',
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
          '@@ -110,6 +110,7 @@\n+    "check:raw-open-edit-export-proof": "bun tests/integration/checks/check-raw-open-edit-export-proof.ts",',
      },
    ],
    SMOKE_MODES.NONE,
  );
  assertChangeClassification(
    'raw open edit export command wrapper package script changes skip smoke',
    [
      {
        filename: 'package.json',
        patch:
          '@@ -110,6 +110,7 @@\n+    "check:raw-open-edit-export-command-wrapper": "bun tests/integration/checks/check-raw-open-edit-export-command-wrapper.ts",',
      },
    ],
    SMOKE_MODES.NONE,
  );
  assertChangeClassification(
    'raw open edit export private report collector package script changes skip smoke',
    [
      {
        filename: 'package.json',
        patch:
          '@@ -110,6 +110,7 @@\n+    "check:raw-open-edit-export-private-report-collector": "bun scripts/collect-raw-open-edit-export-private-run-reports.ts --self-test",',
      },
    ],
    SMOKE_MODES.NONE,
  );
  assertChangeClassification(
    'raw open edit export private proof acceptance package script changes skip smoke',
    [
      {
        filename: 'package.json',
        patch:
          '@@ -110,6 +110,7 @@\n+    "check:raw-open-edit-export-private-proof-acceptance": "bun scripts/accept-raw-open-edit-export-private-proof.ts --self-test",',
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
          '@@ -29,6 +29,7 @@\n+    "check:pure-ts-tests": "bun scripts/run-compact-command.ts --label pure-ts-tests -- bun test --reporter=dot tests/pure-ts",',
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
          '@@ -17,7 +17,7 @@\n-    "check:quick": "bun run check:types && bun run check:i18n && bun run check:unsafe-casts && bun run check:film-fixtures && bun run check:release-notes",\n+    "check:quick": "bun run check:types && bun run check:i18n && bun run check:unsafe-casts && bun run check:film-fixtures && bun run check:release-notes && bun run check:ai-fallbacks",\n+    "check:ai-fallbacks": "bun tests/integration/checks/check-ai-provider-fallbacks.ts",',
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
    'panorama fixture outputs can skip smoke',
    ['fixtures/panorama/panorama-feature-transform-fixtures.json'],
    SMOKE_MODES.NONE,
  );
  assertClassification(
    'negative lab public image fixtures can skip smoke',
    ['fixtures/negative-lab/public/110-format-ericht-negative-cc0-320.jpg'],
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
    'validation proof request fixtures can skip smoke',
    ['fixtures/validation/raw-open-edit-export-proof-request.json'],
    SMOKE_MODES.NONE,
  );
  assertClassification(
    'workflow session reload fixtures can skip smoke',
    ['fixtures/workflow/session-import-reload-proof.json'],
    SMOKE_MODES.NONE,
  );
  assertClassification('export fixtures can skip smoke', ['fixtures/export/export-recipes.json'], SMOKE_MODES.NONE);
  assertClassification(
    'layer fixture outputs can skip smoke',
    ['fixtures/layers/layer-stack-operations.json'],
    SMOKE_MODES.NONE,
  );
  assertClassification(
    'mask fixture outputs can skip smoke',
    ['fixtures/masks/linear-gradient-mask-command.json'],
    SMOKE_MODES.NONE,
  );
  assertClassification(
    'sidecar roundtrip fixture outputs can skip smoke',
    ['fixtures/sidecar-roundtrip/IMG_0001.CR3.rrdata'],
    SMOKE_MODES.NONE,
  );
  assertClassification(
    'UI fixture outputs can skip smoke',
    ['fixtures/ui/compare-survey-session.json'],
    SMOKE_MODES.NONE,
  );
  assertChangeClassification(
    'GitHub pull files with path fields can skip smoke',
    [{ path: 'fixtures/film-simulation/film-look-fixture-outputs.json' }],
    SMOKE_MODES.NONE,
  );
  assertClassification('pure TS tests can skip smoke', ['tests/pure-ts/edit-command-bus.test.ts'], SMOKE_MODES.NONE);
  assertClassification('lint config changes can skip smoke', ['eslint.config.js'], SMOKE_MODES.NONE);
  assertClassification('unused-code config changes can skip smoke', ['knip.jsonc'], SMOKE_MODES.NONE);
  assertClassification(
    'validation scripts can skip smoke',
    ['tests/integration/checks/check-eslint-escape-hatches.ts'],
    SMOKE_MODES.NONE,
  );
  assertChangeClassification(
    'linear gradient mask package script changes skip smoke',
    [
      {
        filename: 'package.json',
        patch:
          '@@ -80,6 +80,7 @@\n+    "check:linear-gradient-mask-command": "bun tests/integration/checks/check-linear-gradient-mask-command.ts",',
      },
    ],
    SMOKE_MODES.NONE,
  );
  assertChangeClassification(
    'mask compose command package script changes skip smoke',
    [
      {
        filename: 'package.json',
        patch:
          '@@ -80,6 +80,7 @@\n+    "check:mask-compose-command": "bun tests/integration/checks/check-mask-compose-command.ts",',
      },
    ],
    SMOKE_MODES.NONE,
  );
  assertChangeClassification(
    'layer blend runtime package script changes skip smoke',
    [
      {
        filename: 'package.json',
        patch:
          '@@ -80,6 +80,7 @@\n+    "check:layer-blend-runtime": "bun tests/integration/checks/check-layer-blend-runtime.ts",',
      },
    ],
    SMOKE_MODES.NONE,
  );
  assertClassification(
    'typed validation script helpers can skip smoke',
    ['scripts/lib/computational-ui-api-smoke.ts'],
    SMOKE_MODES.NONE,
  );
  assertClassification('script policy metadata can skip smoke', ['scripts/tsconfig.json'], SMOKE_MODES.NONE);
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
  console.log('check-ci-classify-macos-smoke self-test passed');
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
      'Usage: bun tests/integration/checks/check-ci-classify-macos-smoke.ts --files <changed-files.txt> | --pull-files-json <pull-files.json> | --pull-files-ndjson <pull-files.ndjson>',
    );
  }

  const result = pullFilesNdjsonPath
    ? classifyFileChanges(readPullFilesNdjsonFromArg(pullFilesNdjsonPath))
    : pullFilesJsonPath
      ? classifyFileChanges(readPullFilesFromArg(pullFilesJsonPath))
      : classifyFiles(readFilesFromArg(filesPath));
  emitGitHubOutput(result);
}
