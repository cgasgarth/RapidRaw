#!/usr/bin/env bun

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';
import { INITIAL_MASK_ADJUSTMENTS } from '../../../src/utils/adjustments.ts';
import {
  getLayerAdjustmentSnapshot,
  LAYER_ADJUSTMENT_KEYS,
  setLayerAdjustment,
  setLayerAdjustments,
} from '../../../src/utils/layerAdjustments.ts';

const adjustmentKeySchema = z.enum(LAYER_ADJUSTMENT_KEYS);
const adjustmentPatchSchema = z.partialRecord(adjustmentKeySchema, z.number());

const layerFixtureSchema = z
  .object({
    id: z.string().trim().min(1),
    name: z.string().trim().min(1),
    opacity: z.number(),
    visible: z.boolean(),
  })
  .strict();

const operationSchema = z.discriminatedUnion('type', [
  z
    .object({
      key: adjustmentKeySchema,
      layerId: z.string().trim().min(1),
      type: z.literal('setAdjustment'),
      value: z.number(),
    })
    .strict(),
  z
    .object({
      layerId: z.string().trim().min(1),
      patch: adjustmentPatchSchema,
      type: z.literal('setAdjustments'),
    })
    .strict(),
]);

const fixtureSchema = z
  .object({
    expected: z.record(z.string().trim().min(1), adjustmentPatchSchema),
    id: z.string().trim().min(1),
    initialLayers: z.array(layerFixtureSchema).min(1),
    operations: z.array(operationSchema).min(1),
  })
  .strict();

const fixtures = z
  .array(fixtureSchema)
  .min(1)
  .parse(JSON.parse(readFileSync(resolve('fixtures/layers/layer-adjustment-operations.json'), 'utf8')));

function toMaskContainer(layer) {
  return {
    adjustments: structuredClone(INITIAL_MASK_ADJUSTMENTS),
    id: layer.id,
    invert: false,
    name: layer.name,
    opacity: layer.opacity,
    subMasks: [],
    visible: layer.visible,
  };
}

function applyOperation(layers, operation) {
  switch (operation.type) {
    case 'setAdjustment':
      return setLayerAdjustment(layers, operation.layerId, operation.key, operation.value);
    case 'setAdjustments':
      return setLayerAdjustments(layers, operation.layerId, operation.patch);
  }
}

for (const fixture of fixtures) {
  const result = fixture.operations.reduce(
    (layers, operation) => applyOperation(layers, operation),
    fixture.initialLayers.map(toMaskContainer),
  );

  for (const [layerId, expectedPatch] of Object.entries(fixture.expected)) {
    const expectedKeys = Object.keys(expectedPatch);
    const snapshot = getLayerAdjustmentSnapshot(result, layerId, expectedKeys);
    if (JSON.stringify(snapshot) !== JSON.stringify(expectedPatch)) {
      console.error(`${fixture.id}: layer adjustment mismatch for ${layerId}`);
      console.error('Expected:', JSON.stringify(expectedPatch, null, 2));
      console.error('Actual:', JSON.stringify(snapshot, null, 2));
      process.exit(1);
    }
  }
}

console.log(`Validated ${fixtures.length} layer adjustment operation fixtures.`);
