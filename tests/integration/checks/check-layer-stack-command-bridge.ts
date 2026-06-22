#!/usr/bin/env bun

import { z } from 'zod';

import { INITIAL_MASK_ADJUSTMENTS, type MaskContainer } from '../../../src/utils/adjustments.ts';
import {
  applyLayerStackCommandBridgeOperation,
  buildLayerStackSidecarFromMasks,
  type LayerStackCommandBridgeContext,
} from '../../../src/utils/layerStackCommandBridge.ts';

const layerSummarySchema = z
  .object({
    id: z.string().trim().min(1),
    name: z.string().trim().min(1),
    opacity: z.number().int().min(0).max(100),
    visible: z.boolean(),
  })
  .strict();

const expectedFinalLayers = z.array(layerSummarySchema).parse([
  { id: 'layer-sky', name: 'Sky copy', opacity: 40, visible: false },
  { id: 'layer-foreground-copy', name: 'Foreground Copy', opacity: 70, visible: true },
  { id: 'layer-foreground', name: 'Foreground', opacity: 70, visible: true },
]);

const toMask = (layer: z.infer<typeof layerSummarySchema>): MaskContainer => ({
  adjustments: structuredClone(INITIAL_MASK_ADJUSTMENTS),
  blendMode: 'normal',
  id: layer.id,
  invert: false,
  name: layer.name,
  opacity: layer.opacity,
  subMasks: [],
  visible: layer.visible,
});

const summarize = (masks: ReadonlyArray<MaskContainer>) =>
  masks.map((mask) => ({
    id: mask.id,
    name: mask.name,
    opacity: mask.opacity,
    visible: mask.visible,
  }));

let masks = [
  toMask({ id: 'layer-sky', name: 'Sky', opacity: 100, visible: true }),
  toMask({ id: 'layer-foreground', name: 'Foreground', opacity: 70, visible: true }),
];
let context: LayerStackCommandBridgeContext = {
  graphRevision: 'layer_stack_bridge_initial',
  imagePath: '/photos/session/IMG_0001.CR3',
  operationId: 'initial',
  sessionId: 'session_layer_stack_bridge',
};

const initialSidecar = buildLayerStackSidecarFromMasks(masks, context);
if (initialSidecar.layers[0]?.opacity !== 1 || initialSidecar.layers[1]?.opacity !== 0.7) {
  throw new Error('Expected bridge sidecar to normalize UI opacity from 0..100 to 0..1.');
}

const run = (
  operationId: string,
  operation: Parameters<typeof applyLayerStackCommandBridgeOperation>[1],
): ReturnType<typeof applyLayerStackCommandBridgeOperation> => {
  const result = applyLayerStackCommandBridgeOperation(masks, operation, { ...context, operationId });
  masks = result.masks;
  context = { ...context, graphRevision: result.graphRevision, operationId };
  return result;
};

const opacity = run('set_sky_opacity', { layerId: 'layer-sky', opacity: 40, type: 'setOpacity' });
if (opacity.command.commandType !== 'layerMask.setLayerOpacity' || opacity.sidecar.layers[0]?.opacity !== 0.4) {
  throw new Error('Expected opacity operation to dispatch a typed layer opacity command.');
}

const hidden = run('hide_sky', { layerId: 'layer-sky', type: 'setVisibility', visible: false });
if (hidden.commandResult.changedLayerIds[0] !== 'layer-sky') {
  throw new Error('Expected visibility operation to report changed layer id.');
}

run('rename_sky', { layerId: 'layer-sky', name: 'Sky copy', type: 'rename' });
run('duplicate_foreground', {
  layerId: 'layer-foreground',
  name: 'Foreground Copy',
  newLayerId: 'layer-foreground-copy',
  type: 'duplicate',
});
run('move_foreground_copy_up', { direction: 'up', layerId: 'layer-foreground-copy', type: 'move' });

const createdLayer = toMask({ id: 'layer-temp', name: 'Temp', opacity: 100, visible: true });
run('create_temp', { layer: createdLayer, type: 'create' });
const deleted = run('delete_temp', { layerId: 'layer-temp', type: 'delete' });
if (deleted.command.commandType !== 'layerMask.deleteLayer') {
  throw new Error('Expected delete operation to dispatch typed layer delete command.');
}

const actualFinalLayers = layerSummarySchema.array().parse(summarize(masks));
if (JSON.stringify(actualFinalLayers) !== JSON.stringify(expectedFinalLayers)) {
  console.error('Expected:', JSON.stringify(expectedFinalLayers));
  console.error('Actual:', JSON.stringify(actualFinalLayers));
  process.exit(1);
}

if (!context.graphRevision.includes('delete_temp')) {
  throw new Error('Expected graph revision to advance after bridge dispatch.');
}

console.log(`layer stack command bridge ok (${actualFinalLayers.length} layers)`);
