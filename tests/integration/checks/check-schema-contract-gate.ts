#!/usr/bin/env bun

import { readFileSync } from 'node:fs';

import { z } from 'zod';

import { formatCommandForLog, readBoundedStream, writeBoundedOutput } from '../../../scripts/lib/ci/compact-output.ts';

const GITHUB_FILE_SCHEMA = z
  .object({
    filename: z.string().trim().min(1),
    patch: z.string().optional(),
  })
  .passthrough();

const CONTRACT_COMMANDS = [
  ['bun', 'tests/integration/checks/check-agent-approval-boundaries.ts'],
  ['bun', 'tests/integration/checks/check-agent-baseline-gates.ts'],
  ['bun', 'tests/integration/checks/check-agent-color-apply.ts'],
  ['bun', 'tests/integration/checks/check-agent-curve-levels-apply.ts'],
  ['bun', 'tests/integration/checks/check-agent-detail-effects-apply.ts'],
  ['bun', 'tests/integration/checks/check-agent-geometry-apply.ts'],
  ['bun', 'tests/integration/checks/check-agent-lens-profile-apply.ts'],
  ['bun', 'tests/integration/checks/check-agent-rollback-proof.ts'],
  ['bun', 'tests/integration/checks/check-ui-api-coverage.ts'],
  ['bun', 'tests/integration/checks/check-ai-app-server-tool-routes.ts'],
  ['bun', 'tests/integration/checks/check-ai-denoise-app-server-tool.ts'],
  ['bun', 'tests/integration/checks/check-tone-color-app-server-routes.ts'],
  ['bun', 'tests/integration/checks/check-rawengine-app-server-host.ts'],
  ['bun', 'tests/integration/checks/check-computational-merge-app-server-routes.ts'],
  ['bun', 'tests/integration/checks/check-computational-merge-ui-route-badges.ts'],
  ['bun', 'tests/integration/checks/check-deblur-app-server-tool.ts'],
  ['bun', 'tests/integration/checks/check-focus-ui-api.ts'],
  ['bun', 'tests/integration/checks/check-focus-ui-runtime-bridge.ts'],
  ['bun', 'tests/integration/checks/check-hdr-ui-api.ts'],
  ['bun', 'tests/integration/checks/check-hdr-ui-runtime-bridge.ts'],
  ['bun', 'tests/integration/checks/check-panorama-ui-api.ts'],
  ['bun', 'tests/integration/checks/check-panorama-ui-runtime-bridge.ts'],
  ['bun', 'tests/integration/checks/check-sr-ui-api.ts'],
  ['bun', 'tests/integration/checks/check-sr-ui-runtime-bridge.ts'],
  ['bun', 'tests/integration/checks/check-tauri-schema-validation.ts'],
  ['bun', 'tests/integration/checks/check-focus-app-server-runtime.ts'],
  ['bun', 'tests/integration/checks/check-hdr-app-server-runtime.ts'],
  ['bun', 'tests/integration/checks/check-super-resolution-app-server-runtime.ts'],
  ['bun', 'tests/integration/checks/check-panorama-app-server-runtime.ts'],
  [
    'bun',
    'scripts/ci/run-compact-command.ts',
    '--label',
    'schema:types',
    '--',
    'bunx',
    'tsc',
    '-p',
    'packages/rawengine-schema/tsconfig.json',
    '--noEmit',
    '--pretty',
    'false',
  ],
  ['bun', 'packages/rawengine-schema/scripts/check-samples.ts'],
  ['bun', 'packages/rawengine-schema/scripts/check-sample-artifacts.ts'],
  ['bun', 'packages/rawengine-schema/scripts/check-edit-graph-migrations.ts'],
  ['bun', 'packages/rawengine-schema/scripts/check-edit-command-bus.ts'],
  ['bun', 'packages/rawengine-schema/scripts/check-focus-app-server-command-bus.ts'],
  ['bun', 'packages/rawengine-schema/scripts/check-hdr-app-server-command-bus.ts'],
  ['bun', 'packages/rawengine-schema/scripts/check-hdr-api-tools.ts'],
  ['bun', 'packages/rawengine-schema/scripts/check-super-resolution-app-server-command-bus.ts'],
  ['bun', 'packages/rawengine-schema/scripts/check-panorama-app-server-command-bus.ts'],
] satisfies Array<[string, ...string[]]>;

const RELEVANT_PREFIXES = ['packages/rawengine-schema/', 'src/schemas/', 'src-tauri/gen/schemas/'];

const RELEVANT_FILES = new Set([
  '.github/workflows/lint.yml',
  'bun.lock',
  'tests/integration/checks/check-tauri-schema-validation.ts',
  'src/App.tsx',
  'src/utils/tauriSchemaInvoke.ts',
]);

const PACKAGE_SCRIPT_NAMES = new Set([
  'check:actions',
  'check:ai-app-server-routes',
  'check:ai-denoise-app-server-tool',
  'check:agent-approval-boundaries',
  'check:agent-baseline-gates',
  'check:agent-color-apply',
  'check:agent-curve-levels-apply',
  'check:agent-detail-effects-apply',
  'check:agent-geometry-apply',
  'check:agent-lens-profile-apply',
  'check:agent-proof-gallery',
  'check:agent-rollback-proof',
  'check:computational-merge-app-server-routes',
  'check:computational-merge-ui-route-badges',
  'check:deblur-app-server-tool',
  'check:focus-ui-api',
  'check:focus-ui-runtime-bridge',
  'check:focus-app-server-runtime',
  'check:hdr-ui-api',
  'check:hdr-ui-runtime-bridge',
  'check:hdr-app-server-runtime',
  'check:panorama-app-server-runtime',
  'check:panorama-ui-api',
  'check:panorama-ui-runtime-bridge',
  'check:rawengine-app-server-host',
  'check:sr-app-server-runtime',
  'check:sr-ui-api',
  'check:sr-ui-runtime-bridge',
  'check:ui-api-coverage',
  'check:tauri-schema-validation',
  'schema:check',
  'schema:command-bus',
  'schema:contract-gate',
  'schema:contract-gate:self-test',
  'schema:fixtures',
  'schema:focus-app-server',
  'schema:hdr-api-tools',
  'schema:hdr-app-server',
  'schema:sr-app-server',
  'schema:panorama-app-server',
  'schema:samples',
  'schema:types',
]);

const args = process.argv.slice(2);

function changedPackageScripts(patch) {
  if (!patch) return true;

  return patch
    .split(/\r?\n/u)
    .filter((line) => /^[+-]/u.test(line) && !line.startsWith('+++') && !line.startsWith('---'))
    .some((line) => {
      const match = /^[-+]\s*"(?<scriptName>[^"]+)":/u.exec(line);
      return match?.groups ? PACKAGE_SCRIPT_NAMES.has(match.groups.scriptName) : false;
    });
}

function isRelevantChange(change) {
  const filename = change.filename.trim();
  if (!filename) return false;

  if (filename === 'package.json') return changedPackageScripts(change.patch);
  if (RELEVANT_FILES.has(filename)) return true;
  return RELEVANT_PREFIXES.some((prefix) => filename.startsWith(prefix));
}

function classifyChanges(changes) {
  const normalized = changes
    .map((change) => ({
      filename: change.filename.trim(),
      patch: change.patch,
    }))
    .filter((change) => change.filename);

  if (normalized.length === 0) {
    return {
      shouldRun: true,
      reason: 'no changed files were reported; running schema contract checks fail-closed',
      relevantFiles: [],
    };
  }

  const relevantFiles = normalized.filter(isRelevantChange).map((change) => change.filename);
  return {
    shouldRun: relevantFiles.length > 0,
    reason:
      relevantFiles.length > 0
        ? `schema/API contract paths changed (${relevantFiles.length})`
        : `schema/API contract checks skipped; ${normalized.length} changed path(s) are covered elsewhere`,
    relevantFiles,
  };
}

function parseGitHubFileEntries(entries) {
  return entries.map((entry, index) => {
    const parsed = GITHUB_FILE_SCHEMA.safeParse(entry);
    if (!parsed.success) {
      throw new Error(`changed file entry ${index + 1} is invalid: ${parsed.error.issues[0]?.message ?? 'unknown'}`);
    }
    return parsed.data;
  });
}

function readPullFilesJson(path) {
  const raw = JSON.parse(readFileSync(path, 'utf8'));
  const entries = Array.isArray(raw) && Array.isArray(raw[0]) ? raw.flat() : raw;
  if (!Array.isArray(entries)) throw new Error(`Expected ${path} to contain a GitHub pull files array`);
  return parseGitHubFileEntries(entries);
}

function readPullFilesNdjson(path) {
  const entries = readFileSync(path, 'utf8')
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line));

  return parseGitHubFileEntries(entries);
}

function readFiles(path) {
  return readFileSync(path, 'utf8')
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((filename) => ({ filename }));
}

async function runCommand(command: [string, ...string[]]) {
  const proc = Bun.spawn(command, {
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const stdout = readBoundedStream(proc.stdout);
  const stderr = readBoundedStream(proc.stderr);
  const exitCode = await proc.exited;

  if (exitCode === 0) return;

  console.error(`${command.join(' ')} failed`);
  console.error(`$ ${formatCommandForLog(command[0], command.slice(1))}`);
  writeBoundedOutput('stdout', await stdout);
  writeBoundedOutput('stderr', await stderr);
  process.exit(exitCode);
}

async function runContractChecks(changes) {
  const result = classifyChanges(changes);

  if (!result.shouldRun) {
    console.log(`schema-contract skipped: ${result.reason}`);
    return;
  }

  for (const command of CONTRACT_COMMANDS) {
    await runCommand(command);
  }

  console.log(`schema-contract ok (${CONTRACT_COMMANDS.length}); ${result.reason}`);
}

function assertClassification(name, changes, expectedRun) {
  const result = classifyChanges(changes);
  if (result.shouldRun !== expectedRun) {
    throw new Error(`${name}: expected shouldRun=${expectedRun}; got ${result.shouldRun}. ${result.reason}`);
  }
}

function runSelfTest() {
  assertClassification('empty changes fail closed', [], true);
  assertClassification('docs skip', [{ filename: 'docs/tooling/schema.md' }], false);
  assertClassification(
    'schema package runs',
    [{ filename: 'packages/rawengine-schema/src/rawEngineSchemas.ts' }],
    true,
  );
  assertClassification('frontend schema runs', [{ filename: 'src/schemas/folderTreeSchemas.ts' }], true);
  assertClassification('tauri schema helper runs', [{ filename: 'src/utils/tauriSchemaInvoke.ts' }], true);
  assertClassification('package dependency change runs fail-safe', [{ filename: 'package.json' }], true);
  assertClassification(
    'schema package script runs',
    [
      {
        filename: 'package.json',
        patch:
          '@@ -1,3 +1,4 @@\n+    "schema:contract-gate": "bun tests/integration/checks/check-schema-contract-gate.ts",',
      },
    ],
    true,
  );
  assertClassification(
    'non-schema package script skips',
    [
      {
        filename: 'package.json',
        patch:
          '@@ -1,3 +1,4 @@\n+    "check:release-notes": "bun scripts/release/generate-release-notes.ts --self-test",',
      },
    ],
    false,
  );
  console.log('schema contract gate self-test ok');
}

if (args.includes('--self-test')) {
  runSelfTest();
  process.exit(0);
}

const filesIndex = args.indexOf('--files');
const pullFilesJsonIndex = args.indexOf('--pull-files-json');
const pullFilesNdjsonIndex = args.indexOf('--pull-files-ndjson');

let changes;
if (filesIndex >= 0) {
  changes = readFiles(args[filesIndex + 1]);
} else if (pullFilesJsonIndex >= 0) {
  changes = readPullFilesJson(args[pullFilesJsonIndex + 1]);
} else if (pullFilesNdjsonIndex >= 0) {
  changes = readPullFilesNdjson(args[pullFilesNdjsonIndex + 1]);
} else {
  changes = [];
}

await runContractChecks(changes);
