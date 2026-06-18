#!/usr/bin/env bun

import { mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

import { z } from 'zod';

import { formatCommandForLog, readBoundedStream, writeBoundedOutput } from './compact-output.ts';

const argsSchema = z
  .object({
    outputPath: z.string().trim().min(1).optional(),
    privateRoot: z.string().trim().min(1).optional(),
    requireAssets: z.boolean(),
  })
  .strict();

const args = argsSchema.parse({
  outputPath: valueAfter('--output'),
  privateRoot: valueAfter('--root') ?? process.env.RAWENGINE_PRIVATE_RAW_ROOT,
  requireAssets: process.argv.includes('--require-assets'),
});

for (const check of [
  ['bun', 'run', 'check:panorama-runtime-plan-smoke'],
  ['bun', 'run', 'check:panorama-app-server-runtime'],
  ['bun', 'run', 'check:panorama-ui-runtime-bridge'],
]) {
  await runCompact(check.join(' '), { command: check });
}

if (args.privateRoot === undefined) {
  if (args.requireAssets) {
    console.error('RAWENGINE_PRIVATE_RAW_ROOT or --root is required with --require-assets.');
    process.exit(1);
  }
  console.log('panorama real RAW private proof skipped (RAWENGINE_PRIVATE_RAW_ROOT unset)');
  process.exit(0);
}

const privateRoot = resolve(args.privateRoot);
if (args.outputPath !== undefined) {
  await mkdir(dirname(args.outputPath), { recursive: true });
}

await runCompact('panorama real RAW private root prep', {
  command: [
    'bun',
    'scripts/prepare-panorama-real-raw-private-root.ts',
    ...(args.requireAssets ? ['--require-assets'] : []),
  ],
  env: {
    RAWENGINE_PRIVATE_RAW_ROOT: privateRoot,
  },
});

await runCompact('computational merge private report collection', {
  command: [
    'bun',
    'scripts/collect-computational-merge-private-run-reports.ts',
    '--root',
    privateRoot,
    ...(args.outputPath === undefined ? [] : ['--output', args.outputPath]),
  ],
});

await runCompact('computational merge private report validation', {
  command: [
    'bun',
    'scripts/check-computational-merge-private-run-reports.ts',
    ...(args.outputPath === undefined ? [] : ['--input', args.outputPath]),
    ...(args.requireAssets ? ['--require-assets'] : []),
  ],
  env: {
    RAWENGINE_PRIVATE_RAW_ROOT: privateRoot,
  },
});

console.log('panorama real RAW private proof ok');

interface RunOptions {
  command: Array<string>;
  cwd?: string;
  env?: Record<string, string>;
}

async function runCompact(label: string, options: RunOptions): Promise<void> {
  const proc = Bun.spawn(options.command, {
    cwd: options.cwd ?? process.cwd(),
    env: { ...process.env, ...options.env },
    stderr: 'pipe',
    stdout: 'pipe',
  });
  const stdout = readBoundedStream(proc.stdout);
  const stderr = readBoundedStream(proc.stderr);
  const exitCode = await proc.exited;

  if (exitCode === 0) return;

  console.error(`${label} failed`);
  console.error(`$ ${formatCommandForLog(options.command[0] ?? '', options.command.slice(1))}`);
  writeBoundedOutput('stdout', await stdout);
  writeBoundedOutput('stderr', await stderr);
  process.exit(exitCode);
}

function valueAfter(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : undefined;
}
