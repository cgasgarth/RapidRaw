#!/usr/bin/env bun

import { z } from 'zod';

import { INITIAL_MASK_ADJUSTMENTS, type MaskContainer } from '../../../src/utils/adjustments.ts';
import {
  applyLayerStackCommandBridgeOperation,
  applyResolvedRemoveSourcesToLayerStack,
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

const tone = run('apply_sky_tone', {
  layerId: 'layer-sky',
  toneColor: {
    blackPoint: 3,
    clarity: 7,
    contrast: 12,
    exposureEv: 0.4,
    highlights: -10,
    saturation: 9,
    shadows: 18,
    whitePoint: 4,
  },
  type: 'applyToneAdjustment',
});
if (
  tone.command.commandType !== 'layerMask.applyLayerAdjustment' ||
  tone.sidecar.layers[0]?.adjustments?.toneColor?.exposureEv !== 0.4 ||
  masks[0]?.adjustments.exposure !== 0.4
) {
  throw new Error('Expected layer tone adjustment to dispatch and roundtrip through typed sidecar state.');
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

const cloneLayer = {
  ...toMask({ id: 'layer-clone', name: 'Clone texture', opacity: 100, visible: true }),
  retouchCloneSource: {
    alignmentErrorPx: 0.18,
    retouchMode: 'clone',
    rotationDegrees: 1,
    scale: 1.1,
    sourcePoint: { x: 0.25, y: 0.35 },
    targetPoint: { x: 0.62, y: 0.58 },
  },
} satisfies MaskContainer;
const clone = run('create_clone', { layer: cloneLayer, type: 'create' });
if (
  clone.command.commandType !== 'layerMask.createLayer' ||
  clone.command.parameters.retouchCloneSource?.sourcePoint.x !== 0.25 ||
  clone.sidecar.layers[0]?.retouchCloneSource?.targetPoint.y !== 0.58 ||
  masks[0]?.retouchCloneSource?.alignmentErrorPx !== 0.18
) {
  throw new Error('Expected clone layer creation to preserve source linkage through command, sidecar, and UI masks.');
}
const updatedClone = run('update_clone_source', {
  layerId: 'layer-clone',
  retouchCloneSource: {
    alignmentErrorPx: 0.05,
    retouchMode: 'clone',
    rotationDegrees: 0,
    scale: 1,
    sourcePoint: { x: 0.12, y: 0.2 },
    targetPoint: { x: 0.72, y: 0.8 },
  },
  type: 'updateRetouchSource',
});
if (
  updatedClone.command.commandType !== 'layerMask.updateRetouchSource' ||
  updatedClone.sidecar.layers[0]?.retouchCloneSource?.sourcePoint.x !== 0.12 ||
  masks[0]?.retouchCloneSource?.targetPoint.y !== 0.8
) {
  throw new Error('Expected clone source edits to roundtrip through command, sidecar, and UI masks.');
}
run('delete_clone', { layerId: 'layer-clone', type: 'delete' });

const healLayer = {
  ...toMask({ id: 'layer-heal', name: 'Heal spot', opacity: 100, visible: true }),
  retouchCloneSource: {
    alignmentErrorPx: 0,
    featherRadiusPx: 24,
    radiusPx: 48,
    retouchMode: 'heal',
    rotationDegrees: 0,
    scale: 1,
    sourcePoint: { x: 0.3, y: 0.35 },
    targetPoint: { x: 0.5, y: 0.55 },
  },
} satisfies MaskContainer;
const heal = run('create_heal', { layer: healLayer, type: 'create' });
if (
  heal.command.commandType !== 'layerMask.createLayer' ||
  heal.command.parameters.retouchCloneSource?.retouchMode !== 'heal' ||
  heal.sidecar.layers[0]?.retouchCloneSource?.radiusPx !== 48 ||
  masks[0]?.retouchCloneSource?.featherRadiusPx !== 24
) {
  throw new Error('Expected heal layer creation to preserve heal metadata through command, sidecar, and UI masks.');
}
run('delete_heal', { layerId: 'layer-heal', type: 'delete' });

const removeLayer = {
  ...toMask({ id: 'layer-remove', name: 'Remove dust', opacity: 100, visible: true }),
  retouchRemoveSource: {
    featherRadiusPx: 24,
    generator: 'local_patch_fill_v1',
    generatorVersion: 1,
    radiusPx: 48,
    searchRadiusMultiplier: 4,
    seed: 0,
    status: 'needs_regeneration',
    targetMaskId: 'layer-remove-target',
  },
} satisfies MaskContainer;
const remove = run('create_remove', { layer: removeLayer, type: 'create' });
if (
  remove.command.commandType !== 'layerMask.createLayer' ||
  remove.command.parameters.retouchRemoveSource?.generator !== 'local_patch_fill_v1' ||
  remove.sidecar.layers[0]?.retouchRemoveSource?.targetMaskId !== 'layer-remove-target' ||
  masks[0]?.retouchRemoveSource?.searchRadiusMultiplier !== 4
) {
  throw new Error(
    'Expected remove layer creation to preserve local patch-fill metadata through command, sidecar, and UI masks.',
  );
}
const updatedRemove = run('update_remove_source', {
  layerId: 'layer-remove',
  retouchRemoveSource: {
    ...removeLayer.retouchRemoveSource,
    seed: 3,
    status: 'needs_regeneration',
  },
  type: 'updateRetouchRemoveSource',
});
if (
  updatedRemove.command.commandType !== 'layerMask.updateRetouchRemoveSource' ||
  updatedRemove.sidecar.layers[0]?.retouchRemoveSource?.seed !== 3 ||
  masks[0]?.retouchRemoveSource?.seed !== 3
) {
  throw new Error('Expected remove source edits to roundtrip through command, sidecar, and UI masks.');
}
const resolvedRemove = applyResolvedRemoveSourcesToLayerStack(
  masks,
  [
    {
      layerId: 'layer-remove',
      resolvedSourcePoint: { x: 0.22, y: 0.44 },
      status: 'ready',
      targetMaskId: 'layer-remove-target',
    },
  ],
  { ...context, operationId: 'resolve_remove_source' },
);
masks = resolvedRemove.masks;
context = { ...context, graphRevision: resolvedRemove.graphRevision, operationId: 'resolve_remove_source' };
if (
  resolvedRemove.appliedLayerIds[0] !== 'layer-remove' ||
  resolvedRemove.sidecar.layers[0]?.retouchRemoveSource?.resolvedSourcePoint?.x !== 0.22 ||
  resolvedRemove.sidecar.layers[0]?.retouchRemoveSource?.status !== 'ready' ||
  masks[0]?.retouchRemoveSource?.resolvedSourcePoint?.y !== 0.44
) {
  throw new Error('Expected resolved remove source metadata to persist through command bridge state.');
}
const unchangedRemove = applyResolvedRemoveSourcesToLayerStack(
  masks,
  [
    {
      layerId: 'layer-remove',
      resolvedSourcePoint: { x: 0.22, y: 0.44 },
      status: 'ready',
      targetMaskId: 'layer-remove-target',
    },
  ],
  { ...context, operationId: 'resolve_remove_source_again' },
);
if (unchangedRemove.appliedLayerIds.length !== 0 || unchangedRemove.graphRevision !== context.graphRevision) {
  throw new Error('Expected unchanged resolved remove source metadata to be a no-op.');
}
const fallbackRemove = applyResolvedRemoveSourcesToLayerStack(
  masks,
  [
    {
      layerId: 'layer-remove',
      status: 'fallback_unchanged',
      targetMaskId: 'layer-remove-target',
    },
  ],
  { ...context, operationId: 'fallback_remove_source' },
);
masks = fallbackRemove.masks;
context = { ...context, graphRevision: fallbackRemove.graphRevision, operationId: 'fallback_remove_source' };
if (
  fallbackRemove.appliedLayerIds[0] !== 'layer-remove' ||
  fallbackRemove.sidecar.layers[0]?.retouchRemoveSource?.resolvedSourcePoint !== undefined ||
  fallbackRemove.sidecar.layers[0]?.retouchRemoveSource?.status !== 'fallback_unchanged' ||
  masks[0]?.retouchRemoveSource?.resolvedSourcePoint !== undefined
) {
  throw new Error('Expected fallback remove source metadata to clear persisted source point.');
}
run('delete_remove', { layerId: 'layer-remove', type: 'delete' });

const actualFinalLayers = layerSummarySchema.array().parse(summarize(masks));
if (JSON.stringify(actualFinalLayers) !== JSON.stringify(expectedFinalLayers)) {
  console.error('Expected:', JSON.stringify(expectedFinalLayers));
  console.error('Actual:', JSON.stringify(actualFinalLayers));
  process.exit(1);
}

if (!context.graphRevision.includes('delete_clone')) {
  throw new Error('Expected graph revision to advance after bridge dispatch.');
}

console.log(`layer stack command bridge ok (${actualFinalLayers.length} layers)`);
