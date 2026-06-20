#!/usr/bin/env bun

import { resolve } from 'node:path';

import { z } from 'zod';

import { formatCommandForLog, readBoundedStream, writeBoundedOutput } from './compact-output.ts';

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

await runRequired('professional workflow status', ['bun', 'run', 'check:professional-workflow-status']);
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

const privateRoot = resolve(args.privateRoot);

await runRequired('RAW color-management private proof runner', [
  'bun',
  'run',
  'run:raw-color-management-private-proof',
  '--root',
  privateRoot,
  ...(args.requireAssets ? ['--require-assets'] : []),
]);

await runRequired(
  'professional color private artifact validation',
  ['bun', 'run', 'check:professional-color-workflow-local-raw-proof', '--require-assets'],
  {
    env: {
      RAWENGINE_PRIVATE_RAW_ROOT: privateRoot,
    },
  },
);

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
