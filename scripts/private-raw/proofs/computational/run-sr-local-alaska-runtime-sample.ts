#!/usr/bin/env bun

import { resolve } from 'node:path';

import { formatCommandForLog, readBoundedStream, writeBoundedOutput } from '../../../lib/ci/compact-output.ts';

const privateRoot = valueAfter('--root') ?? process.env.RAWENGINE_PRIVATE_RAW_ROOT;
if (privateRoot === undefined || privateRoot.trim().length === 0) {
  console.error('RAWENGINE_PRIVATE_RAW_ROOT or --root is required.');
  process.exit(1);
}

const sourceRoot = valueAfter('--source') ?? process.env.RAWENGINE_PRIVATE_RAW_SOURCE ?? privateRoot;
const materialize = valueAfter('--materialize') ?? process.env.RAWENGINE_PRIVATE_RAW_MATERIALIZE ?? 'symlink';
const resolvedPrivateRoot = resolve(privateRoot);
const resolvedSourceRoot = resolve(sourceRoot);

await runCompact('SR Alaska private source ingest', [
  'bun',
  'scripts/private-raw/prepare/prepare-sr-real-raw-private-root.ts',
  '--source',
  resolvedSourceRoot,
  '--materialize',
  materialize,
  '--require-assets',
]);

await runCompact('SR Alaska decoded runtime sample proof', [
  'bun',
  'scripts/private-raw/proofs/computational/run-sr-real-raw-private-proof.ts',
  '--root',
  resolvedPrivateRoot,
  '--require-assets',
]);

console.log(
  'SR Alaska decoded runtime sample ok (private-artifacts/validation/computational-merge/sr-subpixel-runtime-sample.json)',
);

async function runCompact(label: string, command: Array<string>): Promise<void> {
  const proc = Bun.spawn(command, {
    env: {
      ...process.env,
      RAWENGINE_PRIVATE_RAW_ROOT: resolvedPrivateRoot,
    },
    stderr: 'pipe',
    stdout: 'pipe',
  });
  const stdout = readBoundedStream(proc.stdout);
  const stderr = readBoundedStream(proc.stderr);
  const exitCode = await proc.exited;

  if (exitCode === 0) return;

  console.error(`${label} failed`);
  console.error(`$ ${formatCommandForLog(command[0] ?? '', command.slice(1))}`);
  writeBoundedOutput('stdout', await stdout);
  writeBoundedOutput('stderr', await stderr);
  process.exit(exitCode);
}

function valueAfter(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : undefined;
}
