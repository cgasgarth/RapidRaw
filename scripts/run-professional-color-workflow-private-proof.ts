#!/usr/bin/env bun

import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { z } from 'zod';

import { formatCommandForLog, readBoundedStream, writeBoundedOutput } from './compact-output.ts';
import { resolvePrivateRawRootSource } from './lib/private-raw-root-source.ts';

const FIXTURE_ID = 'validation.raw-open-edit-export.professional-color.v1';
const REQUEST_PATH = 'fixtures/validation/professional-color-workflow-proof-request.json';
const SOURCE_RELATIVE_PATH = 'private-fixtures/color/professional-workflow-v1/alaska-dsc7853.arw';

const argsSchema = z
  .object({
    privateRoot: z.string().trim().min(1).optional(),
    requireAssets: z.boolean(),
    source: z.string().trim().min(1).optional(),
  })
  .strict();

interface RunOptions {
  command: Array<string>;
  cwd?: string;
  env?: Record<string, string>;
}

interface RunResult {
  exitCode: number;
  stderr: string;
  stdout: string;
}

const args = argsSchema.parse({
  privateRoot: valueAfter('--root') ?? process.env.RAWENGINE_PRIVATE_RAW_ROOT,
  requireAssets: process.argv.includes('--require-assets'),
  source: valueAfter('--source') ?? process.env.RAWENGINE_PRIVATE_RAW_SOURCE,
});

await runRequired('professional color committed proof summary', [
  'bun',
  'run',
  'check:professional-color-workflow-local-raw-proof',
]);

if (args.privateRoot === undefined) {
  if (args.requireAssets) {
    console.error('RAWENGINE_PRIVATE_RAW_ROOT or --root is required with --require-assets.');
    process.exit(1);
  }
  console.log('professional color workflow private proof skipped (RAWENGINE_PRIVATE_RAW_ROOT unset)');
  process.exit(0);
}

const resolution = await resolvePrivateRawRootSource({
  fixtureRelativePath: SOURCE_RELATIVE_PATH,
  privateRoot: args.privateRoot,
  source: args.source,
  tempPrefix: 'rawengine-professional-color-plain-root-',
});
const privateRoot = resolution.privateRoot;

await runRequired('professional color private root prep', [
  'bun',
  'scripts/prepare-raw-open-edit-export-private-root.ts',
  '--root',
  privateRoot,
  '--request',
  REQUEST_PATH,
  ...(resolution.source === undefined ? [] : ['--source', resolution.source]),
  ...(args.requireAssets ? ['--require-assets'] : []),
]);

await runRequired(
  'professional color Rust runtime proof',
  [
    'cargo',
    '+1.95.0',
    'test',
    '--locked',
    '--no-default-features',
    '--features',
    'required-ci,validation-harness,tauri-test',
    'raw_open_edit_export_proof::tests::private_runtime_smoke_generates_professional_color_report_when_enabled',
    '--',
    '--nocapture',
  ],
  {
    cwd: 'src-tauri',
    env: {
      RAWENGINE_RUN_PRIVATE_RAW_PROFESSIONAL_COLOR_PROOF: '1',
      RAWENGINE_PRIVATE_RAW_ROOT: privateRoot,
    },
  },
);

const tempOutputDir = await mkdtemp(join(tmpdir(), 'rawengine-professional-color-report-'));
const reportOutputPath = join(tempOutputDir, 'raw-open-edit-export-run-reports.json');

try {
  await runRequired('professional color private report collection', [
    'bun',
    'scripts/collect-raw-open-edit-export-private-run-reports.ts',
    '--root',
    privateRoot,
    '--require-root',
    '--fixture-id',
    FIXTURE_ID,
    '--output',
    reportOutputPath,
  ]);

  const collection = JSON.parse(await readFile(reportOutputPath, 'utf8')) as {
    reports?: Array<{ fixtureId?: string }>;
  };
  if (!collection.reports?.some((report) => report.fixtureId === FIXTURE_ID)) {
    console.error(`${FIXTURE_ID}: missing collected private run report.`);
    process.exit(1);
  }

  await runRequired(
    'professional color private report validation',
    [
      'bun',
      'tests/integration/checks/check-raw-open-edit-export-run-reports.ts',
      '--input',
      reportOutputPath,
      '--allow-fresh-hashes',
      '--require-assets',
      '--fixture-id',
      FIXTURE_ID,
    ],
    {
      env: {
        RAWENGINE_PRIVATE_RAW_ROOT: privateRoot,
      },
    },
  );
} finally {
  await rm(tempOutputDir, { force: true, recursive: true });
}

console.log('professional color workflow private proof ok');

async function runRequired(
  label: string,
  command: Array<string>,
  options: Omit<RunOptions, 'command'> = {},
): Promise<void> {
  const result = await runCommand({ ...options, command });
  if (result.exitCode === 0) return;
  reportFailure(label, result, command);
}

async function runCommand(options: RunOptions): Promise<RunResult> {
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
