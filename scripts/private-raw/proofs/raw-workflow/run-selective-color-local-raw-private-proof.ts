#!/usr/bin/env bun

import { resolve } from 'node:path';

import { z } from 'zod';

import { formatCommandForLog, readBoundedStream, writeBoundedOutput } from '../../../lib/compact-output.ts';

const argsSchema = z
  .object({
    privateRoot: z.string().trim().min(1).optional(),
    requireAssets: z.boolean(),
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
});

const REQUEST_PATH = 'fixtures/validation/selective-color-raw-proof-request.json';

await runRequired('selective color committed RAW proof summary', [
  'bun',
  'run',
  'check:selective-color-local-raw-proof',
]);

if (args.privateRoot === undefined) {
  if (args.requireAssets) {
    console.error('RAWENGINE_PRIVATE_RAW_ROOT or --root is required with --require-assets.');
    process.exit(1);
  }
  console.log('selective color local RAW private proof skipped (RAWENGINE_PRIVATE_RAW_ROOT unset)');
  process.exit(0);
}

const privateRoot = resolve(args.privateRoot);
const prepare = await runCommand({
  command: [
    'bun',
    'scripts/private-raw/prepare/prepare-raw-open-edit-export-private-root.ts',
    '--request',
    REQUEST_PATH,
    '--root',
    privateRoot,
    ...(args.requireAssets ? ['--require-assets'] : []),
  ],
});

if (prepare.exitCode !== 0) {
  reportFailure('RAW open/edit/export private root prep', prepare, [
    'bun',
    'scripts/private-raw/prepare/prepare-raw-open-edit-export-private-root.ts',
    '--request',
    REQUEST_PATH,
    '--root',
    privateRoot,
  ]);
}

if (prepare.stdout.includes('private root skipped')) {
  if (args.requireAssets) {
    console.error('RAW open/edit/export private root unexpectedly skipped with --require-assets.');
    process.exit(1);
  }
  console.log('selective color local RAW private proof skipped (local RAW source unavailable)');
  process.exit(0);
}

await runRequired(
  'selective color RAW runtime proof',
  [
    'cargo',
    '+1.95.0',
    'test',
    '--locked',
    '--no-default-features',
    '--features',
    'required-ci,validation-harness,tauri-test',
    'raw_open_edit_export_proof::tests::private_runtime_smoke_generates_selective_color_report_when_enabled',
    '--',
    '--nocapture',
  ],
  {
    cwd: 'src-tauri',
    env: {
      RAWENGINE_PRIVATE_RAW_ROOT: privateRoot,
      RAWENGINE_RUN_PRIVATE_RAW_SELECTIVE_COLOR_PROOF: '1',
    },
  },
);

await runRequired(
  'selective color private artifact validation',
  ['bun', 'run', 'check:selective-color-local-raw-proof', '--require-assets'],
  {
    env: {
      RAWENGINE_PRIVATE_RAW_ROOT: privateRoot,
    },
  },
);

console.log('selective color local RAW private proof ok');

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
