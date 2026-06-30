#!/usr/bin/env bun

import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

import { z } from 'zod';

import { applyWeightedSharpnessFocusStackV1 } from '../../../packages/rawengine-schema/src/focus-stack/focusStackWeightedBlend.ts';

const WIDTH = 96;
const HEIGHT = 64;
const REPORT_PATH = 'docs/validation/proofs/focus/focus-synthetic-output-artifact-proof-2026-06-20.json';
const OUTPUT_PATH = 'artifacts/validation/focus-synthetic-output-artifact/focus-stack-preview.pgm';
const update = process.argv.includes('--update');

const hashSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/u);
const reportSchema = z
  .object({
    artifacts: z
      .object({
        stackedPreview: z
          .object({
            contentHash: hashSchema,
            format: z.literal('pgm_u8_preview'),
            path: z.literal(OUTPUT_PATH),
            publicRepoAllowed: z.literal(false),
          })
          .strict(),
      })
      .strict(),
    doesNotProve: z.array(
      z.enum([
        'app_ui_e2e',
        'halo_quality_maturity',
        'real_raw_focus_bracket_decode',
        'retouch_workflow_quality',
        'tiff_export_pipeline',
      ]),
    ),
    fixtureId: z.literal('focus.synthetic.public.three-plane-output.v1'),
    generatedAt: z.iso.datetime({ offset: true }),
    issue: z.literal(2313),
    metrics: z
      .object({
        fallbackPixelCount: z.number().int().nonnegative(),
        nonfiniteOutputPixelCount: z.literal(0),
        outputChangedFromReferenceRatio: z.number().gt(0.1),
        selectedRegionMaeMax: z.number().min(0).max(0.000001),
      })
      .strict(),
    runtimeStatus: z.literal('synthetic_focus_stack_output_artifact_rendered'),
    schemaVersion: z.literal(1),
    sourceStack: z
      .object({
        frameCount: z.literal(3),
        height: z.literal(HEIGHT),
        sourceStackHash: hashSchema,
        width: z.literal(WIDTH),
      })
      .strict(),
  })
  .strict();

const frames = [0, 1, 2].map((sourceIndex) => ({
  height: HEIGHT,
  pixels: createFocusPlane(sourceIndex),
  sourceIndex,
  translationX: 0,
  translationY: 0,
  width: WIDTH,
}));
const cells = [buildCell(0, 0, 0, 32, HEIGHT), buildCell(32, 0, 1, 32, HEIGHT), buildCell(64, 0, 2, 32, HEIGHT)];
const result = applyWeightedSharpnessFocusStackV1({
  cells,
  frames,
  lowConfidenceWeightFloor: 0.08,
  referenceSourceIndex: 1,
  weightPower: 4,
});
await mkdir(dirname(OUTPUT_PATH), { recursive: true });
await writeFile(OUTPUT_PATH, encodePgmPreview(result.outputPixels, WIDTH, HEIGHT));

const selectedRegionMaeMax = Math.max(
  regionMae(result.outputPixels, frames[0]?.pixels, 0, 0, 32, HEIGHT),
  regionMae(result.outputPixels, frames[1]?.pixels, 32, 0, 32, HEIGHT),
  regionMae(result.outputPixels, frames[2]?.pixels, 64, 0, 32, HEIGHT),
);
const reference = frames[1]?.pixels;
if (reference === undefined) throw new Error('Focus synthetic output proof requires a reference frame.');
const changedRatio =
  result.outputPixels.filter((value, index) => Math.abs(value - (reference[index] ?? 0)) > 0.01).length /
  result.outputPixels.length;
const report = reportSchema.parse({
  artifacts: {
    stackedPreview: {
      contentHash: await sha256File(OUTPUT_PATH),
      format: 'pgm_u8_preview',
      path: OUTPUT_PATH,
      publicRepoAllowed: false,
    },
  },
  doesNotProve: [
    'app_ui_e2e',
    'halo_quality_maturity',
    'real_raw_focus_bracket_decode',
    'retouch_workflow_quality',
    'tiff_export_pipeline',
  ],
  fixtureId: 'focus.synthetic.public.three-plane-output.v1',
  generatedAt: '2026-06-20T09:35:00.000Z',
  issue: 2313,
  metrics: {
    fallbackPixelCount: result.diagnostics
      .filter((diagnostic) => diagnostic.code === 'reference_fallback')
      .reduce((total, diagnostic) => total + diagnostic.count, 0),
    nonfiniteOutputPixelCount: result.outputPixels.filter((value) => !Number.isFinite(value)).length,
    outputChangedFromReferenceRatio: roundMetric(changedRatio),
    selectedRegionMaeMax,
  },
  runtimeStatus: 'synthetic_focus_stack_output_artifact_rendered',
  schemaVersion: 1,
  sourceStack: {
    frameCount: 3,
    height: HEIGHT,
    sourceStackHash: hashFloat32(...frames.map((frame) => frame.pixels)),
    width: WIDTH,
  },
});
const reportJson = `${JSON.stringify(report, null, 2)}\n`;

if (update) {
  await writeFile(REPORT_PATH, reportJson);
  console.log('focus synthetic output artifact proof updated');
  process.exit(0);
}

const committedReport = reportSchema.parse(JSON.parse(await readFile(REPORT_PATH, 'utf8')));
if (JSON.stringify(committedReport) !== JSON.stringify(report)) {
  throw new Error(
    'Focus synthetic output artifact proof is stale. Run bun tests/integration/checks/check-focus-synthetic-output-artifact.ts --update',
  );
}

console.log(`focus synthetic output artifact ok (${report.artifacts.stackedPreview.contentHash})`);

function createFocusPlane(sourceIndex: number): Float32Array {
  const pixels = new Float32Array(WIDTH * HEIGHT);
  for (let y = 0; y < HEIGHT; y += 1) {
    for (let x = 0; x < WIDTH; x += 1) {
      const base = 0.12 + x / (WIDTH * 3) + y / (HEIGHT * 4);
      const foreground = sourceIndex === 0 && x < 32 ? stripe(x, y, 3) * 0.42 : 0;
      const midground = sourceIndex === 1 && x >= 32 && x < 64 ? stripe(x, y, 5) * 0.38 : 0;
      const background = sourceIndex === 2 && x >= 64 ? stripe(x, y, 7) * 0.44 : 0;
      pixels[y * WIDTH + x] = Math.min(1, base + foreground + midground + background);
    }
  }
  return pixels;
}

function stripe(x: number, y: number, period: number): number {
  return (x + y) % period === 0 ? 1 : 0.15;
}

function buildCell(x: number, y: number, sourceIndex: number, width: number, height: number) {
  return {
    height,
    lowConfidence: false,
    sourceScores: [0, 1, 2].map((candidateSourceIndex) => ({
      relativeConfidence: candidateSourceIndex === sourceIndex ? 1 : 0.01,
      sourceIndex: candidateSourceIndex,
    })),
    width,
    x,
    y,
  };
}

function regionMae(
  output: Float32Array,
  expected: Float32Array | undefined,
  x: number,
  y: number,
  width: number,
  height: number,
): number {
  if (expected === undefined) throw new Error('Focus synthetic output proof missing expected frame.');
  let total = 0;
  let count = 0;
  for (let row = y; row < y + height; row += 1) {
    for (let column = x; column < x + width; column += 1) {
      const index = row * WIDTH + column;
      total += Math.abs((output[index] ?? 0) - (expected[index] ?? 0));
      count += 1;
    }
  }
  return roundMetric(total / count);
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
