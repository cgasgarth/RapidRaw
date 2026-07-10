#!/usr/bin/env bun

import { existsSync, readdirSync } from 'node:fs';
import { extname, join } from 'node:path';

const requireAssets = process.argv.includes('--require-assets');
const root = process.env.RAWENGINE_PRIVATE_RAW_ROOT;
if (!root || !existsSync(root)) {
  if (requireAssets) throw new Error('RAWENGINE_PRIVATE_RAW_ROOT is required and must exist.');
  console.log('HDR native private proof skipped (no private RAW root).');
  process.exit(0);
}

const rawExtensions = new Set(['.arw', '.cr2', '.cr3', '.dng', '.nef', '.raf']);
const pending = [root];
let assetCount = 0;
while (pending.length > 0) {
  const directory = pending.pop();
  if (!directory) break;
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) pending.push(path);
    else if (rawExtensions.has(extname(entry.name).toLowerCase())) assetCount += 1;
  }
}
if (assetCount === 0) throw new Error('Private RAW root contains no supported RAW assets.');

const processResult = Bun.spawnSync({
  cmd: [
    'cargo',
    'test',
    '--manifest-path',
    'src-tauri/Cargo.toml',
    '--locked',
    '--no-default-features',
    '--features',
    'required-ci,tauri-test',
    'hdr::source_frame::tests::private_raw_uses_sensor_decode_and_fails_closed',
    '--',
    '--nocapture',
  ],
  env: { ...process.env, RAWENGINE_PRIVATE_RAW_ROOT: root },
  stderr: 'inherit',
  stdout: 'inherit',
});
if (processResult.exitCode !== 0) process.exit(processResult.exitCode);
console.log(`HDR native private proof ok (${assetCount} private RAW assets available; paths withheld).`);
