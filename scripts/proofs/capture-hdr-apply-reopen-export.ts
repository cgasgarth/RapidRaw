#!/usr/bin/env bun

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const requireAssets = process.argv.includes('--require-assets');
const sourceRoot = process.env.RAWENGINE_PRIVATE_RAW_ROOT;
if (sourceRoot === undefined) {
  if (requireAssets) throw new Error('RAWENGINE_PRIVATE_RAW_ROOT is required.');
  console.log('HDR apply/reopen/export proof skipped (private RAW root not configured)');
  process.exit(0);
}

const preparedRoot = await mkdtemp(join(tmpdir(), 'rawengine-hdr-5207-'));
try {
  await run(
    [
      'bun',
      'scripts/private-raw/prepare/prepare-hdr-real-raw-private-root.ts',
      '--source',
      sourceRoot,
      '--materialize',
      'symlink',
      ...(requireAssets ? ['--require-assets'] : []),
    ],
    { RAWENGINE_PRIVATE_RAW_ROOT: preparedRoot },
  );
  await run(
    [
      'cargo',
      'test',
      '--manifest-path',
      'src-tauri/Cargo.toml',
      '--locked',
      '--no-default-features',
      '--features',
      'required-ci,tauri-test',
      'private_alaska_raw_apply_reopen_export_when_enabled',
      '--',
      '--nocapture',
    ],
    {
      RAWENGINE_PRIVATE_RAW_ROOT: preparedRoot,
      RAWENGINE_RUN_PRIVATE_HDR_APPLY_PROOF: '1',
    },
  );
  console.log('HDR Alaska RAW apply/reopen/export proof ok');
} finally {
  await rm(preparedRoot, { force: true, recursive: true });
}

async function run(command: string[], extraEnv: Record<string, string>): Promise<void> {
  const process = Bun.spawn(command, {
    cwd: import.meta.dir.replace(/\/scripts\/proofs$/u, ''),
    env: { ...Bun.env, ...extraEnv },
    stderr: 'inherit',
    stdout: 'inherit',
  });
  const exitCode = await process.exited;
  if (exitCode !== 0) throw new Error(`${command[0]} failed with exit code ${exitCode}`);
}
