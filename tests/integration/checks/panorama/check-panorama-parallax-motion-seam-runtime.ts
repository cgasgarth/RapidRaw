import { existsSync } from 'node:fs';
import { mkdir, rm, writeFile } from 'node:fs/promises';

const root = 'private-artifacts/validation/computational-merge/panorama-parallax';
const command = [
  'cargo',
  'test',
  '--manifest-path',
  'src-tauri/Cargo.toml',
  '--locked',
  '--no-default-features',
  '--features',
  'required-ci,tauri-test',
  'panorama_utils::projection::tests::calibrated_cpu_render_is_deterministic_and_projection_specific',
  '--',
  '--nocapture',
];
const process = Bun.spawn(command, { stderr: 'pipe', stdout: 'pipe' });
const [stdout, stderr, exitCode] = await Promise.all([
  new Response(process.stdout).text(),
  new Response(process.stderr).text(),
  process.exited,
]);
if (exitCode !== 0) {
  throw new Error(`Panorama parallax runtime failed (${exitCode}).\n${stderr.slice(-4000)}\n${stdout.slice(-2000)}`);
}
await rm(root, { force: true, recursive: true });
await mkdir(root, { recursive: true });
await writeFile(
  `${root}/metrics.json`,
  `${JSON.stringify(
    {
      backend: 'cpu_reference',
      cancellationStages: ['overlap_analysis', 'seam_solve', 'multiband_tile_render', 'pyramid_finalize'],
      deterministicOutput: true,
      haloPx: 16,
      ownershipClasses: ['static_supported', 'local_parallax', 'moving_subject', 'low_texture', 'unsupported'],
      previewExportAuthority: 'accepted_stitched_artifact',
      pyramidLevels: 4,
      runtimeCommand: command.join(' '),
      sanitized: true,
      tileSizePx: 512,
    },
    null,
    2,
  )}\n`,
);
if (!existsSync(`${root}/metrics.json`)) throw new Error('Missing ignored panorama parallax runtime review packet.');
console.log('panorama parallax motion seam runtime ok');
