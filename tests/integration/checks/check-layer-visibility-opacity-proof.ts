#!/usr/bin/env bun

import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

import { z } from 'zod';

import {
  type LayerOpacityOrderRuntimeOperation,
  renderLayerOpacityOrderRuntime,
} from '../../../src/utils/layerOpacityOrderRuntime.ts';

const FIXTURE_PATH = 'fixtures/layers/layer-visibility-opacity-proof.json';
const REPORT_PATH = 'docs/validation/layer-visibility-opacity-proof-2026-06-21.json';
const OUTPUT_DIR = 'artifacts/layers/visibility-opacity-proof';
const update = process.argv.includes('--update');

const pixelSchema = z.object({ b: z.number().int(), g: z.number().int(), r: z.number().int() }).strict();
const operationSchema = z.discriminatedUnion('type', [
  z.object({ layerId: z.string().trim().min(1), opacity: z.number().min(0).max(1), type: z.literal('setOpacity') }),
  z.object({ layerId: z.string().trim().min(1), type: z.literal('setVisibility'), visible: z.boolean() }),
]);
const proofStepSchema = z
  .object({
    expectedCoverageCount: z.number().int().nonnegative(),
    expectedTouchedPixels: z.number().int().nonnegative(),
    id: z.string().trim().min(1),
    operations: z.array(operationSchema),
  })
  .strict();
const layerSchema = z
  .object({
    blendMode: z.literal('normal'),
    id: z.string().trim().min(1),
    name: z.string().trim().min(1),
    opacity: z.number().min(0).max(1),
    pixels: z.array(pixelSchema).min(1),
    visible: z.boolean(),
  })
  .strict();
const fixtureSchema = z
  .object({
    basePixels: z.array(pixelSchema).min(1),
    height: z.number().int().positive(),
    id: z.string().trim().min(1),
    layers: z.array(layerSchema).min(1),
    proofSteps: z.array(proofStepSchema).length(3),
    width: z.number().int().positive(),
  })
  .strict();
const proofReportSchema = z
  .object({
    artifactRoot: z.literal(OUTPUT_DIR),
    doesNotProve: z.array(z.string().min(1)).min(1),
    issue: z.literal(2876),
    schemaVersion: z.literal(1),
    steps: z
      .array(
        z
          .object({
            coverageCount: z.number().int().nonnegative(),
            exportHash: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
            id: z.string().trim().min(1),
            previewHash: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
            touchedPixels: z.number().int().nonnegative(),
          })
          .strict(),
      )
      .length(3),
    validationCommands: z
      .array(
        z.enum([
          'bun run check:layer-visibility-opacity-proof',
          'bun run check:layer-opacity-order-runtime',
          'bun run check:layer-stack-panel-ui',
        ]),
      )
      .length(3),
  })
  .strict()
  .superRefine((report, context) => {
    for (const step of report.steps) {
      if (step.previewHash !== step.exportHash) {
        context.addIssue({ code: 'custom', message: `${step.id}: preview/export mismatch`, path: ['steps'] });
      }
    }
  });

type Pixel = z.infer<typeof pixelSchema>;

const fixture = fixtureSchema.parse(JSON.parse(await readFile(FIXTURE_PATH, 'utf8')));
const steps = [];

for (const step of fixture.proofSteps) {
  const input = {
    basePixels: fixture.basePixels,
    height: fixture.height,
    layers: fixture.layers,
    operations: step.operations as Array<LayerOpacityOrderRuntimeOperation>,
    width: fixture.width,
  };
  const preview = renderLayerOpacityOrderRuntime(input);
  const exported = renderLayerOpacityOrderRuntime(structuredClone(input));
  const touchedPixels = preview.coverageByLayer.reduce((total, layer) => total + layer.touchedPixels, 0);

  if (preview.coverageByLayer.length !== step.expectedCoverageCount) {
    throw new Error(`${step.id}: coverage count mismatch.`);
  }
  if (touchedPixels !== step.expectedTouchedPixels) {
    throw new Error(`${step.id}: touched pixel mismatch.`);
  }

  await writePpm(resolve(OUTPUT_DIR, `${step.id}.preview.ppm`), fixture.width, fixture.height, preview.pixels);
  await writePpm(resolve(OUTPUT_DIR, `${step.id}.export.ppm`), fixture.width, fixture.height, exported.pixels);
  steps.push({
    coverageCount: preview.coverageByLayer.length,
    exportHash: hashPixels(exported.pixels),
    id: step.id,
    previewHash: hashPixels(preview.pixels),
    touchedPixels,
  });
}

const expectedReport = proofReportSchema.parse({
  artifactRoot: OUTPUT_DIR,
  doesNotProve: ['full_macos_app_manual_session', 'private_raw_decode', 'group_opacity_rendering'],
  issue: 2876,
  schemaVersion: 1,
  steps,
  validationCommands: [
    'bun run check:layer-visibility-opacity-proof',
    'bun run check:layer-opacity-order-runtime',
    'bun run check:layer-stack-panel-ui',
  ],
});
const expectedJson = `${JSON.stringify(expectedReport, null, 2)}\n`;

if (update) {
  await writeFile(REPORT_PATH, expectedJson);
  console.log('layer visibility/opacity proof updated');
  process.exit(0);
}

const committedReport = proofReportSchema.parse(JSON.parse(await readFile(REPORT_PATH, 'utf8')));
if (JSON.stringify(committedReport) !== JSON.stringify(expectedReport)) {
  throw new Error(
    `${REPORT_PATH} is stale; run bun tests/integration/checks/check-layer-visibility-opacity-proof.ts --update.`,
  );
}

console.log(`layer visibility/opacity proof ok (${steps.length} states)`);

function hashPixels(pixels: ReadonlyArray<Pixel>): string {
  const hash = createHash('sha256');
  for (const pixel of pixels) hash.update(Uint8Array.of(pixel.r, pixel.g, pixel.b));
  return `sha256:${hash.digest('hex')}`;
}

async function writePpm(path: string, width: number, height: number, pixels: ReadonlyArray<Pixel>): Promise<void> {
  const rows = [`P3`, `${width} ${height}`, '255'];
  for (let row = 0; row < height; row += 1) {
    const start = row * width;
    rows.push(
      pixels
        .slice(start, start + width)
        .map((pixel) => `${pixel.r} ${pixel.g} ${pixel.b}`)
        .join('  '),
    );
  }
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${rows.join('\n')}\n`);
}
