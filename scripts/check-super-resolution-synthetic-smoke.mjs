#!/usr/bin/env bun

import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { z } from 'zod';

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

const nearestBaseline = new Float32Array(HIGH_WIDTH * HIGH_HEIGHT);
const referenceLowFrame = lowFrames[0];
for (let y = 0; y < HIGH_HEIGHT; y += 1) {
  for (let x = 0; x < HIGH_WIDTH; x += 1) {
    nearestBaseline[y * HIGH_WIDTH + x] = referenceLowFrame[Math.floor(y / SCALE) * LOW_WIDTH + Math.floor(x / SCALE)];
  }
}

const sr = new Float32Array(HIGH_WIDTH * HIGH_HEIGHT);
const weights = new Uint8Array(HIGH_WIDTH * HIGH_HEIGHT);
for (const [frameIndex, frame] of sourceFrames.entries()) {
  const pixels = lowFrames[frameIndex];
  for (let y = 0; y < LOW_HEIGHT; y += 1) {
    for (let x = 0; x < LOW_WIDTH; x += 1) {
      const outputX = x * SCALE + frame.shiftX;
      const outputY = y * SCALE + frame.shiftY;
      const outputIndex = outputY * HIGH_WIDTH + outputX;
      sr[outputIndex] += pixels[y * LOW_WIDTH + x] ?? 0;
      weights[outputIndex] += 1;
    }
  }
}

for (let index = 0; index < sr.length; index += 1) {
  if (weights[index] === 0) {
    throw new Error(`SR synthetic smoke left output pixel ${index} unfilled.`);
  }
  sr[index] /= weights[index];
}

const meanAbsoluteError = (left, right) => {
  let total = 0;
  for (let index = 0; index < left.length; index += 1) {
    total += Math.abs((left[index] ?? 0) - (right[index] ?? 0));
  }
  return total / left.length;
};

const changedPixelRatio = (() => {
  let changed = 0;
  for (let index = 0; index < sr.length; index += 1) {
    if (Math.abs((sr[index] ?? 0) - (nearestBaseline[index] ?? 0)) > 0.001) changed += 1;
  }
  return changed / sr.length;
})();

const baselineMae = meanAbsoluteError(nearestBaseline, truth);
const srMae = meanAbsoluteError(sr, truth);
const improvementRatio = (baselineMae - srMae) / baselineMae;

const report = SrSyntheticSmokeReportSchema.parse({
  baselineMae,
  changedPixelRatio,
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
