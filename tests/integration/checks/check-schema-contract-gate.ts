#!/usr/bin/env bun

import { readFileSync } from 'node:fs';

import { z } from 'zod';

import { formatCommandForLog, readBoundedStream, writeBoundedOutput } from '../../../scripts/compact-output.ts';

const GITHUB_FILE_SCHEMA = z
  .object({
    filename: z.string().trim().min(1),
    patch: z.string().optional(),
  })
  .passthrough();

const CONTRACT_CHECKS = [
  'check:agent-approval-boundaries',
  'check:agent-baseline-gates',
  'check:agent-color-apply',
  'check:agent-curve-levels-apply',
  'check:agent-geometry-apply',
  'check:agent-rollback-proof',
  'check:agent-proof-gallery',
  'check:ui-api-coverage',
  'check:ai-app-server-routes',
  'check:ai-denoise-app-server-tool',
  'check:tone-color-app-server-routes',
  'check:rawengine-app-server-host',
  'check:computational-merge-app-server-routes',
  'check:computational-merge-ui-route-badges',
  'check:deblur-app-server-tool',
  'check:focus-ui-api',
  'check:focus-ui-runtime-bridge',
  'check:hdr-ui-api',
  'check:hdr-ui-runtime-bridge',
  'check:panorama-ui-api',
  'check:panorama-ui-runtime-bridge',
  'check:sr-ui-api',
  'check:sr-ui-runtime-bridge',
  'schema:check',
  'schema:command-bus',
  'check:focus-app-server-runtime',
  'check:hdr-app-server-runtime',
  'schema:focus-app-server',
  'schema:hdr-app-server',
  'schema:hdr-api-tools',
  'check:sr-app-server-runtime',
  'schema:sr-app-server',
  'check:panorama-app-server-runtime',
  'schema:panorama-app-server',
  'check:tauri-schema-validation',
  'check:tone-color-app-server-routes',
];

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
  'check:agent-geometry-apply',
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

async function runPackageScript(scriptName) {
  const command = ['bun', 'run', scriptName];
  const proc = Bun.spawn(command, {
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const stdout = readBoundedStream(proc.stdout);
  const stderr = readBoundedStream(proc.stderr);
  const exitCode = await proc.exited;

  if (exitCode === 0) return;

  console.error(`${scriptName} failed`);
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

  for (const scriptName of CONTRACT_CHECKS) {
    await runPackageScript(scriptName);
  }

  console.log(`schema-contract ok (${CONTRACT_CHECKS.length}); ${result.reason}`);
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
        patch: '@@ -1,3 +1,4 @@\n+    "check:release-notes": "bun scripts/generate-release-notes.ts --self-test",',
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
