#!/usr/bin/env bun

const command = [
  'cargo',
  'test',
  '--quiet',
  '--locked',
  '--no-default-features',
  '--features',
  'required-ci',
  'panorama_boundary_transparent_',
  '--',
  '--nocapture',
];

const result = Bun.spawnSync(command, {
  cwd: 'src-tauri',
  stderr: 'pipe',
  stdout: 'pipe',
});

if (result.exitCode !== 0) {
  const stdout = Buffer.from(result.stdout).toString('utf8').trim();
  const stderr = Buffer.from(result.stderr).toString('utf8').trim();
  console.error('panorama transparent boundary runtime check failed');
  if (stdout.length > 0) console.error(stdout);
  if (stderr.length > 0) console.error(stderr);
  process.exit(result.exitCode);
}

console.log('panorama transparent boundary runtime ok');
