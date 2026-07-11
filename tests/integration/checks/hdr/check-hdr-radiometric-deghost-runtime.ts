#!/usr/bin/env bun

const result = Bun.spawnSync({
  cmd: [
    'cargo',
    'test',
    '--manifest-path',
    'src-tauri/Cargo.toml',
    '--locked',
    '--no-default-features',
    '--features',
    'required-ci,tauri-test',
    'merge::hdr::runtime::tests',
    '--',
    '--nocapture',
  ],
  stderr: 'inherit',
  stdout: 'inherit',
});
if (result.exitCode !== 0) process.exit(result.exitCode);
console.log(
  'HDR radiometric/deghost runtime ok (decoded color, radiance error, highlight recovery, masks, determinism, cancellation)',
);
