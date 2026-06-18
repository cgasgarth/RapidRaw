#!/usr/bin/env bun

import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { z } from 'zod';

import { layerMaskBlendModeV1Schema } from '../packages/rawengine-schema/src/rawEngineSchemas.ts';
import {
  renderLayerOpacityOrderRuntime,
  type LayerOpacityOrderRuntimeOperation,
} from '../src/utils/layerOpacityOrderRuntime.ts';

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
  const rendered = renderLayerOpacityOrderRuntime({
    ...testCase,
    operations: testCase.operations as Array<LayerOpacityOrderRuntimeOperation>,
  });
  const actualHash = hashPixels(rendered.pixels);
  if (actualHash !== testCase.expectedHash) {
    throw new Error(`${testCase.id}: expected ${testCase.expectedHash}, got ${actualHash}.`);
  }
  if (JSON.stringify(rendered.coverageByLayer) !== JSON.stringify(testCase.expectedCoverageByLayer)) {
    throw new Error(`${testCase.id}: coverage mismatch.`);
  }
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

function expectThrows(label: string, callback: () => void): void {
  try {
    callback();
  } catch {
    return;
  }
  throw new Error(`Expected ${label} to throw.`);
}
