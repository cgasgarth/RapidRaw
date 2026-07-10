const source = await Bun.file('src-tauri/src/export/export_color_policy.rs').text();

for (const required of [
  'export_rgb16_pixels_with_working_color_state',
  'export_soft_proof_rgb_pixels_with_working_color_state',
  'transform_acescg_image_to_output_rgb16',
]) {
  if (!source.includes(required)) throw new Error(`shared soft-proof/export core missing ${required}`);
}

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

if ((await process.exited) !== 0) throw new Error('soft-proof/export parity validation failed');
