#!/usr/bin/env bun

import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { z } from 'zod';

import {
  applyPixelShiftSuperResolutionV1,
  calculateMeanAbsoluteErrorV1,
  createNearestNeighborBaselineV1,
} from '../../../packages/rawengine-schema/src/super-resolution/superResolutionPixelShift.ts';

const SCALE = 2;
const LOW_WIDTH = 48;
const LOW_HEIGHT = 32;
const HIGH_WIDTH = LOW_WIDTH * SCALE;
const HIGH_HEIGHT = LOW_HEIGHT * SCALE;
const MIN_CHANGED_PIXEL_RATIO = 0.35;
const MIN_BASELINE_TO_SR_IMPROVEMENT_RATIO = 0.65;
const MAX_SR_MAE = 0.01;
const OUTPUT_DIR = resolve('artifacts/super-resolution-synthetic-smoke');
const REPORT_PATH = resolve(OUTPUT_DIR, 'super-resolution-synthetic-smoke-report.json');

const SrSyntheticSmokeReportSchema = z
  .object({
    baselineMae: z.number().positive(),
    changedPixelRatio: z.number().min(0).max(1),
    fixtureId: z.literal('sr.synthetic.pixel-shift-chart.v1'),
    highResolutionDimensions: z.object({ height: z.literal(HIGH_HEIGHT), width: z.literal(HIGH_WIDTH) }).strict(),
    improvementRatio: z.number().min(0).max(1),
    outputScale: z.literal(SCALE),
    sourceFrames: z.array(z.object({ shiftX: z.number(), shiftY: z.number() }).strict()).length(4),
    srMae: z.number().nonnegative(),
  })
  .strict();

const clamp01 = (value) => Math.max(0, Math.min(1, value));

const truthAt = (x, y) => {
  const nx = x / (HIGH_WIDTH - 1);
  const ny = y / (HIGH_HEIGHT - 1);
  const slantedEdge = nx + ny * 0.42 > 0.78 ? 0.82 : 0.18;
  const linePair = (Math.floor(x / 2) + Math.floor(y / 3)) % 2 === 0 ? 0.12 : -0.08;
  const radial = Math.sin((x * x + y * y) * 0.013) * 0.05;
  return clamp01(slantedEdge + linePair + radial);
};

const sourceFrames = [
  { shiftX: 0, shiftY: 0 },
  { shiftX: 1, shiftY: 0 },
  { shiftX: 0, shiftY: 1 },
  { shiftX: 1, shiftY: 1 },
];

const truth = new Float32Array(HIGH_WIDTH * HIGH_HEIGHT);
for (let y = 0; y < HIGH_HEIGHT; y += 1) {
  for (let x = 0; x < HIGH_WIDTH; x += 1) {
    truth[y * HIGH_WIDTH + x] = truthAt(x, y);
  }
}

const lowFrames = sourceFrames.map((frame) => {
  const pixels = new Float32Array(LOW_WIDTH * LOW_HEIGHT);
  for (let y = 0; y < LOW_HEIGHT; y += 1) {
    for (let x = 0; x < LOW_WIDTH; x += 1) {
      const sourceX = x * SCALE + frame.shiftX;
      const sourceY = y * SCALE + frame.shiftY;
      pixels[y * LOW_WIDTH + x] = truth[sourceY * HIGH_WIDTH + sourceX] ?? 0;
    }
  }
  return pixels;
});

const sr = applyPixelShiftSuperResolutionV1({
  frames: sourceFrames.map((frame, frameIndex) => ({
    ...frame,
    pixels: lowFrames[frameIndex],
  })),
  height: LOW_HEIGHT,
  scale: SCALE,
  width: LOW_WIDTH,
});
const nearestBaseline = createNearestNeighborBaselineV1(lowFrames[0], LOW_WIDTH, LOW_HEIGHT, SCALE);
const baselineMae = calculateMeanAbsoluteErrorV1(nearestBaseline, truth);
const srMae = calculateMeanAbsoluteErrorV1(sr.outputPixels, truth);
const improvementRatio = (baselineMae - srMae) / baselineMae;

const report = SrSyntheticSmokeReportSchema.parse({
  baselineMae,
  changedPixelRatio: sr.changedPixelRatioAgainstNearest,
  fixtureId: 'sr.synthetic.pixel-shift-chart.v1',
  highResolutionDimensions: { height: HIGH_HEIGHT, width: HIGH_WIDTH },
  improvementRatio,
  outputScale: SCALE,
  sourceFrames,
  srMae,
});

const failures = [];
if (report.changedPixelRatio < MIN_CHANGED_PIXEL_RATIO) {
  failures.push(`changedPixelRatio ${report.changedPixelRatio.toFixed(4)} < ${MIN_CHANGED_PIXEL_RATIO}`);
}
if (report.improvementRatio < MIN_BASELINE_TO_SR_IMPROVEMENT_RATIO) {
  failures.push(`improvementRatio ${report.improvementRatio.toFixed(4)} < ${MIN_BASELINE_TO_SR_IMPROVEMENT_RATIO}`);
}
if (report.srMae > MAX_SR_MAE) {
  failures.push(`srMae ${report.srMae.toFixed(6)} > ${MAX_SR_MAE}`);
}

await mkdir(OUTPUT_DIR, { recursive: true });
await writeFile(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`);

if (failures.length > 0) {
  console.error(failures.join('\n'));
  process.exit(1);
}

console.log('SR synthetic smoke ok');
