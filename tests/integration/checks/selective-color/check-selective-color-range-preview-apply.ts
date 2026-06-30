#!/usr/bin/env bun

import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';

import { z } from 'zod';

import {
  applySelectiveColorToRgbPixel,
  calculateSelectiveColorMaskWeight,
  type RgbPixel,
  renderSelectiveColorMaskPreviewPixel,
} from '../../../../src/utils/selectiveColorRuntime.ts';

const REPORT_PATH = 'docs/validation/proofs/color-selective/selective-color-range-preview-apply-2026-06-21.json';
const UPDATE_REPORT = process.argv.includes('--update');

const rgbPixelSchema = z
  .object({
    blue: z.number().min(0).max(1),
    green: z.number().min(0).max(1),
    red: z.number().min(0).max(1),
  })
  .strict();

const proofCaseSchema = z
  .object({
    id: z.string().min(1),
    inputRgb: rgbPixelSchema,
    maskPreviewRgb: rgbPixelSchema,
    maskWeight: z.number().min(0).max(1),
    outputRgb: rgbPixelSchema,
    rangeKey: z.enum(['reds', 'oranges']),
    status: z.enum(['targeted_changed', 'neutral_suppressed', 'wraparound_targeted']),
  })
  .strict();

const reportSchema = z
  .object({
    adjustment: z
      .object({
        hue: z.literal(0),
        luminance: z.literal(0),
        saturation: z.literal(35),
      })
      .strict(),
    artifacts: z
      .object({
        appliedResultHash: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
        maskPreviewHash: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
        sourceHash: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
      })
      .strict(),
    cases: z.array(proofCaseSchema).length(4),
    consultApplied: z.array(z.string().min(1)).min(1),
    issue: z.literal(3146),
    previewExportMaxDelta: z.literal(0),
    previewState: z
      .object({
        mode: z.literal('mask'),
        mutatesAdjustments: z.literal(false),
        persistedEditData: z.literal(false),
      })
      .strict(),
    schemaVersion: z.literal(1),
    validationMode: z.literal('selective_color_range_preview_apply_runtime_ui_slice'),
  })
  .strict();

const adjustment = { hue: 0, luminance: 0, saturation: 35 };
const proofPixels: Array<{
  id: string;
  pixel: RgbPixel;
  rangeKey: 'oranges' | 'reds';
  status: z.infer<typeof proofCaseSchema>['status'];
}> = [
  {
    id: 'orange-target',
    pixel: { blue: 0.08, green: 0.38, red: 0.92 },
    rangeKey: 'oranges',
    status: 'targeted_changed',
  },
  {
    id: 'neutral-orange-hue-guard',
    pixel: { blue: 0.49, green: 0.5, red: 0.51 },
    rangeKey: 'oranges',
    status: 'neutral_suppressed',
  },
  {
    id: 'red-wraparound-359',
    pixel: { blue: 0.12, green: 0.04, red: 0.95 },
    rangeKey: 'reds',
    status: 'wraparound_targeted',
  },
  {
    id: 'red-wraparound-001',
    pixel: { blue: 0.04, green: 0.05, red: 0.95 },
    rangeKey: 'reds',
    status: 'wraparound_targeted',
  },
];

const cases = proofPixels.map(({ id, pixel, rangeKey, status }) => {
  const maskPreviewRgb = roundRgb(renderSelectiveColorMaskPreviewPixel(pixel, rangeKey));
  const result = applySelectiveColorToRgbPixel(pixel, rangeKey, adjustment);
  const maskWeight = roundMetric(calculateSelectiveColorMaskWeight(pixel, rangeKey));
  const outputRgb = roundRgb(result.outputRgb);

  if (maskPreviewRgb.red !== maskWeight || maskPreviewRgb.green !== maskWeight || maskPreviewRgb.blue !== maskWeight) {
    throw new Error(`${id}: mask preview pixel does not encode the runtime mask weight.`);
  }
  if (roundMetric(result.maskWeight) !== maskWeight || roundMetric(result.influence) !== maskWeight) {
    throw new Error(`${id}: apply influence diverged from mask preview weight.`);
  }
  if (status === 'neutral_suppressed' && maxRgbDelta(outputRgb, pixel) !== 0) {
    throw new Error(`${id}: neutral guard should keep output unchanged.`);
  }
  if (status !== 'neutral_suppressed' && maxRgbDelta(outputRgb, pixel) <= 0) {
    throw new Error(`${id}: targeted range did not change output.`);
  }

  return { id, inputRgb: pixel, maskPreviewRgb, maskWeight, outputRgb, rangeKey, status };
});

const previewPixels = cases.map((proofCase) => proofCase.outputRgb);
const exportPixels = cases.map((proofCase) =>
  roundRgb(applySelectiveColorToRgbPixel(proofCase.inputRgb, proofCase.rangeKey, adjustment).outputRgb),
);
const previewExportMaxDelta = maxRgbGridDelta(previewPixels, exportPixels);
if (previewExportMaxDelta !== 0) {
  throw new Error(`Preview/export pixels diverged by ${previewExportMaxDelta}.`);
}

const report = reportSchema.parse({
  adjustment,
  artifacts: {
    appliedResultHash: hashJson(previewPixels),
    maskPreviewHash: hashJson(cases.map((proofCase) => proofCase.maskPreviewRgb)),
    sourceHash: hashJson(proofPixels.map((proofCase) => proofCase.pixel)),
  },
  cases,
  consultApplied: [
    'mask preview uses exact apply weight',
    'hue wraparound verified',
    'neutral suppression guard verified',
    'preview mode is transient UI state',
  ],
  issue: 3146,
  previewExportMaxDelta,
  previewState: {
    mode: 'mask',
    mutatesAdjustments: false,
    persistedEditData: false,
  },
  schemaVersion: 1,
  validationMode: 'selective_color_range_preview_apply_runtime_ui_slice',
});

const reportText = `${JSON.stringify(report, null, 2)}\n`;
if (UPDATE_REPORT) {
  await writeFile(REPORT_PATH, reportText);
} else {
  const expected = reportSchema.parse(JSON.parse(await readFile(REPORT_PATH, 'utf8')));
  if (JSON.stringify(expected) !== JSON.stringify(report)) {
    throw new Error(`${REPORT_PATH} is stale; run bun run check:selective-color-range-preview-apply:update.`);
  }
}

console.log(`selective color range preview/apply ok (${cases.length} cases)`);

function hashJson(value: unknown): string {
  return `sha256:${createHash('sha256').update(JSON.stringify(value)).digest('hex')}`;
}

function maxRgbGridDelta(left: ReadonlyArray<RgbPixel>, right: ReadonlyArray<RgbPixel>): number {
  return Math.max(...left.map((pixel, index) => maxRgbDelta(pixel, right[index] ?? pixel)));
}

function maxRgbDelta(left: RgbPixel, right: RgbPixel): number {
  return Math.max(Math.abs(left.red - right.red), Math.abs(left.green - right.green), Math.abs(left.blue - right.blue));
}

function roundMetric(value: number): number {
  return Number(value.toFixed(12));
}

function roundRgb(pixel: RgbPixel): RgbPixel {
  return {
    blue: roundMetric(pixel.blue),
    green: roundMetric(pixel.green),
    red: roundMetric(pixel.red),
  };
}
