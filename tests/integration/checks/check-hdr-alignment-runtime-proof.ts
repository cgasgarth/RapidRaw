#!/usr/bin/env bun

import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

import { format, resolveConfig } from 'prettier';
import { z } from 'zod';

import { estimateHdrAlignmentTransformsV1 } from '../../../packages/rawengine-schema/src/hdrAlignmentRuntime.ts';

const REPORT_PATH = 'artifacts/validation/hdr-alignment-runtime-proof-2026-06-20.json';
const GENERATED_AT = '2026-06-20T00:00:00.000Z';
const WIDTH = 64;
const HEIGHT = 48;
const SEARCH_RADIUS = 5;
const MIN_CONFIDENCE = 0.99;
const MIN_OVERLAP_RATIO = 0.75;
const MAX_RMS_ERROR = 0.000001;

const transformSchema = z
  .object({
    confidence: z.number().min(MIN_CONFIDENCE).max(1),
    expectedTranslationPx: z.object({ x: z.number().int(), y: z.number().int() }).strict(),
    overlapRatio: z.number().min(MIN_OVERLAP_RATIO).max(1),
    rmsError: z.number().min(0).max(MAX_RMS_ERROR),
    sourceIndex: z.number().int().nonnegative(),
    transformType: z.enum(['identity', 'translation']),
    translationPx: z.object({ x: z.number().int(), y: z.number().int() }).strict(),
  })
  .strict();

const reportSchema = z
  .object({
    alignmentConfidence: z.number().min(MIN_CONFIDENCE).max(1),
    doesNotProve: z.array(z.enum(['homography_alignment', 'real_raw_e2e', 'moving_subject_deghost_quality'])).min(1),
    generatedAt: z.iso.datetime({ offset: true }),
    issue: z.literal(2349),
    outputHash: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
    referenceSourceIndex: z.literal(1),
    schemaVersion: z.literal(1),
    searchRadiusPx: z.literal(SEARCH_RADIUS),
    transforms: z.array(transformSchema).length(3),
    validationMode: z.literal('synthetic_hdr_translation_alignment_runtime'),
  })
  .strict();

const update = process.argv.includes('--update');
const baseImage = createSyntheticHdrReference();
const sources = [
  { label: 'under_exposed_shifted_right_up', shift: { x: 2, y: -1 }, sourceIndex: 0 },
  { label: 'reference', shift: { x: 0, y: 0 }, sourceIndex: 1 },
  { label: 'over_exposed_shifted_left_down', shift: { x: -3, y: 2 }, sourceIndex: 2 },
].map((source) => ({
  ...source,
  pixels: shiftImage(baseImage, source.shift.x, source.shift.y),
}));

const alignment = estimateHdrAlignmentTransformsV1({
  frames: sources.map((source) => ({
    height: HEIGHT,
    pixels: source.pixels,
    sourceIndex: source.sourceIndex,
    width: WIDTH,
  })),
  referenceSourceIndex: 1,
  searchRadiusPx: SEARCH_RADIUS,
});

const transforms = alignment.transforms.map((transform) => {
  const source = sources.find((candidate) => candidate.sourceIndex === transform.sourceIndex);
  if (source === undefined) throw new Error(`Missing HDR alignment source ${transform.sourceIndex}.`);
  return transformSchema.parse({
    confidence: transform.confidence,
    expectedTranslationPx: { x: -source.shift.x, y: -source.shift.y },
    overlapRatio: transform.overlapRatio,
    rmsError: transform.rmsError,
    sourceIndex: transform.sourceIndex,
    transformType: transform.transformType,
    translationPx: transform.translationPx,
  });
});
for (const transform of transforms) {
  if (
    transform.translationPx.x !== transform.expectedTranslationPx.x ||
    transform.translationPx.y !== transform.expectedTranslationPx.y
  ) {
    throw new Error(`HDR alignment transform mismatch for source ${transform.sourceIndex}.`);
  }
}

const report = reportSchema.parse({
  alignmentConfidence: alignment.alignmentConfidence,
  doesNotProve: ['homography_alignment', 'real_raw_e2e', 'moving_subject_deghost_quality'],
  generatedAt: GENERATED_AT,
  issue: 2349,
  outputHash: hashJson({ referenceSourceIndex: alignment.referenceSourceIndex, transforms }),
  referenceSourceIndex: alignment.referenceSourceIndex,
  schemaVersion: 1,
  searchRadiusPx: alignment.searchRadiusPx,
  transforms,
  validationMode: 'synthetic_hdr_translation_alignment_runtime',
});
const reportJson = await format(JSON.stringify(report), {
  ...((await resolveConfig('package.json')) ?? {}),
  parser: 'json',
});

if (update) {
  await mkdir(dirname(REPORT_PATH), { recursive: true });
  await writeFile(REPORT_PATH, reportJson);
  console.log(`hdr alignment runtime proof artifact wrote ${REPORT_PATH}`);
  process.exit(0);
}

console.log(`hdr alignment runtime proof ok (${report.transforms.length} transforms)`);

function createSyntheticHdrReference(): Float64Array {
  const image = new Float64Array(WIDTH * HEIGHT);
  for (let y = 0; y < HEIGHT; y += 1) {
    for (let x = 0; x < WIDTH; x += 1) {
      const gradient = x / WIDTH + y / HEIGHT;
      const verticalStripe = x % 11 === 0 ? 0.7 : 0;
      const horizontalStripe = y % 13 === 0 ? 0.5 : 0;
      const target = isInsideCircle(x, y, 19, 17, 7) || isInsideCircle(x, y, 43, 31, 5) ? 1.2 : 0;
      image[getPixelIndex(x, y)] = gradient + verticalStripe + horizontalStripe + target;
    }
  }
  return image;
}

function shiftImage(image: Float64Array, shiftX: number, shiftY: number): Float64Array {
  const shifted = new Float64Array(WIDTH * HEIGHT);
  for (let y = 0; y < HEIGHT; y += 1) {
    for (let x = 0; x < WIDTH; x += 1) {
      const sourceX = x - shiftX;
      const sourceY = y - shiftY;
      if (isInsideImage(sourceX, sourceY)) {
        shifted[getPixelIndex(x, y)] = image[getPixelIndex(sourceX, sourceY)] ?? 0;
      }
    }
  }
  return shifted;
}

function isInsideCircle(x: number, y: number, centerX: number, centerY: number, radius: number): boolean {
  return (x - centerX) * (x - centerX) + (y - centerY) * (y - centerY) <= radius * radius;
}

function isInsideImage(x: number, y: number): boolean {
  return Number.isInteger(x) && Number.isInteger(y) && x >= 0 && x < WIDTH && y >= 0 && y < HEIGHT;
}

function getPixelIndex(x: number, y: number): number {
  return y * WIDTH + x;
}

function hashJson(value: unknown): string {
  return `sha256:${createHash('sha256').update(JSON.stringify(value)).digest('hex')}`;
}
