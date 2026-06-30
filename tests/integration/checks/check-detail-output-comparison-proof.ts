#!/usr/bin/env bun

import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { parseDetailOutputComparisonProofReport } from '../../../src/schemas/detailValidationSchemas.ts';
import { DETAIL_OUTPUT_COMPARISON_ARTIFACT_ROOT } from '../../../src/utils/detailOutputComparisonProof.ts';

const WIDTH = 64;
const HEIGHT = 48;
const REPORT_PATH = 'docs/validation/proofs/detail-retouch/detail-output-comparison-proof-2026-06-22.json';
const ORIGINAL_CROP_PATH = `${DETAIL_OUTPUT_COMPARISON_ARTIFACT_ROOT}/high-iso-skin-shadow-v1-original-crop.pgm`;
const CURRENT_BASELINE_CROP_PATH = `${DETAIL_OUTPUT_COMPARISON_ARTIFACT_ROOT}/high-iso-skin-shadow-v1-current-baseline.pgm`;
const RECIPE_PREVIEW_CROP_PATH = `${DETAIL_OUTPUT_COMPARISON_ARTIFACT_ROOT}/high-iso-skin-shadow-v1-recipe-preview.pgm`;
const ENABLED_EXPORT_PATH = `${DETAIL_OUTPUT_COMPARISON_ARTIFACT_ROOT}/high-iso-skin-shadow-v1-enabled-export.pgm`;
const DISABLED_EXPORT_PATH = `${DETAIL_OUTPUT_COMPARISON_ARTIFACT_ROOT}/high-iso-skin-shadow-v1-disabled-export.pgm`;
const update = process.argv.includes('--update');

const originalCrop = createHighIsoCrop(WIDTH, HEIGHT);
const currentBaselineCrop = applyCurrentBaseline(originalCrop, WIDTH, HEIGHT);
const recipePreviewCrop = applyDenoiseDetailRecipe(currentBaselineCrop, WIDTH, HEIGHT);
const enabledExport = new Float32Array(recipePreviewCrop);
const disabledExport = new Float32Array(currentBaselineCrop);

await mkdir(DETAIL_OUTPUT_COMPARISON_ARTIFACT_ROOT, { recursive: true });
await Promise.all([
  writeFile(ORIGINAL_CROP_PATH, encodePgmPreview(originalCrop, WIDTH, HEIGHT)),
  writeFile(CURRENT_BASELINE_CROP_PATH, encodePgmPreview(currentBaselineCrop, WIDTH, HEIGHT)),
  writeFile(RECIPE_PREVIEW_CROP_PATH, encodePgmPreview(recipePreviewCrop, WIDTH, HEIGHT)),
  writeFile(ENABLED_EXPORT_PATH, encodePgmPreview(enabledExport, WIDTH, HEIGHT)),
  writeFile(DISABLED_EXPORT_PATH, encodePgmPreview(disabledExport, WIDTH, HEIGHT)),
]);

const report = parseDetailOutputComparisonProofReport({
  $schema: 'https://rawengine.dev/schemas/detail-output-comparison-proof-v1.json',
  artifacts: {
    currentBaselineCrop: {
      contentHash: await sha256File(CURRENT_BASELINE_CROP_PATH),
      format: 'pgm_u8_preview',
      kind: 'current_baseline_crop',
      path: CURRENT_BASELINE_CROP_PATH,
      publicRepoAllowed: false,
    },
    disabledExportArtifact: {
      contentHash: await sha256File(DISABLED_EXPORT_PATH),
      format: 'pgm_u8_preview',
      kind: 'disabled_export_artifact',
      path: DISABLED_EXPORT_PATH,
      publicRepoAllowed: false,
    },
    enabledExportArtifact: {
      contentHash: await sha256File(ENABLED_EXPORT_PATH),
      format: 'pgm_u8_preview',
      kind: 'enabled_export_artifact',
      path: ENABLED_EXPORT_PATH,
      publicRepoAllowed: false,
    },
    originalCrop: {
      contentHash: await sha256File(ORIGINAL_CROP_PATH),
      format: 'pgm_u8_preview',
      kind: 'original_crop',
      path: ORIGINAL_CROP_PATH,
      publicRepoAllowed: false,
    },
    recipePreviewCrop: {
      contentHash: await sha256File(RECIPE_PREVIEW_CROP_PATH),
      format: 'pgm_u8_preview',
      kind: 'recipe_preview_crop',
      path: RECIPE_PREVIEW_CROP_PATH,
      publicRepoAllowed: false,
    },
  },
  crop: {
    clipped: false,
    height: HEIGHT,
    sourcePath: 'private-fixtures/detail/high-iso-skin-shadow-v1.arw',
    width: WIDTH,
    x: 512,
    y: 384,
    zoomPercent: 100,
  },
  doesNotProve: ['native_export_pipeline', 'real_raw_quality', 'tauri_app_e2e', 'user_tuned_recipe_quality'],
  fixtureId: 'detail.output.high-iso-denoise-detail-100.v1',
  generatedAt: '2026-06-22T12:00:00.000Z',
  issue: 3067,
  metrics: {
    currentToRecipeChangedPixelRatio: roundMetric(changedPixelRatio(currentBaselineCrop, recipePreviewCrop)),
    currentToRecipeMeanAbsDelta: roundMetric(meanAbsDelta(currentBaselineCrop, recipePreviewCrop)),
    disabledExportMatchesCurrentHash:
      (await sha256File(DISABLED_EXPORT_PATH)) === (await sha256File(CURRENT_BASELINE_CROP_PATH)),
    enabledExportDiffersFromDisabled:
      (await sha256File(ENABLED_EXPORT_PATH)) !== (await sha256File(DISABLED_EXPORT_PATH)),
    originalToCurrentMeanAbsDelta: roundMetric(meanAbsDelta(originalCrop, currentBaselineCrop)),
    recipeToExportMeanAbsDelta: roundMetric(meanAbsDelta(recipePreviewCrop, enabledExport)),
  },
  recipe: {
    deblurStrength: 0.7,
    detailAmount: 0.42,
    label: 'Denoise + detail 100% review',
    lumaNoiseReduction: 0.58,
    recipeId: 'detail.output.denoise-detail-100.v1',
    stages: ['scene_linear_denoise', 'capture_sharpen', 'wavelet_luma_detail'],
  },
  runtimeStatus: 'synthetic_detail_output_comparison_artifact_rendered',
  schemaVersion: 1,
  warnings: ['halo_risk_review', 'oversmoothing_review', 'crop_bounds_ok'],
});

const reportJson = `${JSON.stringify(report, null, 2)}\n`;

if (update) {
  await mkdir(dirname(REPORT_PATH), { recursive: true });
  await writeFile(REPORT_PATH, reportJson);
  console.log('detail output comparison proof updated');
  process.exit(0);
}

const committedReport = parseDetailOutputComparisonProofReport(JSON.parse(await readFile(REPORT_PATH, 'utf8')));
if (JSON.stringify(committedReport) !== JSON.stringify(report)) {
  throw new Error(
    'Detail output comparison proof is stale. Run bun tests/integration/checks/check-detail-output-comparison-proof.ts --update',
  );
}

console.log(
  `detail output comparison ok current->recipe=${report.metrics.currentToRecipeMeanAbsDelta.toFixed(6)} export=${report.artifacts.enabledExportArtifact.contentHash}`,
);

function createHighIsoCrop(width: number, height: number): Float32Array {
  const pixels = new Float32Array(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const gradient = 0.18 + (x / Math.max(1, width - 1)) * 0.52 + (y / Math.max(1, height - 1)) * 0.08;
      const edge = x > width * 0.54 ? 0.16 : 0;
      const fineDetail = Math.sin(x * 0.92) * 0.024 + Math.cos(y * 1.17) * 0.018;
      const highIsoNoise = deterministicNoise(x, y) * 0.115;
      pixels[y * width + x] = clamp01(gradient + edge + fineDetail + highIsoNoise);
    }
  }
  return pixels;
}

function applyCurrentBaseline(input: Float32Array, width: number, height: number): Float32Array {
  const output = new Float32Array(input.length);
  const blurred = boxBlur3x3(input, width, height);
  for (let index = 0; index < input.length; index += 1) {
    output[index] = clamp01(input[index] + (input[index] - blurred[index]) * 0.12);
  }
  return output;
}

function applyDenoiseDetailRecipe(input: Float32Array, width: number, height: number): Float32Array {
  const denoised = boxBlur3x3(input, width, height);
  const output = new Float32Array(input.length);
  for (let index = 0; index < input.length; index += 1) {
    const preservedDetail = input[index] - denoised[index];
    const oversmoothingGuard = Math.abs(preservedDetail) > 0.028 ? 0.54 : 0.34;
    const deblurBoost = preservedDetail * 0.7 * 0.42;
    output[index] = clamp01(denoised[index] + preservedDetail * oversmoothingGuard + deblurBoost);
  }
  const detailBase = boxBlur3x3(output, width, height);
  for (let index = 0; index < output.length; index += 1) {
    output[index] = clamp01(output[index] + (output[index] - detailBase[index]) * 0.42);
  }
  return output;
}

function boxBlur3x3(input: Float32Array, width: number, height: number): Float32Array {
  const output = new Float32Array(input.length);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let sum = 0;
      let count = 0;
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          const sx = x + dx;
          const sy = y + dy;
          if (sx < 0 || sx >= width || sy < 0 || sy >= height) continue;
          sum += input[sy * width + sx] ?? 0;
          count += 1;
        }
      }
      output[y * width + x] = sum / count;
    }
  }
  return output;
}

function changedPixelRatio(left: Float32Array, right: Float32Array): number {
  let changed = 0;
  for (let index = 0; index < left.length; index += 1) {
    if (Math.abs((left[index] ?? 0) - (right[index] ?? 0)) > 1 / 255) changed += 1;
  }
  return changed / left.length;
}

function deterministicNoise(x: number, y: number): number {
  const seed = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
  return (seed - Math.floor(seed) - 0.5) * 2;
}

function encodePgmPreview(pixels: Float32Array, width: number, height: number): string {
  const values = Array.from(pixels, (pixel) => String(Math.round(clamp01(pixel) * 255)));
  return `P2\n${width} ${height}\n255\n${values.join(' ')}\n`;
}

function meanAbsDelta(left: Float32Array, right: Float32Array): number {
  let total = 0;
  for (let index = 0; index < left.length; index += 1) {
    total += Math.abs((left[index] ?? 0) - (right[index] ?? 0));
  }
  return total / left.length;
}

function roundMetric(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

async function sha256File(path: string): Promise<string> {
  const hash = createHash('sha256');
  hash.update(await readFile(path));
  return `sha256:${hash.digest('hex')}`;
}
