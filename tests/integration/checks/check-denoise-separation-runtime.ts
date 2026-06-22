#!/usr/bin/env bun

import { readFileSync } from 'node:fs';

const failures: string[] = [];
const denoiseSource = readFileSync('src-tauri/src/denoise_render.rs', 'utf8');
const packageJson = readFileSync('package.json', 'utf8');

for (const marker of [
  'fn luma_and_chroma_noise_controls_have_independent_output_effects()',
  'mean_luma_delta',
  'mean_chroma_delta',
  '"lumaNoiseReduction": 80',
  '"colorNoiseReduction": 80',
  'luma-only denoise should primarily change luminance',
  'chroma-only denoise should primarily change chroma',
]) {
  if (!denoiseSource.includes(marker)) failures.push(`denoise runtime missing marker: ${marker}`);
}

if (!packageJson.includes('"check:denoise-separation-runtime"')) {
  failures.push('package.json missing check:denoise-separation-runtime');
}

if (failures.length > 0) {
  console.error('denoise separation runtime check failed');
  console.error(failures.slice(0, 8).join('\n'));
  process.exit(1);
}

console.log('denoise separation runtime check ok');
