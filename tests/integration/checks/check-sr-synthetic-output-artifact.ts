#!/usr/bin/env bun

import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

import { z } from 'zod';

import {
  applyPixelShiftSuperResolutionV1,
  createNearestNeighborBaselineV1,
  calculateMeanAbsoluteErrorV1,
} from '../../../packages/rawengine-schema/src/superResolutionPixelShift.ts';
import { superResolutionReconstructionDiagnosticsV1Schema } from '../../../packages/rawengine-schema/src/superResolutionReconstructionDiagnostics.ts';
import { superResolutionSyntheticReviewArtifacts } from '../../../src/utils/superResolutionOutputReview.ts';

const WIDTH = 48;
const HEIGHT = 36;
const SCALE = 2;
const REPORT_PATH = 'docs/validation/sr-synthetic-output-artifact-proof-2026-06-20.json';
const OUTPUT_PATH = 'artifacts/validation/sr-synthetic-output-artifact/sr-x2-preview.pgm';
const REVIEW_CROP_PATH = 'artifacts/validation/sr-synthetic-output-artifact/sr-x2-review-crop-center.pgm';
const BASELINE_CROP_PATH = 'artifacts/validation/sr-synthetic-output-artifact/sr-x2-baseline-crop-center.pgm';
const CROP_REVIEW_SHEET_PATH = 'artifacts/validation/sr-synthetic-output-artifact/sr-x2-crop-review-sheet.html';
const update = process.argv.includes('--update');

const hashSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/u);
const reportSchema = z
  .object({
    artifacts: z
      .object({
        baselineReviewCrop: z
          .object({
            contentHash: hashSchema,
            format: z.literal('pgm_u8_preview'),
            path: z.literal(BASELINE_CROP_PATH),
            publicRepoAllowed: z.literal(false),
          })
          .strict(),
        cropReviewSheet: z
          .object({
            contentHash: hashSchema,
            format: z.literal('html_inline_review_sheet'),
            path: z.literal(CROP_REVIEW_SHEET_PATH),
            publicRepoAllowed: z.literal(false),
            scaleViews: z.tuple([z.literal(100), z.literal(200)]),
          })
          .strict(),
        reconstructionPreview: z
          .object({
            contentHash: hashSchema,
            format: z.literal('pgm_u8_preview'),
            path: z.literal(OUTPUT_PATH),
            publicRepoAllowed: z.literal(false),
          })
          .strict(),
        reconstructionReviewCrop: z
          .object({
            contentHash: hashSchema,
            format: z.literal('pgm_u8_preview'),
            path: z.literal(REVIEW_CROP_PATH),
            publicRepoAllowed: z.literal(false),
          })
          .strict(),
      })
      .strict(),
    conservativeOutputPolicy: z
      .object({
        detailPolicy: z.literal('conservative'),
        falseDetailPolicy: z.literal('human_review_required'),
        outputScale: z.literal(SCALE),
        qualityPreference: z.literal('best'),
      })
      .strict(),
    doesNotProve: z.array(
      z.enum([
        'app_ui_e2e',
        'demosaic_aware_detail_quality',
        'motion_robustness',
        'real_raw_burst_decode',
        'tiff_export_pipeline',
      ]),
    ),
    fixtureId: z.literal('sr.synthetic.public.pixel-shift-output.v1'),
    generatedAt: z.iso.datetime({ offset: true }),
    issue: z.literal(2980),
    metrics: z
      .object({
        changedPixelRatioAgainstNearest: z.number().gt(0.1),
        filledPixelRatio: z.literal(1),
        finiteOutputRatio: z.literal(1),
        meanAbsoluteErrorAgainstNearest: z.number().gt(0.01),
        missingPixelCount: z.literal(0),
        reviewCropMeanAbsoluteDelta: z.number().gt(0.01),
      })
      .strict(),
    reconstructionDiagnostics: superResolutionReconstructionDiagnosticsV1Schema,
    reviewMetadata: z
      .object({
        artifactCount: z.literal(4),
        baselineReviewCropPath: z.literal(BASELINE_CROP_PATH),
        cropReviewSheetPath: z.literal(CROP_REVIEW_SHEET_PATH),
        reconstructionPreviewPath: z.literal(OUTPUT_PATH),
        reconstructionReviewCropPath: z.literal(REVIEW_CROP_PATH),
      })
      .strict(),
    runtimeStatus: z.literal('synthetic_sr_output_artifact_rendered'),
    schemaVersion: z.literal(1),
    sourceBurst: z
      .object({
        frameCount: z.literal(4),
        height: z.literal(HEIGHT),
        scale: z.literal(SCALE),
        sourceBurstHash: hashSchema,
        width: z.literal(WIDTH),
      })
      .strict(),
    sourceFrames: z
      .array(
        z
          .object({
            contentHash: hashSchema,
            imagePath: z.string().trim().min(1),
            publicRepoAllowed: z.literal(true),
            shiftX: z.number().int().nonnegative(),
            shiftY: z.number().int().nonnegative(),
            sourceIndex: z.number().int().nonnegative(),
          })
          .strict(),
      )
      .length(4),
  })
  .strict();

const source = createSource(WIDTH, HEIGHT);
const frames = [
  { shiftX: 0, shiftY: 0 },
  { shiftX: 1, shiftY: 0 },
  { shiftX: 0, shiftY: 1 },
  { shiftX: 1, shiftY: 1 },
].map((shift) => ({
  ...shift,
  pixels: sampleShiftedSource(source, WIDTH, HEIGHT, shift.shiftX, shift.shiftY),
}));
const result = applyPixelShiftSuperResolutionV1({
  frames,
  height: HEIGHT,
  scale: SCALE,
  width: WIDTH,
});
const nearest = createNearestNeighborBaselineV1(frames[0]?.pixels ?? source, WIDTH, HEIGHT, SCALE);
const reviewCrop = cropCenter(result.outputPixels, result.outputWidth, result.outputHeight, 24, 18);
const baselineCrop = cropCenter(nearest, result.outputWidth, result.outputHeight, 24, 18);
await mkdir(dirname(OUTPUT_PATH), { recursive: true });
await writeFile(OUTPUT_PATH, encodePgmPreview(result.outputPixels, result.outputWidth, result.outputHeight));
await writeFile(REVIEW_CROP_PATH, encodePgmPreview(reviewCrop.pixels, reviewCrop.width, reviewCrop.height));
await writeFile(BASELINE_CROP_PATH, encodePgmPreview(baselineCrop.pixels, baselineCrop.width, baselineCrop.height));
await writeFile(
  CROP_REVIEW_SHEET_PATH,
  encodeCropReviewSheet({
    baselineCrop: baselineCrop.pixels,
    height: reviewCrop.height,
    reconstructionCrop: reviewCrop.pixels,
    sourceCrop: cropCenter(frames[0]?.pixels ?? source, WIDTH, HEIGHT, 24, 18).pixels,
    width: reviewCrop.width,
  }),
);

const report = reportSchema.parse({
  artifacts: {
    baselineReviewCrop: {
      contentHash: await sha256File(BASELINE_CROP_PATH),
      format: 'pgm_u8_preview',
      path: BASELINE_CROP_PATH,
      publicRepoAllowed: false,
    },
    cropReviewSheet: {
      contentHash: await sha256File(CROP_REVIEW_SHEET_PATH),
      format: 'html_inline_review_sheet',
      path: CROP_REVIEW_SHEET_PATH,
      publicRepoAllowed: false,
      scaleViews: [100, 200],
    },
    reconstructionPreview: {
      contentHash: await sha256File(OUTPUT_PATH),
      format: 'pgm_u8_preview',
      path: OUTPUT_PATH,
      publicRepoAllowed: false,
    },
    reconstructionReviewCrop: {
      contentHash: await sha256File(REVIEW_CROP_PATH),
      format: 'pgm_u8_preview',
      path: REVIEW_CROP_PATH,
      publicRepoAllowed: false,
    },
  },
  conservativeOutputPolicy: {
    detailPolicy: 'conservative',
    falseDetailPolicy: 'human_review_required',
    outputScale: SCALE,
    qualityPreference: 'best',
  },
  doesNotProve: [
    'app_ui_e2e',
    'demosaic_aware_detail_quality',
    'motion_robustness',
    'real_raw_burst_decode',
    'tiff_export_pipeline',
  ],
  fixtureId: 'sr.synthetic.public.pixel-shift-output.v1',
  generatedAt: '2026-06-20T09:45:00.000Z',
  issue: 2980,
  metrics: {
    changedPixelRatioAgainstNearest: roundMetric(result.changedPixelRatioAgainstNearest),
    filledPixelRatio: result.reconstructionDiagnostics.filledPixelRatio,
    finiteOutputRatio: result.reconstructionDiagnostics.finiteOutputRatio,
    meanAbsoluteErrorAgainstNearest: roundMetric(calculateMeanAbsoluteErrorV1(result.outputPixels, nearest)),
    missingPixelCount: result.reconstructionDiagnostics.missingPixelCount,
    reviewCropMeanAbsoluteDelta: roundMetric(calculateMeanAbsoluteErrorV1(reviewCrop.pixels, baselineCrop.pixels)),
  },
  reconstructionDiagnostics: result.reconstructionDiagnostics,
  reviewMetadata: {
    artifactCount: 4,
    baselineReviewCropPath: BASELINE_CROP_PATH,
    cropReviewSheetPath: CROP_REVIEW_SHEET_PATH,
    reconstructionPreviewPath: OUTPUT_PATH,
    reconstructionReviewCropPath: REVIEW_CROP_PATH,
  },
  runtimeStatus: 'synthetic_sr_output_artifact_rendered',
  schemaVersion: 1,
  sourceBurst: {
    frameCount: 4,
    height: HEIGHT,
    scale: SCALE,
    sourceBurstHash: hashFloat32(source, ...frames.map((frame) => frame.pixels)),
    width: WIDTH,
  },
  sourceFrames: await Promise.all(
    frames.map(async (frame, sourceIndex) => ({
      contentHash: hashFloat32(frame.pixels),
      imagePath: `/synthetic/sr/conservative-output-proof-${sourceIndex}.dng`,
      publicRepoAllowed: true,
      shiftX: frame.shiftX,
      shiftY: frame.shiftY,
      sourceIndex,
    })),
  ),
});
const reportJson = `${JSON.stringify(report, null, 2)}\n`;

if (update) {
  await writeFile(REPORT_PATH, reportJson);
  console.log('sr synthetic output artifact proof updated');
  process.exit(0);
}

const committedReport = reportSchema.parse(JSON.parse(await readFile(REPORT_PATH, 'utf8')));
if (JSON.stringify(committedReport) !== JSON.stringify(report)) {
  throw new Error(
    'SR synthetic output artifact proof is stale. Run bun tests/integration/checks/check-sr-synthetic-output-artifact.ts --update',
  );
}
const expectedReviewArtifacts = [
  {
    contentHash: committedReport.artifacts.reconstructionPreview.contentHash,
    kind: 'reconstruction_preview',
    path: committedReport.artifacts.reconstructionPreview.path,
    publicRepoAllowed: false,
  },
  {
    contentHash: committedReport.artifacts.reconstructionReviewCrop.contentHash,
    kind: 'reconstruction_review_crop',
    path: committedReport.artifacts.reconstructionReviewCrop.path,
    publicRepoAllowed: false,
  },
  {
    contentHash: committedReport.artifacts.baselineReviewCrop.contentHash,
    kind: 'baseline_review_crop',
    path: committedReport.artifacts.baselineReviewCrop.path,
    publicRepoAllowed: false,
  },
  {
    contentHash: committedReport.artifacts.cropReviewSheet.contentHash,
    kind: 'crop_review_sheet',
    path: committedReport.artifacts.cropReviewSheet.path,
    publicRepoAllowed: false,
  },
];
if (JSON.stringify(superResolutionSyntheticReviewArtifacts) !== JSON.stringify(expectedReviewArtifacts)) {
  throw new Error('SR synthetic review artifact metadata does not match the committed proof report.');
}

console.log(`sr synthetic output artifact ok (${report.artifacts.reconstructionPreview.contentHash})`);

function createSource(width: number, height: number): Float32Array {
  const pixels = new Float32Array(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const gradient = 0.1 + x / (width * 3) + y / (height * 4);
      const detail = ((x * 3 + y * 5) % 11) / 40;
      pixels[y * width + x] = Math.min(1, gradient + detail);
    }
  }
  return pixels;
}

function sampleShiftedSource(
  source: Float32Array,
  width: number,
  height: number,
  shiftX: number,
  shiftY: number,
): Float32Array {
  const pixels = new Float32Array(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const sourceX = Math.min(width - 1, x + shiftX);
      const sourceY = Math.min(height - 1, y + shiftY);
      pixels[y * width + x] = source[sourceY * width + sourceX] ?? 0;
    }
  }
  return pixels;
}

function encodePgmPreview(values: Float32Array, width: number, height: number): Uint8Array {
  const header = new TextEncoder().encode(`P5\n${width} ${height}\n255\n`);
  const pixels = new Uint8Array(values.length);
  for (let index = 0; index < values.length; index += 1) {
    pixels[index] = Math.round(Math.max(0, Math.min(1, values[index] ?? 0)) * 255);
  }
  const output = new Uint8Array(header.length + pixels.length);
  output.set(header, 0);
  output.set(pixels, header.length);
  return output;
}

function cropCenter(values: Float32Array, width: number, height: number, cropWidth: number, cropHeight: number) {
  const x0 = Math.floor((width - cropWidth) / 2);
  const y0 = Math.floor((height - cropHeight) / 2);
  const pixels = new Float32Array(cropWidth * cropHeight);
  for (let y = 0; y < cropHeight; y += 1) {
    for (let x = 0; x < cropWidth; x += 1) {
      pixels[y * cropWidth + x] = values[(y0 + y) * width + x0 + x] ?? 0;
    }
  }
  return { height: cropHeight, pixels, width: cropWidth };
}

function encodeCropReviewSheet({
  baselineCrop,
  height,
  reconstructionCrop,
  sourceCrop,
  width,
}: {
  baselineCrop: Float32Array;
  height: number;
  reconstructionCrop: Float32Array;
  sourceCrop: Float32Array;
  width: number;
}): string {
  const panels = [
    ['Source 100%', sourceCrop, 1],
    ['Baseline 100%', baselineCrop, 1],
    ['SR 100%', reconstructionCrop, 1],
    ['Source 200%', sourceCrop, 2],
    ['Baseline 200%', baselineCrop, 2],
    ['SR 200%', reconstructionCrop, 2],
  ] as const;
  return `<!doctype html>
<html lang="en">
<meta charset="utf-8">
<title>SR crop review sheet</title>
<style>
body{margin:16px;background:#111;color:#eee;font:12px system-ui,sans-serif}
.grid{display:grid;grid-template-columns:repeat(3,max-content);gap:14px}
.panel{border:1px solid #444;padding:8px;background:#181818}
.pixels{display:grid;image-rendering:pixelated}
.px{width:4px;height:4px}
.x2 .px{width:8px;height:8px}
</style>
<h1>Super-resolution crop review</h1>
<p>100% and 200% views compare source, nearest-neighbor baseline, and reconstructed SR output for false-detail review.</p>
<div class="grid">
${panels
  .map(
    ([label, pixels, scale]) => `<section class="panel">
<h2>${label}</h2>
<div class="pixels ${scale === 2 ? 'x2' : ''}" style="grid-template-columns:repeat(${width},max-content)">
${Array.from(pixels)
  .map(
    (value) =>
      `<span class="px" style="background:rgb(${formatGray(value)} ${formatGray(value)} ${formatGray(value)})"></span>`,
  )
  .join('')}
</div>
<p>${width}x${height} crop at ${scale * 100}% view</p>
</section>`,
  )
  .join('\n')}
</div>
</html>
`;
}

function formatGray(value: number): number {
  return Math.round(Math.max(0, Math.min(1, value)) * 255);
}

async function sha256File(path: string): Promise<string> {
  return `sha256:${createHash('sha256')
    .update(await readFile(path))
    .digest('hex')}`;
}

function hashFloat32(...arrays: Float32Array[]): string {
  const hash = createHash('sha256');
  for (const array of arrays) hash.update(Buffer.from(array.buffer));
  return `sha256:${hash.digest('hex')}`;
}

function roundMetric(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}
