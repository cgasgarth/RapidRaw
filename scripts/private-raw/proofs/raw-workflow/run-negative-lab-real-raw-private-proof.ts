#!/usr/bin/env bun

import { copyFile, mkdir, readdir, stat } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';

import { z } from 'zod';

import { formatCommandForLog, readBoundedStream, writeBoundedOutput } from '../../../lib/ci/compact-output.ts';
import { resolvePrivateRawRootSource } from '../../../lib/private-raw/root-source.ts';

const SOURCE_RELATIVE_PATH = 'private-fixtures/negative-lab/alaska-negative-lab-v1.arw';
const PREFERRED_SOURCE_NAME = '_DSC8786.ARW';
const RAW_EXTENSIONS = new Set(['.arw', '.cr2', '.cr3', '.dng', '.nef', '.raf', '.rw2']);

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

await runRequired('negative lab committed private RAW summary', [
  'bun',
  'run',
  'check:negative-lab-real-raw-private-proof-summary',
]);

if (args.privateRoot === undefined) {
  if (args.requireAssets) {
    console.error('RAWENGINE_PRIVATE_RAW_ROOT or --root is required with --require-assets.');
    process.exit(1);
  }
  console.log('negative lab real RAW private proof skipped (RAWENGINE_PRIVATE_RAW_ROOT unset)');
  process.exit(0);
}

const resolution = await resolvePrivateRawRootSource({
  fixtureRelativePath: SOURCE_RELATIVE_PATH,
  privateRoot: args.privateRoot,
  source: args.source,
  tempPrefix: 'rawengine-negative-lab-plain-root-',
});
const privateRoot = resolution.privateRoot;
const usesPlainSourceRoot = resolution.source !== undefined && privateRoot !== resolve(args.privateRoot);
await preparePrivateRoot(privateRoot, resolution.source);

await runRequired(
  'negative lab real RAW Rust proof',
  [
    'cargo',
    'test',
    '--quiet',
    '--locked',
    '--no-default-features',
    '--features',
    'required-ci,tauri-test',
    'negative_lab_private_raw_exports_positive_report_when_enabled',
    '--',
    '--nocapture',
  ],
  {
    cwd: 'src-tauri',
    env: {
      RAWENGINE_PRIVATE_RAW_ROOT: privateRoot,
      RAWENGINE_RUN_NEGATIVE_LAB_PRIVATE_RAW_PROOF: '1',
    },
  },
);

await runRequired(
  'negative lab private RAW artifact validation',
  [
    'bun',
    'run',
    'check:negative-lab-real-raw-private-proof-summary',
    '--require-assets',
    ...(usesPlainSourceRoot ? ['--allow-fresh-hashes'] : []),
  ],
  { env: { RAWENGINE_PRIVATE_RAW_ROOT: privateRoot } },
);

console.log('negative lab real RAW private proof ok');

async function preparePrivateRoot(privateRoot: string, source: string | undefined): Promise<void> {
  const destination = resolve(privateRoot, SOURCE_RELATIVE_PATH);
  try {
    const destinationStat = await stat(destination);
    if (destinationStat.isFile()) return;
  } catch {
    // Missing destination is prepared below from RAWENGINE_PRIVATE_RAW_SOURCE.
  }

  if (source === undefined) {
    throw new Error('RAWENGINE_PRIVATE_RAW_SOURCE or --source is required when the private RAW is not staged.');
  }

  const sourcePath = await resolveSourceRaw(source);
  await mkdir(resolve(privateRoot, 'private-fixtures/negative-lab'), { recursive: true });
  await copyFile(sourcePath, destination);
}

async function resolveSourceRaw(source: string): Promise<string> {
  const sourcePath = resolve(source);
  const sourceStat = await stat(sourcePath);
  if (sourceStat.isFile()) return sourcePath;

  const names = (await readdir(sourcePath)).toSorted();
  const rawName =
    names.find((name) => name === PREFERRED_SOURCE_NAME) ??
    names.find((name) => RAW_EXTENSIONS.has(extname(name).toLowerCase()));
  if (rawName === undefined) throw new Error(`No RAW files found in ${sourcePath}.`);
  return join(sourcePath, rawName);
}

async function runRequired(
  label: string,
  command: Array<string>,
  options: Omit<RunOptions, 'command'> = {},
): Promise<void> {
  const result = await runCommand({ ...options, command });
  if (result.exitCode === 0) return;
  console.error(`${label} failed`);
  console.error(`$ ${formatCommandForLog(command[0] ?? '', command.slice(1))}`);
  writeBoundedOutput('stdout', result.stdout);
  writeBoundedOutput('stderr', result.stderr);
  process.exit(result.exitCode);
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

function valueAfter(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : undefined;
}
