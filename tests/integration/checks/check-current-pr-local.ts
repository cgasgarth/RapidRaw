#!/usr/bin/env bun

import { existsSync, rmSync, writeFileSync } from 'node:fs';
import { extname } from 'node:path';

const textDecoder = new TextDecoder();
const FORMAT_EXTENSIONS = new Set(['.css', '.html', '.json', '.jsonc', '.md', '.ts', '.tsx', '.yml', '.yaml']);
const LINT_EXTENSIONS = new Set(['.js', '.jsx', '.ts', '.tsx']);
const CHANGED_CHECK_SELF_TEST_ARGS = new Map<string, Array<string>>([
  ['tests/integration/checks/check-ci-classify-macos-smoke.ts', ['--self-test']],
  ['tests/integration/checks/check-ci-classify-rust-pr.ts', ['--self-test']],
  ['tests/integration/checks/check-schema-contract-gate.ts', ['--self-test']],
]);

interface CommandResult {
  code: number;
  stderr: string;
  stdout: string;
}

interface CommandSpec {
  command: Array<string>;
  label: string;
}

function run(command: Array<string>, label: string, quietSuccess = false): CommandResult {
  const result = Bun.spawnSync(command, {
    stderr: 'pipe',
    stdout: 'pipe',
  });
  const stdout = textDecoder.decode(result.stdout).trim();
  const stderr = textDecoder.decode(result.stderr).trim();
  if (result.exitCode === 0) {
    if (!quietSuccess) console.log(`${label} ok`);
  } else {
    console.error(`${label} failed`);
    console.error(`$ ${command.join(' ')}`);
    const output = [stdout, stderr].filter(Boolean).join('\n').split('\n').slice(-20).join('\n');
    if (output) console.error(output);
  }
  return { code: result.exitCode, stderr, stdout };
}

function gitLines(args: Array<string>): Array<string> {
  const result = run(['git', ...args], `git ${args[0] ?? 'cmd'}`, true);
  if (result.code !== 0) process.exit(result.code);
  return result.stdout.length === 0 ? [] : result.stdout.split('\n').filter(Boolean);
}

function unique(values: Array<string>): Array<string> {
  return [...new Set(values)].toSorted();
}

function collectChangedFiles(baseRef: string): Array<string> {
  return unique([
    ...gitLines(['diff', '--name-only', '--diff-filter=ACMRTUXB', `${baseRef}...HEAD`]),
    ...gitLines(['diff', '--name-only', '--diff-filter=ACMRTUXB']),
    ...gitLines(['diff', '--cached', '--name-only', '--diff-filter=ACMRTUXB']),
    ...gitLines(['ls-files', '--others', '--exclude-standard']),
  ]).filter((file) => existsSync(file));
}

function hasAny(changedFiles: ReadonlyArray<string>, predicate: (file: string) => boolean): boolean {
  return changedFiles.some(predicate);
}

function routeCommandsForChangedFiles(changedFiles: ReadonlyArray<string>): Array<CommandSpec> {
  const commands: Array<CommandSpec> = [
    { command: ['bun', 'run', 'check:agent-preflight'], label: 'agent preflight' },
    { command: ['bun', 'run', 'check:agent-pr-queue'], label: 'agent pr queue' },
  ];

  const formatFiles = changedFiles.filter((file) => FORMAT_EXTENSIONS.has(extname(file)));
  if (formatFiles.length > 0) {
    commands.push({ command: ['bun', 'prettier', '--check', ...formatFiles], label: 'format changed' });
  }

  const lintFiles = changedFiles.filter((file) => LINT_EXTENSIONS.has(extname(file)));
  if (lintFiles.length > 0) {
    commands.push({ command: ['bun', 'eslint', ...lintFiles, '--max-warnings', '0'], label: 'lint changed' });
    commands.push({ command: ['bun', 'run', 'check:types'], label: 'types' });
  }

  if (hasAny(changedFiles, (file) => file.startsWith('packages/rawengine-schema/') || file.includes('/schemas/'))) {
    commands.push({ command: ['bun', 'run', 'schema:check'], label: 'schema' });
  }

  if (hasAny(changedFiles, (file) => file.endsWith('.tsx') || file.startsWith('src/i18n/locales/'))) {
    commands.push({ command: ['bun', 'run', 'check:i18n'], label: 'i18n' });
  }

  if (
    hasAny(
      changedFiles,
      (file) =>
        file === 'package.json' ||
        file.startsWith('.github/') ||
        file.startsWith('scripts/') ||
        file.startsWith('tests/integration/checks/'),
    )
  ) {
    commands.push({ command: ['bun', 'run', 'check:compact-commands'], label: 'compact commands' });
  }

  if (
    hasAny(
      changedFiles,
      (file) =>
        file === 'vite.config.js' ||
        file.startsWith('src/') ||
        file.startsWith('public/') ||
        file.startsWith('index.html'),
    )
  ) {
    commands.push({ command: ['bun', 'run', 'check:bundle'], label: 'bundle' });
  }

  if (hasAny(changedFiles, isRustRuntimeFile)) {
    commands.push({ command: ['bun', 'run', 'check:rust:fmt'], label: 'rust fmt' });
    commands.push({ command: ['bun', 'run', 'check:rust:check'], label: 'rust check' });
    commands.push({ command: ['bun', 'run', 'check:rust:clippy'], label: 'rust clippy' });
  }

  if (hasAny(changedFiles, isShaderOrRenderFile)) {
    commands.push({ command: ['bun', 'run', 'check:visual-smoke:pr'], label: 'visual smoke pr' });
  }

  for (const routedCheck of routeFeatureChecks(changedFiles)) {
    commands.push({ command: ['bun', 'run', routedCheck], label: routedCheck });
  }

  const changedCheckFiles = changedFiles.filter(
    (file) =>
      file.startsWith('tests/integration/checks/check-') &&
      file.endsWith('.ts') &&
      !file.endsWith('check-current-pr-local.ts'),
  );
  if (changedCheckFiles.length > 20) {
    commands.push({ command: ['bun', 'run', 'check:validation-test-paths'], label: 'validation test paths' });
  } else {
    for (const file of changedCheckFiles) {
      commands.push({ command: ['bun', file, ...(CHANGED_CHECK_SELF_TEST_ARGS.get(file) ?? [])], label: file });
    }
  }

  return commands;
}

function routeFeatureChecks(changedFiles: ReadonlyArray<string>): Array<string> {
  const checks = new Set<string>();
  const addIf = (predicate: (file: string) => boolean, scripts: Array<string>): void => {
    if (hasAny(changedFiles, predicate)) {
      for (const script of scripts) checks.add(script);
    }
  };

  addIf(
    (file) => file.includes('filmGrain') || file.includes('film-grain'),
    [
      'check:film-grain-provenance',
      'check:film-grain-runtime-proof',
      'check:film-grain-preview-export-parity',
      'check:film-grain-ui',
    ],
  );
  addIf(
    (file) => file.includes('filmHalation') || file.includes('film-halation'),
    ['check:film-halation-runtime-proof'],
  );
  addIf(
    (file) => file.includes('selectiveColor') || file.includes('selective-color'),
    ['check:selective-color-command-proof', 'check:selective-color-independent-proof'],
  );
  addIf(
    (file) => file.includes('colorStylePreset') || file.includes('color-style') || file.includes('PresetsPanel'),
    ['check:color-style-presets', 'check:color-style-ui-coverage'],
  );
  addIf(
    (file) => file === 'src/components/adjustments/Effects.tsx' || file === 'src/utils/filmGrainControls.ts',
    ['check:film-grain-ui'],
  );
  addIf(
    (file) => file.includes('focusConfidenceSourceMap') || file.includes('focus-confidence-source-map'),
    ['check:focus-confidence-source-map'],
  );
  addIf(
    (file) => file.startsWith('packages/rawengine-schema/src/focusStack'),
    ['check:focus-runtime-plan-smoke', 'check:focus-preview-blend-smoke'],
  );
  addIf(
    (file) => file.startsWith('packages/rawengine-schema/src/superResolution'),
    ['check:super-resolution-app-server-runtime'],
  );
  addIf(
    (file) => file.includes('superResolutionReconstruction') || file.includes('super-resolution-reconstruction'),
    ['check:sr-reconstruction-proof'],
  );
  addIf((file) => file.startsWith('packages/rawengine-schema/src/panorama'), ['check:panorama-runtime-plan-smoke']);
  addIf(
    (file) => file.includes('panoramaSyntheticStitch') || file.includes('panorama-exposure-runtime-proof'),
    ['check:panorama-exposure-runtime-proof'],
  );
  addIf(
    (file) => file.includes('panoramaRuntimePlan') || file.includes('panorama-graph-reference-proof'),
    ['check:panorama-graph-reference-proof'],
  );
  addIf(
    (file) => file.includes('panoramaRuntimePlan') || file.includes('panorama-cycle-consistency-proof'),
    ['check:panorama-cycle-consistency-proof'],
  );
  addIf(
    (file) => file.includes('panoramaLocalOptimizationRansac') || file.includes('panorama-lo-ransac-proof'),
    ['check:panorama-lo-ransac-proof'],
  );
  addIf(
    (file) => file.includes('panoramaLocalOptimizationRansac') || file.includes('panorama-distributed-inlier-proof'),
    ['check:panorama-distributed-inlier-proof'],
  );
  addIf(
    (file) => file.includes('panoramaHomographyDiagnostics') || file.includes('panorama-homography-diagnostics'),
    ['check:panorama-homography-diagnostics'],
  );
  addIf((file) => file.startsWith('packages/rawengine-schema/src/hdr'), ['check:hdr-ui-runtime-bridge']);
  addIf((file) => file === 'src/components/modals/HdrModal.tsx', ['check:hdr-merge-ui']);
  addIf(
    (file) =>
      file === 'src/components/ui/AppProperties.tsx' ||
      file === 'src-tauri/src/lib.rs' ||
      file === 'tests/integration/checks/check-tauri-command-registration.ts',
    ['check:tauri-command-registration'],
  );
  addIf(
    (file) =>
      file === 'src-tauri/Cargo.toml' ||
      file === 'src-tauri/src/lib.rs' ||
      file === 'src-tauri/src/raw_open_edit_export_proof.rs' ||
      file === 'src/utils/rawOpenEditExportProofCommand.ts' ||
      file === 'tests/integration/checks/check-raw-open-edit-export-command-wrapper.ts',
    [
      'check:raw-open-edit-export-command-wrapper',
      'check:raw-open-edit-export-proof',
      'check:raw-open-edit-export-validation-feature',
    ],
  );

  return [...checks].toSorted();
}

function isRustRuntimeFile(file: string): boolean {
  return (
    file === 'src-tauri/Cargo.toml' ||
    file === 'src-tauri/Cargo.lock' ||
    (file.startsWith('src-tauri/') && file.endsWith('.rs'))
  );
}

function isShaderOrRenderFile(file: string): boolean {
  return (
    file.endsWith('.wgsl') ||
    file.endsWith('.glsl') ||
    file.endsWith('.metal') ||
    file.startsWith('src/render/') ||
    file.startsWith('src/shaders/') ||
    file.startsWith('src-tauri/shaders/')
  );
}

function assertSelfTestRoute(files: Array<string>, expectedLabels: Array<string>): void {
  const labels = new Set(routeCommandsForChangedFiles(files).map((command) => command.label));
  const missing = expectedLabels.filter((label) => !labels.has(label));
  if (missing.length > 0) {
    console.error('current pr local self-test failed');
    console.error(`- ${files.join(', ')} missing route labels: ${missing.join(', ')}`);
    process.exit(1);
  }
}

const baseRef = 'origin/main';
if (!existsSync('.git')) {
  console.error('current pr local failed');
  console.error('- run from repo root');
  process.exit(1);
}

if (process.argv.includes('--self-test')) {
  const probeFile = '__current_pr_local_untracked_probe__.md';
  try {
    writeFileSync(probeFile, '# current-pr-local untracked probe\n');
    const changedFiles = collectChangedFiles(baseRef);
    if (!changedFiles.includes(probeFile)) {
      console.error('current pr local self-test failed');
      console.error('- untracked files were not included in changed-file detection');
      process.exit(1);
    }
  } finally {
    rmSync(probeFile, { force: true });
  }

  assertSelfTestRoute(['src-tauri/src/file_management.rs'], ['rust fmt', 'rust check', 'rust clippy']);
  assertSelfTestRoute(['src/shaders/preview.wgsl'], ['visual smoke pr']);
  assertSelfTestRoute(['src/utils/focusConfidenceSourceMap.ts'], ['check:focus-confidence-source-map']);
  assertSelfTestRoute(
    ['packages/rawengine-schema/src/filmGrainRuntime.ts'],
    ['check:film-grain-runtime-proof', 'check:film-grain-preview-export-parity', 'check:film-grain-ui'],
  );
  assertSelfTestRoute(
    ['tests/integration/checks/check-schema-contract-gate.ts'],
    ['tests/integration/checks/check-schema-contract-gate.ts'],
  );
  assertSelfTestRoute(
    ['packages/rawengine-schema/src/focusStackWeightedBlend.ts'],
    ['check:focus-preview-blend-smoke'],
  );
  assertSelfTestRoute(
    ['src/utils/selectiveColorRuntime.ts'],
    ['check:selective-color-command-proof', 'check:selective-color-independent-proof'],
  );

  console.log('current pr local self-test ok');
  process.exit(0);
}

run(['git', 'fetch', 'origin', 'main', '--quiet'], 'fetch main', true);

const changedFiles = collectChangedFiles(baseRef);

if (changedFiles.length === 0) {
  console.log('current pr local ok (no changed files)');
  process.exit(0);
}

const commands = routeCommandsForChangedFiles(changedFiles);

const seenCommands = new Set<string>();
let failed = false;
for (const item of commands) {
  const key = item.command.join('\0');
  if (seenCommands.has(key)) continue;
  seenCommands.add(key);
  const result = run(item.command, item.label);
  if (result.code !== 0) failed = true;
}

if (failed) process.exit(1);
console.log(`current pr local ok (${changedFiles.length} files)`);
