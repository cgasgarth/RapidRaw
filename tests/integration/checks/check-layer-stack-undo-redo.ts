#!/usr/bin/env bun

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';

import { INITIAL_MASK_ADJUSTMENTS, type MaskContainer } from '../../../src/utils/adjustments.ts';
import {
  redoEditHistory,
  type EditHistoryState,
  pushEditHistoryEntry,
  undoEditHistory,
} from '../../../src/utils/editHistory.ts';
import {
  createAdjustmentLayer,
  deleteLayer,
  moveLayer,
  setLayerName,
  setLayerOpacity,
  setLayerVisibility,
} from '../../../src/utils/layerStack.ts';

const layerSchema = z
  .object({
    id: z.string().trim().min(1),
    name: z.string().trim().min(1),
    opacity: z.number().int().min(0).max(100),
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
      layer: layerSchema,
      type: z.literal('create'),
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
      layerId: z.string().trim().min(1),
      name: z.string().trim().min(1),
      type: z.literal('rename'),
    })
    .strict(),
]);

const replaySchema = z
  .object({
    expectedFinalLayers: z.array(layerSchema).min(1),
    expectedRedoLayers: z.array(layerSchema).min(1),
    expectedUndoLayers: z.array(layerSchema).min(1),
    id: z.string().trim().min(1),
    initialLayers: z.array(layerSchema).min(1),
    steps: z
      .array(
        z
          .object({
            label: z.string().trim().min(1),
            operation: operationSchema,
          })
          .strict(),
      )
      .min(1),
  })
  .strict();

type LayerReplay = z.infer<typeof replaySchema>;
type LayerReplayOperation = z.infer<typeof operationSchema>;
type LayerSummary = z.infer<typeof layerSchema>;

const replay = replaySchema.parse(
  JSON.parse(readFileSync(resolve('fixtures/layers/layer-stack-undo-redo.json'), 'utf8')),
);

function toMaskContainer(layer: LayerSummary): MaskContainer {
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

function summarize(layers: Array<MaskContainer>): Array<LayerSummary> {
  return layers.map((layer) => ({
    id: layer.id,
    name: layer.name,
    opacity: layer.opacity,
    visible: layer.visible,
  }));
}

function applyOperation(layers: Array<MaskContainer>, operation: LayerReplayOperation): Array<MaskContainer> {
  switch (operation.type) {
    case 'setOpacity':
      return setLayerOpacity(layers, operation.layerId, operation.opacity);
    case 'setVisibility':
      return setLayerVisibility(layers, operation.layerId, operation.visible);
    case 'move':
      return moveLayer(layers, operation.layerId, operation.direction);
    case 'create':
      return createAdjustmentLayer(layers, toMaskContainer(operation.layer));
    case 'delete':
      return deleteLayer(layers, operation.layerId);
    case 'rename':
      return setLayerName(layers, operation.layerId, operation.name);
  }
}

function expectLayers(id: string, actual: Array<MaskContainer>, expected: LayerReplay['expectedFinalLayers']): void {
  const actualSummary = summarize(actual);
  if (JSON.stringify(actualSummary) === JSON.stringify(expected)) return;

  console.error(`${replay.id}: ${id} mismatch`);
  console.error('Expected:', JSON.stringify(expected, null, 2));
  console.error('Actual:', JSON.stringify(actualSummary, null, 2));
  process.exit(1);
}

let state: EditHistoryState<Array<MaskContainer>> = {
  adjustments: replay.initialLayers.map(toMaskContainer),
  history: [replay.initialLayers.map(toMaskContainer)],
  historyIndex: 0,
};

for (const step of replay.steps) {
  const nextLayers = applyOperation(state.adjustments, step.operation);
  const pushed = pushEditHistoryEntry(state.history, state.historyIndex, nextLayers);
  state = { ...state, ...pushed, adjustments: nextLayers };
}

expectLayers('final replay state', state.adjustments, replay.expectedFinalLayers);

state = undoEditHistory(state);
expectLayers('undo state', state.adjustments, replay.expectedUndoLayers);

state = redoEditHistory(state);
expectLayers('redo state', state.adjustments, replay.expectedRedoLayers);

console.log(`layer stack undo/redo ok (${replay.steps.length} operations)`);
