#!/usr/bin/env bun

import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

import { z } from 'zod';

import { parseRawOpenEditExportRunReportCollection } from '../../../../src/schemas/rawOpenEditExportRunReportSchemas.ts';
import { formatCommandForLog, readBoundedStream, writeBoundedOutput } from '../../../lib/ci/compact-output.ts';

const DEFAULT_REQUEST_PATH = 'fixtures/validation/raw-open-edit-export/raw-open-edit-export-proof-request.json';

const argsSchema = z
  .object({
    outputPath: z.string().trim().min(1).optional(),
    privateRoot: z.string().trim().min(1).optional(),
    requireAssets: z.boolean(),
    requestPath: z.string().trim().min(1).optional(),
  })
  .strict();

interface RunResult {
  exitCode: number;
  stderr: string;
  stdout: string;
}

const args = argsSchema.parse({
  outputPath: valueAfter('--output'),
  privateRoot: valueAfter('--root') ?? process.env.RAWENGINE_PRIVATE_RAW_ROOT,
  requireAssets: process.argv.includes('--require-assets'),
  requestPath: valueAfter('--request'),
});
const requestPath = resolve(args.requestPath ?? DEFAULT_REQUEST_PATH);
const usesDefaultRequest = args.requestPath === undefined;
const requestFixture = z
  .object({ fixtureId: z.string().trim().min(1) })
  .passthrough()
  .parse(JSON.parse(await readFile(requestPath, 'utf8')));

if (args.privateRoot === undefined) {
  if (args.requireAssets) {
    console.error('RAWENGINE_PRIVATE_RAW_ROOT or --root is required with --require-assets.');
    process.exit(1);
  }
  console.log('raw color-management private proof skipped (RAWENGINE_PRIVATE_RAW_ROOT unset)');
  process.exit(0);
}

const privateRoot = resolve(args.privateRoot);
const prepare = await runCommand('RAW open/edit/export private root prep', {
  command: [
    'bun',
    'scripts/private-raw/prepare/prepare-raw-open-edit-export-private-root.ts',
    '--root',
    privateRoot,
    ...requestArgs(),
    ...(args.requireAssets ? ['--require-assets'] : []),
  ],
});

if (prepare.exitCode !== 0) {
  reportFailure('RAW open/edit/export private root prep', prepare, [
    'bun',
    'scripts/private-raw/prepare/prepare-raw-open-edit-export-private-root.ts',
    '--root',
    privateRoot,
    ...requestArgs(),
  ]);
}

if (prepare.stdout.includes('private root skipped')) {
  if (args.requireAssets) {
    console.error('RAW open/edit/export private root unexpectedly skipped with --require-assets.');
    process.exit(1);
  }
  console.log('raw color-management private proof skipped (local RAW source unavailable)');
  process.exit(0);
}

let tempOutputDir: string | undefined;
const reportOutputPath =
  args.outputPath ??
  join(
    (tempOutputDir = await mkdtemp(join(tmpdir(), 'rawengine-raw-color-private-report-'))),
    'raw-open-edit-export-run-reports.json',
  );

if (args.outputPath !== undefined) {
  await mkdir(dirname(reportOutputPath), { recursive: true });
}

try {
  await runRequired(
    'RAW color-management Rust runtime proof',
    [
      'cargo',
      '+1.95.0',
      'test',
      '--locked',
      '--no-default-features',
      '--features',
      'required-ci,validation-harness,tauri-test',
      'raw_open_edit_export_proof::tests::private_runtime_smoke_generates_raw_open_edit_export_report_when_enabled',
      '--',
      '--nocapture',
    ],
    {
      cwd: 'src-tauri',
      env: {
        RAWENGINE_PRIVATE_RAW_ROOT: privateRoot,
        RAWENGINE_RAW_OPEN_EDIT_EXPORT_PROOF_REQUEST: requestPath,
        RAWENGINE_RUN_PRIVATE_RAW_OPEN_EDIT_EXPORT_PROOF: '1',
      },
    },
  );

  await runRequired('RAW open/edit/export private report collection', [
    'bun',
    'scripts/private-raw/proofs/raw-workflow/collect-raw-open-edit-export-private-run-reports.ts',
    '--root',
    privateRoot,
    '--require-root',
    '--fixture-id',
    requestFixture.fixtureId,
    '--output',
    reportOutputPath,
  ]);

  const collectedReports = parseRawOpenEditExportRunReportCollection(
    JSON.parse(await readFile(reportOutputPath, 'utf8')),
  );
  const hasFixtureReport = collectedReports.reports.some((report) => report.fixtureId === requestFixture.fixtureId);
  if (!hasFixtureReport) {
    console.error(`${requestFixture.fixtureId}: missing collected private run report.`);
    process.exit(1);
  }

  if (usesDefaultRequest) {
    await runRequired(
      'RAW open/edit/export private report validation',
      [
        'bun',
        'tests/integration/checks/raw/check-raw-open-edit-export-run-reports.ts',
        '--input',
        reportOutputPath,
        '--fixture-id',
        requestFixture.fixtureId,
        '--allow-fresh-hashes',
        '--require-assets',
      ],
      {
        env: {
          RAWENGINE_PRIVATE_RAW_ROOT: privateRoot,
        },
      },
    );
  }

  await runRequired('RAW color-management private report schema validation', [
    'bun',
    'tests/integration/checks/raw/check-raw-color-management-runtime-proof.ts',
    '--run-reports',
    reportOutputPath,
    ...requestArgs(),
    '--validate-only',
  ]);
} finally {
  if (tempOutputDir !== undefined) await rm(tempOutputDir, { force: true, recursive: true });
}

console.log('raw color-management private proof ok (real RAW runtime report validated)');

interface RunOptions {
  command: Array<string>;
  cwd?: string;
  env?: Record<string, string>;
}

async function runRequired(
  label: string,
  command: Array<string>,
  options: Omit<RunOptions, 'command'> = {},
): Promise<void> {
  const result = await runCommand(label, { ...options, command });
  if (result.exitCode === 0) return;
  reportFailure(label, result, command);
}

async function runCommand(_label: string, options: RunOptions): Promise<RunResult> {
  const proc = Bun.spawn(options.command, {
    cwd: options.cwd ?? process.cwd(),
    env: { ...process.env, ...options.env },
    stderr: 'pipe',
    stdout: 'pipe',
  });
  const stdout = readBoundedStream(proc.stdout);
  const stderr = readBoundedStream(proc.stderr);
  const exitCode = await proc.exited;

  return { exitCode, stderr: await stderr, stdout: await stdout };
}

function reportFailure(label: string, result: RunResult, command: Array<string>): never {
  console.error(`${label} failed`);
  console.error(`$ ${formatCommandForLog(command[0] ?? '', command.slice(1))}`);
  writeBoundedOutput('stdout', result.stdout);
  writeBoundedOutput('stderr', result.stderr);
  process.exit(result.exitCode);
}

function valueAfter(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function requestArgs(): Array<string> {
  return args.requestPath === undefined ? [] : ['--request', args.requestPath];
}
