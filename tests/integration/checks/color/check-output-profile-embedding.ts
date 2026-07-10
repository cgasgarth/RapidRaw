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
    'typed_ap1_soft_proof_and_real_outputs_share_pixels',
    '--',
    '--nocapture',
  ],
  { stderr: 'inherit', stdout: 'inherit' },
);

if ((await process.exited) !== 0) throw new Error('JPEG/TIFF ICC embedding validation failed');
