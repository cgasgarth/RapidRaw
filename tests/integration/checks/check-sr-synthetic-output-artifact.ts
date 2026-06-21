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
    issue: z.literal(2314),
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

const report = reportSchema.parse({
  artifacts: {
    baselineReviewCrop: {
      contentHash: await sha256File(BASELINE_CROP_PATH),
      format: 'pgm_u8_preview',
      path: BASELINE_CROP_PATH,
      publicRepoAllowed: false,
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
  doesNotProve: [
    'app_ui_e2e',
    'demosaic_aware_detail_quality',
    'motion_robustness',
    'real_raw_burst_decode',
    'tiff_export_pipeline',
  ],
  fixtureId: 'sr.synthetic.public.pixel-shift-output.v1',
  generatedAt: '2026-06-20T09:45:00.000Z',
  issue: 2314,
  metrics: {
    changedPixelRatioAgainstNearest: roundMetric(result.changedPixelRatioAgainstNearest),
    filledPixelRatio: result.reconstructionDiagnostics.filledPixelRatio,
    finiteOutputRatio: result.reconstructionDiagnostics.finiteOutputRatio,
    meanAbsoluteErrorAgainstNearest: roundMetric(calculateMeanAbsoluteErrorV1(result.outputPixels, nearest)),
    missingPixelCount: result.reconstructionDiagnostics.missingPixelCount,
    reviewCropMeanAbsoluteDelta: roundMetric(calculateMeanAbsoluteErrorV1(reviewCrop.pixels, baselineCrop.pixels)),
  },
  reconstructionDiagnostics: result.reconstructionDiagnostics,
  runtimeStatus: 'synthetic_sr_output_artifact_rendered',
  schemaVersion: 1,
  sourceBurst: {
    frameCount: 4,
    height: HEIGHT,
    scale: SCALE,
    sourceBurstHash: hashFloat32(source, ...frames.map((frame) => frame.pixels)),
    width: WIDTH,
  },
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
