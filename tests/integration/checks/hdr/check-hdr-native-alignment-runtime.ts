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
    'merge::hdr',
    '--',
    '--nocapture',
  ],
  stderr: 'inherit',
  stdout: 'inherit',
});
if (result.exitCode !== 0) process.exit(result.exitCode);
console.log('HDR native alignment runtime ok (determinism, reference, transform, cancellation, compatibility)');
