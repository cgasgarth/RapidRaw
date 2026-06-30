#!/usr/bin/env bun

import { readFile, writeFile } from 'node:fs/promises';

import { z } from 'zod';

const PROJECTION_REPORT_PATH = 'docs/validation/proofs/panorama/panorama-projection-crop-proof-2026-06-18.json';
const REPORT_PATH = 'docs/validation/proofs/panorama/panorama-blend-exposure-proof-2026-06-18.json';
const UPDATE_REPORT = process.argv.includes('--update');
const ALGORITHM_ID = 'synthetic_feather_gain_blend_v1';
const RUNTIME_STATUS = 'blend_exposure_pixel_proof';
const leftPixels = [
  [0.2, 0.3, 0.4, 0.5],
  [0.2, 0.3, 0.4, 0.5],
];
const rightPixels = [
  [0.5, 0.5, 0.5, 0.5],
  [0.5, 0.5, 0.5, 0.5],
];

const rectangleSchema = z
  .object({ height: z.number().int(), width: z.number().int(), x: z.number().int(), y: z.number().int() })
  .strict();
const projectionReportSchema = z
  .object({
    cases: z
      .array(
        z
          .object({
            autoCrop: rectangleSchema.extend({ mode: z.literal('auto') }).strict(),
            case: z.literal('horizontal-overlap-translation'),
            provenance: z.object({ runtimeStatus: z.literal('projection_crop_metadata_proof') }).passthrough(),
          })
          .passthrough(),
      )
      .min(1),
    issue: z.literal(1887),
    schemaVersion: z.literal(1),
    validationMode: z.literal('panorama_projection_crop_metadata'),
  })
  .strict();
const reportCaseSchema = z
  .object({
    case: z.literal('overlap-feather-exposure-compensation'),
    changedPixelCount: z.number().int().positive(),
    exposureCompensation: z
      .object({
        appliedGain: z.number().positive(),
        rightMeanAfter: z.number().min(0).max(1),
        rightMeanBefore: z.number().min(0).max(1),
      })
      .strict(),
    outputHash: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
    overlap: rectangleSchema,
    provenance: z
      .object({
        algorithmId: z.literal(ALGORITHM_ID),
        artifactRisk: z.literal('synthetic_low_resolution_only'),
        projectionCropProof: z.literal(PROJECTION_REPORT_PATH),
        runtimeStatus: z.literal(RUNTIME_STATUS),
      })
      .strict(),
    seamBlend: z
      .object({
        blendMode: z.literal('feather'),
        maxDeltaFromUnblended: z.number().positive(),
        meanDeltaFromUnblended: z.number().positive(),
      })
      .strict(),
  })
  .strict();
const reportSchema = z
  .object({
    cases: z.array(reportCaseSchema).min(1),
    issue: z.literal(1888),
    schemaVersion: z.literal(1),
    validationMode: z.literal('panorama_blend_exposure_pixel_artifact'),
  })
  .strict();

const projectionReport = projectionReportSchema.parse(JSON.parse(await readFile(PROJECTION_REPORT_PATH, 'utf8')));
const projectionCase = projectionReport.cases[0];
const overlap = { height: 2, width: 2, x: 2, y: 0 };
const rightMeanBefore = mean(rightPixels.flat());
const targetOverlapMean = mean(leftPixels.flatMap((row) => row.slice(overlap.x, overlap.x + overlap.width)));
const appliedGain = targetOverlapMean / rightMeanBefore;
const compensatedRight = rightPixels.map((row) => row.map((value) => roundMetric(value * appliedGain)));
const blended = blendOverlap(leftPixels, compensatedRight, overlap);
const unblended = pasteRight(leftPixels, compensatedRight, overlap.x);
const deltas = blended.flatMap((row, y) => row.map((value, x) => Math.abs(value - unblended[y][x])));
const changedPixelCount = deltas.filter((value) => value > 0).length;

if (projectionCase.autoCrop.width <= 0 || projectionCase.autoCrop.height <= 0) {
  throw new Error('projection crop proof must provide a positive auto crop');
}
if (changedPixelCount === 0) {
  throw new Error('blend proof expected changed overlap pixels');
}

const report = reportSchema.parse({
  cases: [
    {
      case: 'overlap-feather-exposure-compensation',
      changedPixelCount,
      exposureCompensation: {
        appliedGain: roundMetric(appliedGain),
        rightMeanAfter: roundMetric(mean(compensatedRight.flat())),
        rightMeanBefore: roundMetric(rightMeanBefore),
      },
      outputHash: `sha256:${new Bun.CryptoHasher('sha256').update(JSON.stringify(blended)).digest('hex')}`,
      overlap,
      provenance: {
        algorithmId: ALGORITHM_ID,
        artifactRisk: 'synthetic_low_resolution_only',
        projectionCropProof: PROJECTION_REPORT_PATH,
        runtimeStatus: RUNTIME_STATUS,
      },
      seamBlend: {
        blendMode: 'feather',
        maxDeltaFromUnblended: roundMetric(Math.max(...deltas)),
        meanDeltaFromUnblended: roundMetric(mean(deltas)),
      },
    },
  ],
  issue: 1888,
  schemaVersion: 1,
  validationMode: 'panorama_blend_exposure_pixel_artifact',
});
const reportText = `${JSON.stringify(report, null, 2)}\n`;
if (UPDATE_REPORT) {
  await writeFile(REPORT_PATH, reportText);
} else {
  const expectedReport = reportSchema.parse(JSON.parse(await readFile(REPORT_PATH, 'utf8')));
  if (JSON.stringify(expectedReport) !== JSON.stringify(report)) {
    console.error(
      `${REPORT_PATH} is stale; run bun tests/integration/checks/check-panorama-blend-exposure.ts --update`,
    );
    process.exit(1);
  }
}

console.log(`panorama blend exposure ok (${report.cases.length} cases)`);

function blendOverlap(
  left: number[][],
  right: number[][],
  blendRegion: { height: number; width: number; x: number; y: number },
): number[][] {
  const output = pasteRight(left, right, blendRegion.x);
  for (let row = 0; row < blendRegion.height; row += 1) {
    for (let column = 0; column < blendRegion.width; column += 1) {
      const x = blendRegion.x + column;
      const leftWeight = (blendRegion.width - column) / (blendRegion.width + 1);
      const rightWeight = 1 - leftWeight;
      output[row][x] = roundMetric(left[row][x] * leftWeight + right[row][column] * rightWeight);
    }
  }
  return output;
}

function pasteRight(left: number[][], right: number[][], offsetX: number): number[][] {
  return left.map((row, y) => {
    const outputRow = [...row];
    for (let x = 0; x < right[y].length; x += 1) outputRow[offsetX + x] = right[y][x];
    return outputRow;
  });
}

function mean(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function roundMetric(value: number): number {
  return Number(value.toFixed(6));
}
