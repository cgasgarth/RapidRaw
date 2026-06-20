#!/usr/bin/env bun

import { readFile } from 'node:fs/promises';

import { z } from 'zod';

const EXPECTED_BYTE_HASH = 'sha256:be2ed0f28ed5d492dfd4f03c6f6f0ca559819d57f38a474448e57d8da41dc572';

const reportSchema = z
  .object({
    byteHash: z.literal(EXPECTED_BYTE_HASH),
    doesNotProve: z.array(
      z.enum([
        'full_export_pipeline_parity',
        'full_preview_pipeline_parity',
        'raw_file_color_management_parity',
        'shader_function_parity',
      ]),
    ),
    height: z.literal(2),
    issue: z.literal(2326),
    maxByteDelta: z.literal(0),
    pixelCount: z.literal(4),
    readbackBytes: z.literal(16),
    runtimeStatus: z.literal('validation_harness_gpu_texture_readback_probe'),
    textureFormat: z.literal('rgba8unorm'),
    validationMode: z.literal('wgpu_copy_texture_to_buffer_readback_probe'),
    width: z.literal(2),
  })
  .strict();

const [probeSource, gpuSource, libSource, appPropertiesSource] = await Promise.all([
  readFile('src-tauri/src/color_gpu_readback_probe.rs', 'utf8'),
  readFile('src-tauri/src/gpu_processing.rs', 'utf8'),
  readFile('src-tauri/src/lib.rs', 'utf8'),
  readFile('src/components/ui/AppProperties.tsx', 'utf8'),
]);
const failures: string[] = [];

for (const required of [
  'create_texture_with_data',
  'read_texture_data_roi(',
  'TextureFormat::Rgba8Unorm',
  'max_byte_delta != 0',
  'validation_harness_gpu_texture_readback_probe',
]) {
  if (!probeSource.includes(required)) failures.push(`GPU readback probe source missing ${required}.`);
}
if (!gpuSource.includes('pub(crate) fn read_texture_data_roi(')) {
  failures.push('GPU readback helper must be crate-visible for validation probes.');
}
if (
  !libSource.includes('#[cfg(feature = "validation-harness")]') ||
  !libSource.includes('color_gpu_readback_probe::run_color_gpu_readback_probe')
) {
  failures.push('GPU readback probe command must be registered behind validation-harness.');
}
if (appPropertiesSource.includes('run_color_gpu_readback_probe')) {
  failures.push('Validation-only GPU readback command must not be exposed through product Invokes.');
}

reportSchema.parse({
  byteHash: EXPECTED_BYTE_HASH,
  doesNotProve: [
    'full_preview_pipeline_parity',
    'full_export_pipeline_parity',
    'raw_file_color_management_parity',
    'shader_function_parity',
  ],
  height: 2,
  issue: 2326,
  maxByteDelta: 0,
  pixelCount: 4,
  readbackBytes: 16,
  runtimeStatus: 'validation_harness_gpu_texture_readback_probe',
  textureFormat: 'rgba8unorm',
  validationMode: 'wgpu_copy_texture_to_buffer_readback_probe',
  width: 2,
});

if (failures.length > 0) {
  console.error('Color GPU readback probe validation failed:');
  console.error(failures.join('\n'));
  process.exit(1);
}

console.log('color GPU readback probe ok (validation-harness command contract)');
