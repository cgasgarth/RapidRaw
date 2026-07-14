#!/usr/bin/env bun

const result = Bun.spawnSync(
  [
    'cargo',
    'test',
    '--locked',
    '--no-default-features',
    '--features',
    'required-ci',
    '--lib',
    'negative_lab_conversion_bundle_records_runtime_outputs',
  ],
  {
    cwd: 'src-tauri',
    stderr: 'pipe',
    stdout: 'pipe',
  },
);

if (!result.success) {
  const output = [new TextDecoder().decode(result.stdout), new TextDecoder().decode(result.stderr)]
    .join('\n')
    .split('\n')
    .filter(Boolean)
    .slice(-30)
    .join('\n');
  throw new Error(`Native Negative Lab conversion bundle proof failed:\n${output}`);
}

console.log('native Negative Lab conversion bundle runtime proof passed');
