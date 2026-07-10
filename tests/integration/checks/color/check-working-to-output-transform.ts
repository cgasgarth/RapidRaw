const process = Bun.spawn(
  [
    'cargo',
    'test',
    '--manifest-path',
    'src-tauri/Cargo.toml',
    '--locked',
    '--no-default-features',
    '--features',
    'required-ci',
    'working_to_output_transform',
    '--',
    '--nocapture',
  ],
  { stderr: 'inherit', stdout: 'inherit' },
);

if ((await process.exited) !== 0) throw new Error('working-to-output transform validation failed');
