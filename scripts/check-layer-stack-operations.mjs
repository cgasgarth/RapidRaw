#!/usr/bin/env bun

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';

import {
  deleteLayer,
  duplicateLayer,
  moveLayer,
  setLayerOpacity,
  setLayerVisibility,
} from '../src/utils/layerStack.ts';
import { INITIAL_MASK_ADJUSTMENTS } from '../src/utils/adjustments.ts';

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
      layerId: z.string().trim().min(1),
      opacity: z.number(),
      type: z.literal('setOpacity'),
    })
    .strict(),
  z
    .object({
      layerId: z.string().trim().min(1),
      type: z.literal('setVisibility'),
      visible: z.boolean(),
    })
    .strict(),
  z
    .object({
      direction: z.enum(['down', 'up']),
      layerId: z.string().trim().min(1),
      type: z.literal('move'),
    })
    .strict(),
  z
    .object({
      layerId: z.string().trim().min(1),
      name: z.string().trim().min(1),
      newLayerId: z.string().trim().min(1),
      type: z.literal('duplicate'),
    })
    .strict(),
  z
    .object({
      layerId: z.string().trim().min(1),
      type: z.literal('delete'),
    })
    .strict(),
]);

const fixtureSchema = z
  .object({
    expectedLayers: z.array(layerFixtureSchema).min(1),
    id: z.string().trim().min(1),
    initialLayers: z.array(layerFixtureSchema).min(1),
    operations: z.array(operationSchema).min(1),
  })
  .strict();

const fixtures = z
  .array(fixtureSchema)
  .min(1)
  .parse(JSON.parse(readFileSync(resolve('fixtures/layers/layer-stack-operations.json'), 'utf8')));

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

function summarize(layers) {
  return layers.map((layer) => ({
    id: layer.id,
    name: layer.name,
    opacity: layer.opacity,
    visible: layer.visible,
  }));
}

function applyOperation(layers, operation) {
  switch (operation.type) {
    case 'setOpacity':
      return setLayerOpacity(layers, operation.layerId, operation.opacity);
    case 'setVisibility':
      return setLayerVisibility(layers, operation.layerId, operation.visible);
    case 'move':
      return moveLayer(layers, operation.layerId, operation.direction);
    case 'duplicate':
      return duplicateLayer(layers, operation.layerId, operation.newLayerId, operation.name);
    case 'delete':
      return deleteLayer(layers, operation.layerId);
  }
}

for (const fixture of fixtures) {
  const result = fixture.operations.reduce(
    (layers, operation) => applyOperation(layers, operation),
    fixture.initialLayers.map(toMaskContainer),
  );
  const actual = summarize(result);
  const expected = fixture.expectedLayers;

  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    console.error(`${fixture.id}: layer stack operation mismatch`);
    console.error('Expected:', JSON.stringify(expected, null, 2));
    console.error('Actual:', JSON.stringify(actual, null, 2));
    process.exit(1);
  }
}

console.log(`Validated ${fixtures.length} layer stack operation fixtures.`);
