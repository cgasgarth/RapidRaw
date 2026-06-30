#!/usr/bin/env bun

import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

import { z } from 'zod';

import {
  measureHdrMergeWeightingV1,
  mergeExposureWeightedRadianceV1,
} from '../../../packages/rawengine-schema/src/hdr/hdrMergeWeightingRuntime.ts';

const WIDTH = 96;
const HEIGHT = 64;
const CLIP_THRESHOLD = 0.99;
const SENSOR_WHITE_RADIANCE = 1;
const MAX_RECONSTRUCTION_MAE = 0.015;
const REPORT_PATH = 'docs/validation/proofs/hdr/hdr-synthetic-output-artifact-proof-2026-06-20.json';
const OUTPUT_PATH = 'artifacts/validation/hdr-synthetic-output-artifact/merged-preview.pgm';
const update = process.argv.includes('--update');

const hashSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/u);
const reportSchema = z
  .object({
    artifacts: z
      .object({
        mergedPreview: z
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
        'deghost_visual_quality',
        'export_tiff_pipeline',
        'real_raw_bracket_decode',
        'tone_mapping_quality',
      ]),
    ),
    fixtureId: z.literal('hdr.synthetic.public.bracket-output.v1'),
    generatedAt: z.iso.datetime({ offset: true }),
    issue: z.literal(2312),
    metrics: z
      .object({
        meanAbsoluteError: z.number().min(0).max(MAX_RECONSTRUCTION_MAE),
        recoveredHighlightPixelRatio: z.number().min(0.9).max(1),
        unrecoveredClippedPixelRatio: z.number().min(0).max(0.03),
      })
      .strict(),
    runtimeStatus: z.literal('synthetic_hdr_merge_output_artifact_rendered'),
    schemaVersion: z.literal(1),
    sourceBracket: z
      .object({
        exposureEvs: z.tuple([z.literal(-2), z.literal(0), z.literal(2)]),
        height: z.literal(HEIGHT),
        syntheticSceneHash: hashSchema,
        width: z.literal(WIDTH),
      })
      .strict(),
  })
  .strict();

const scene = createScene(WIDTH, HEIGHT);
const captures = [-2, 0, 2].map((exposureEv, sourceIndex) => ({
  exposureEv,
  pixels: renderBracket(scene, exposureEv),
  sourceIndex,
}));
const merged = mergeExposureWeightedRadianceV1({
  captures,
  clipThreshold: CLIP_THRESHOLD,
  height: HEIGHT,
  sensorWhiteRadiance: SENSOR_WHITE_RADIANCE,
  width: WIDTH,
});
const metrics = measureHdrMergeWeightingV1({
  captures,
  clipThreshold: CLIP_THRESHOLD,
  maxReconstructionMae: MAX_RECONSTRUCTION_MAE,
  merged,
  scene,
});

await mkdir(dirname(OUTPUT_PATH), { recursive: true });
await writeFile(OUTPUT_PATH, encodePgmPreview(merged, WIDTH, HEIGHT));

const report = reportSchema.parse({
  artifacts: {
    mergedPreview: {
      contentHash: await sha256File(OUTPUT_PATH),
      format: 'pgm_u8_preview',
      path: OUTPUT_PATH,
      publicRepoAllowed: false,
    },
  },
  doesNotProve: [
    'app_ui_e2e',
    'deghost_visual_quality',
    'export_tiff_pipeline',
    'real_raw_bracket_decode',
    'tone_mapping_quality',
  ],
  fixtureId: 'hdr.synthetic.public.bracket-output.v1',
  generatedAt: '2026-06-20T09:25:00.000Z',
  issue: 2312,
  metrics: {
    meanAbsoluteError: metrics.meanAbsoluteError,
    recoveredHighlightPixelRatio: metrics.recoveredHighlightPixelRatio,
    unrecoveredClippedPixelRatio: metrics.unrecoveredClippedPixelRatio,
  },
  runtimeStatus: 'synthetic_hdr_merge_output_artifact_rendered',
  schemaVersion: 1,
  sourceBracket: {
    exposureEvs: [-2, 0, 2],
    height: HEIGHT,
    syntheticSceneHash: hashFloat64(scene),
    width: WIDTH,
  },
});
const reportJson = `${JSON.stringify(report, null, 2)}\n`;

if (update) {
  await writeFile(REPORT_PATH, reportJson);
  console.log('hdr synthetic output artifact proof updated');
  process.exit(0);
}

const committedReport = reportSchema.parse(JSON.parse(await readFile(REPORT_PATH, 'utf8')));
if (JSON.stringify(committedReport) !== JSON.stringify(report)) {
  throw new Error(
    'HDR synthetic output artifact proof is stale. Run bun tests/integration/checks/check-hdr-synthetic-output-artifact.ts --update',
  );
}

console.log(`hdr synthetic output artifact ok (${report.artifacts.mergedPreview.contentHash})`);

function createScene(width: number, height: number): Float64Array {
  const scene = new Float64Array(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const gradient = 0.03 + x / (width * 1.8) + y / (height * 3.2);
      const highlight = x > width * 0.62 && y > height * 0.16 && y < height * 0.54 ? 1.45 : 0;
      const shadowDetail = x < width * 0.28 && y > height * 0.48 ? 0.035 : 0;
      scene[y * width + x] = gradient + highlight + shadowDetail;
    }
  }
  return scene;
}

function renderBracket(scene: Float64Array, exposureEv: number): Float64Array {
  const scale = 2 ** exposureEv;
  const capture = new Float64Array(scene.length);
  for (let index = 0; index < scene.length; index += 1) {
    capture[index] = Math.min(1, Math.max(0, (scene[index] ?? 0) * scale));
  }
  return capture;
}

function encodePgmPreview(values: Float64Array, width: number, height: number): Uint8Array {
  const header = new TextEncoder().encode(`P5\n${width} ${height}\n255\n`);
  const pixels = new Uint8Array(values.length);
  for (let index = 0; index < values.length; index += 1) {
    const toneMapped = (values[index] ?? 0) / (1 + (values[index] ?? 0));
    pixels[index] = Math.round(Math.max(0, Math.min(1, toneMapped ** (1 / 2.2))) * 255);
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

function hashFloat64(values: Float64Array): string {
  return `sha256:${createHash('sha256').update(Buffer.from(values.buffer)).digest('hex')}`;
}
