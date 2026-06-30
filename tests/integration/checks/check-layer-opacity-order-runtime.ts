#!/usr/bin/env bun

import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { z } from 'zod';

import { layerMaskBlendModeV1Schema } from '../../../packages/rawengine-schema/src/rawEngineSchemas.ts';
import {
  type LayerOpacityOrderRuntimeOperation,
  renderLayerOpacityOrderRuntime,
} from '../../../src/utils/layers/layerOpacityOrderRuntime.ts';

const OUTPUT_DIR = 'artifacts/layers/opacity-order-runtime';

const pixelSchema = z.object({ b: z.number().int(), g: z.number().int(), r: z.number().int() }).strict();
const layerSchema = z
  .object({
    blendMode: layerMaskBlendModeV1Schema.extract(['normal']),
    id: z.string().trim().min(1),
    name: z.string().trim().min(1),
    opacity: z.number().min(0).max(1),
    pixels: z.array(pixelSchema).min(1),
    visible: z.boolean(),
  })
  .strict();

const operationSchema = z.discriminatedUnion('type', [
  z.object({ layerId: z.string().trim().min(1), opacity: z.number().min(0).max(1), type: z.literal('setOpacity') }),
  z.object({ layerId: z.string().trim().min(1), type: z.literal('setVisibility'), visible: z.boolean() }),
  z.object({
    layerId: z.string().trim().min(1),
    toIndex: z.number().int().nonnegative(),
    type: z.literal('moveToIndex'),
  }),
]);

const caseSchema = z
  .object({
    basePixels: z.array(pixelSchema).min(1),
    expectedCoverageByLayer: z.array(z.object({ id: z.string(), opacity: z.number(), touchedPixels: z.number() })),
    expectedHash: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
    height: z.number().int().positive(),
    id: z.string().trim().min(1),
    layers: z.array(layerSchema).min(1),
    operations: z.array(operationSchema),
    width: z.number().int().positive(),
  })
  .strict();

const manifestSchema = z.object({ cases: z.array(caseSchema).min(1), version: z.literal(1) }).strict();
const manifest = manifestSchema.parse(
  JSON.parse(await readFile('fixtures/layers/layer-opacity-order-runtime.json', 'utf8')),
);

for (const testCase of manifest.cases) {
  const replayInput = {
    ...structuredClone(testCase),
    operations: testCase.operations as Array<LayerOpacityOrderRuntimeOperation>,
  };
  const preview = renderLayerOpacityOrderRuntime(replayInput);
  const exported = renderLayerOpacityOrderRuntime(structuredClone(replayInput));
  const previewHash = hashPixels(preview.pixels);
  const exportHash = hashPixels(exported.pixels);
  if (previewHash !== exportHash) {
    throw new Error(`${testCase.id}: preview/export hash mismatch ${previewHash} != ${exportHash}.`);
  }
  if (previewHash !== testCase.expectedHash) {
    throw new Error(`${testCase.id}: expected ${testCase.expectedHash}, got ${previewHash}.`);
  }
  if (JSON.stringify(preview.coverageByLayer) !== JSON.stringify(exported.coverageByLayer)) {
    throw new Error(`${testCase.id}: preview/export coverage mismatch.`);
  }
  if (JSON.stringify(preview.coverageByLayer) !== JSON.stringify(testCase.expectedCoverageByLayer)) {
    throw new Error(`${testCase.id}: coverage mismatch.`);
  }

  await writePpm(resolve(OUTPUT_DIR, `${testCase.id}.base.ppm`), testCase.width, testCase.height, testCase.basePixels);
  await writePpm(resolve(OUTPUT_DIR, `${testCase.id}.preview.ppm`), testCase.width, testCase.height, preview.pixels);
  await writePpm(resolve(OUTPUT_DIR, `${testCase.id}.export.ppm`), testCase.width, testCase.height, exported.pixels);
  await writeFile(
    resolve(OUTPUT_DIR, `${testCase.id}.report.json`),
    `${JSON.stringify(
      {
        coverageByLayer: preview.coverageByLayer,
        exportHash,
        operationCount: testCase.operations.length,
        previewHash,
      },
      null,
      2,
    )}\n`,
  );
}

expectThrows('missing layer operation', () =>
  renderLayerOpacityOrderRuntime({
    ...manifest.cases[0],
    operations: [{ layerId: 'missing', opacity: 0.5, type: 'setOpacity' }],
  }),
);

console.log(`layer opacity/order runtime ok (${manifest.cases.length})`);

function hashPixels(pixels: Array<{ b: number; g: number; r: number }>): string {
  const hash = createHash('sha256');
  for (const pixel of pixels) hash.update(Uint8Array.of(pixel.r, pixel.g, pixel.b));
  return `sha256:${hash.digest('hex')}`;
}

async function writePpm(
  path: string,
  width: number,
  height: number,
  pixels: ReadonlyArray<{ b: number; g: number; r: number }>,
): Promise<void> {
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

function expectThrows(label: string, callback: () => void): void {
  try {
    callback();
  } catch {
    return;
  }
  throw new Error(`Expected ${label} to throw.`);
}
