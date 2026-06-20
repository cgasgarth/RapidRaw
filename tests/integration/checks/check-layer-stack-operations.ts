#!/usr/bin/env bun

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';

import {
  buildLayerRenderPlan,
  createAdjustmentLayer,
  deleteLayer,
  deleteLayerGroup,
  duplicateLayer,
  duplicateLayerGroup,
  groupLayerWithNext,
  moveLayer,
  moveLayerGroup,
  setLayerGroupName,
  setLayerGroupOpacity,
  setLayerName,
  setLayerOpacity,
  setLayerVisibility,
  showAllLayers,
  soloLayer,
  soloLayerGroup,
  ungroupLayerGroup,
} from '../../../src/utils/layerStack.ts';
import { INITIAL_MASK_ADJUSTMENTS } from '../../../src/utils/adjustments.ts';

const layerFixtureSchema = z
  .object({
    id: z.string().trim().min(1),
    layerGroupId: z.string().trim().min(1).optional(),
    layerGroupName: z.string().trim().min(1).optional(),
    name: z.string().trim().min(1),
    opacity: z.number(),
    visible: z.boolean(),
  })
  .strict();

const renderPlanItemSchema = z
  .object({
    adjustmentKeys: z.array(z.string().trim().min(1)),
    layerId: z.string().trim().min(1),
    name: z.string().trim().min(1),
    opacity: z.number().int().min(0).max(100),
    opacityFraction: z.number().min(0).max(1),
    subMaskCount: z.number().int().nonnegative(),
  })
  .strict();

const operationSchema = z.discriminatedUnion('type', [
  z
    .object({
      insertIndex: z.number().int().nonnegative().optional(),
      name: z.string().trim().min(1),
      newLayerId: z.string().trim().min(1),
      type: z.literal('create'),
    })
    .strict(),
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
      name: z.string(),
      type: z.literal('rename'),
    })
    .strict(),
  z
    .object({
      groupId: z.string().trim().min(1),
      name: z.string(),
      type: z.literal('renameGroup'),
    })
    .strict(),
  z
    .object({
      groupId: z.string().trim().min(1),
      opacity: z.number(),
      type: z.literal('setGroupOpacity'),
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
      layerId: z.string().trim().min(1),
      type: z.literal('solo'),
    })
    .strict(),
  z
    .object({
      groupId: z.string().trim().min(1),
      type: z.literal('soloGroup'),
    })
    .strict(),
  z
    .object({
      type: z.literal('showAll'),
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
      groupId: z.string().trim().min(1),
      groupName: z.string().trim().min(1),
      layerInputs: z
        .array(
          z
            .object({
              duplicateName: z.string().trim().min(1),
              layerId: z.string().trim().min(1),
              newLayerId: z.string().trim().min(1),
            })
            .strict(),
        )
        .min(1),
      newGroupId: z.string().trim().min(1),
      type: z.literal('duplicateGroup'),
    })
    .strict(),
  z
    .object({
      layerId: z.string().trim().min(1),
      type: z.literal('delete'),
    })
    .strict(),
  z
    .object({
      groupId: z.string().trim().min(1),
      type: z.literal('deleteGroup'),
    })
    .strict(),
  z
    .object({
      groupId: z.string().trim().min(1),
      groupName: z.string().trim().min(1),
      layerId: z.string().trim().min(1),
      type: z.literal('groupWithNext'),
    })
    .strict(),
  z
    .object({
      direction: z.enum(['down', 'up']),
      groupId: z.string().trim().min(1),
      type: z.literal('moveGroup'),
    })
    .strict(),
  z
    .object({
      groupId: z.string().trim().min(1),
      type: z.literal('ungroup'),
    })
    .strict(),
]);

const fixtureSchema = z
  .object({
    expectedError: z.string().trim().min(1).optional(),
    expectedLayers: z.array(layerFixtureSchema).min(1),
    expectedRenderPlan: z.array(renderPlanItemSchema).optional(),
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
    ...(layer.layerGroupId ? { layerGroupId: layer.layerGroupId } : {}),
    ...(layer.layerGroupName ? { layerGroupName: layer.layerGroupName } : {}),
    name: layer.name,
    opacity: layer.opacity,
    subMasks: [],
    visible: layer.visible,
  };
}

function summarize(layers) {
  return layers.map((layer) => ({
    id: layer.id,
    ...(layer.layerGroupId ? { layerGroupId: layer.layerGroupId } : {}),
    ...(layer.layerGroupName ? { layerGroupName: layer.layerGroupName } : {}),
    name: layer.name,
    opacity: layer.opacity,
    visible: layer.visible,
  }));
}

function applyOperation(layers, operation) {
  switch (operation.type) {
    case 'create':
      return createAdjustmentLayer(
        layers,
        {
          adjustments: structuredClone(INITIAL_MASK_ADJUSTMENTS),
          id: operation.newLayerId,
          invert: false,
          name: operation.name,
          opacity: 100,
          subMasks: [],
          visible: true,
        },
        operation.insertIndex,
      );
    case 'setOpacity':
      return setLayerOpacity(layers, operation.layerId, operation.opacity);
    case 'rename':
      return setLayerName(layers, operation.layerId, operation.name);
    case 'renameGroup':
      return setLayerGroupName(layers, operation.groupId, operation.name);
    case 'setGroupOpacity':
      return setLayerGroupOpacity(layers, operation.groupId, operation.opacity);
    case 'setVisibility':
      return setLayerVisibility(layers, operation.layerId, operation.visible);
    case 'solo':
      return soloLayer(layers, operation.layerId);
    case 'soloGroup':
      return soloLayerGroup(layers, operation.groupId);
    case 'showAll':
      return showAllLayers(layers);
    case 'move':
      return moveLayer(layers, operation.layerId, operation.direction);
    case 'duplicate':
      return duplicateLayer(layers, operation.layerId, operation.newLayerId, operation.name);
    case 'duplicateGroup':
      return duplicateLayerGroup(
        layers,
        operation.groupId,
        operation.newGroupId,
        operation.groupName,
        operation.layerInputs,
      );
    case 'delete':
      return deleteLayer(layers, operation.layerId);
    case 'deleteGroup':
      return deleteLayerGroup(layers, operation.groupId);
    case 'groupWithNext':
      return groupLayerWithNext(layers, operation.layerId, operation.groupId, operation.groupName);
    case 'moveGroup':
      return moveLayerGroup(layers, operation.groupId, operation.direction);
    case 'ungroup':
      return ungroupLayerGroup(layers, operation.groupId);
  }
}

for (const fixture of fixtures) {
  let result;
  try {
    result = fixture.operations.reduce(
      (layers, operation) => applyOperation(layers, operation),
      fixture.initialLayers.map(toMaskContainer),
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (fixture.expectedError !== undefined && message.includes(fixture.expectedError)) {
      continue;
    }

    console.error(`${fixture.id}: unexpected layer stack error`);
    console.error(message);
    process.exit(1);
  }

  if (fixture.expectedError !== undefined) {
    console.error(`${fixture.id}: expected layer stack error`);
    console.error(fixture.expectedError);
    process.exit(1);
  }

  const actual = summarize(result);
  const expected = fixture.expectedLayers;

  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    console.error(`${fixture.id}: layer stack operation mismatch`);
    console.error('Expected:', JSON.stringify(expected, null, 2));
    console.error('Actual:', JSON.stringify(actual, null, 2));
    process.exit(1);
  }

  if (fixture.expectedRenderPlan !== undefined) {
    const actualRenderPlan = buildLayerRenderPlan(result);
    if (JSON.stringify(actualRenderPlan) !== JSON.stringify(fixture.expectedRenderPlan)) {
      console.error(`${fixture.id}: layer render plan mismatch`);
      console.error('Expected:', JSON.stringify(fixture.expectedRenderPlan, null, 2));
      console.error('Actual:', JSON.stringify(actualRenderPlan, null, 2));
      process.exit(1);
    }
  }
}

console.log(`Validated ${fixtures.length} layer stack operation fixtures.`);
