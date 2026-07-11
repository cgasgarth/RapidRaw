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
    'merge::focus_stack',
    '--',
    '--nocapture',
  ],
  stderr: 'inherit',
  stdout: 'inherit',
});
if (result.exitCode !== 0) process.exit(result.exitCode);
console.log('Focus native source plan ok (file decode, 3/12/64, determinism, staleness, compatibility, cancellation)');
