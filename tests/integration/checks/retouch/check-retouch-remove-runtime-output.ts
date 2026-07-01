#!/usr/bin/env bun

import {
  renderLayerExportStack,
  renderLayerPreviewStack,
} from '../../../../packages/rawengine-schema/src/layerBlendRuntime.ts';

const pixelCount = 49;
const hashPattern = /^fnv1a32:[0-9a-f]{8}$/u;
const basePixels = Array.from({ length: pixelCount }, (_, index) => {
  const x = index % 7;
  const y = Math.floor(index / 7);
  const blemish = x === 3 && y === 3 ? 48 : 0;
  return {
    b: Math.max(0, ((37 + x * 13 + y * 5) % 256) - blemish),
    g: Math.max(0, ((19 + x * 7 + y * 17) % 256) - blemish),
    r: Math.max(0, ((61 + x * 23 + y * 11) % 256) - blemish),
  };
});

const targetMask = Array.from({ length: pixelCount }, (_, index) => {
  const x = index % 7;
  const y = Math.floor(index / 7);
  const distance = Math.hypot(x - 3, y - 3);
  if (distance <= 1) return 1;
  if (distance >= 2) return 0;
  return 2 - distance;
});
const removeTargetMask = Array.from({ length: pixelCount }, (_, index) => (index === 24 || index === 25 ? 1 : 0));

const renderRetouch = (mode: 'heal' | 'remove') =>
  renderLayerPreviewStack({
    basePixels,
    height: 7,
    layers: [
      {
        blendMode: 'normal',
        id: `retouch-${mode}-runtime`,
        maskAlpha: mode === 'remove' ? removeTargetMask : targetMask,
        name: `Retouch ${mode} runtime`,
        opacity: 1,
        ...(mode === 'heal'
          ? {
              retouchCloneSource: {
                featherRadiusPx: 2,
                radiusPx: 3,
                retouchMode: 'heal' as const,
                rotationDegrees: 0,
                scale: 1,
                sourcePoint: { x: 1 / 6, y: 3 / 6 },
                targetPoint: { x: 3 / 6, y: 3 / 6 },
              },
            }
          : {
              retouchRemoveSource: {
                featherRadiusPx: 2,
                generator: 'local_patch_fill_v1' as const,
                generatorVersion: 1 as const,
                radiusPx: 1,
                searchRadiusMultiplier: 2,
                seed: 1,
                status: 'needs_regeneration' as const,
                targetMaskId: 'retouch-remove-mask',
              },
            }),
        visible: true,
      },
    ],
    width: 7,
  });

const healPreview = renderRetouch('heal');
const healExport = renderLayerExportStack({
  basePixels,
  height: 7,
  layers: [
    {
      blendMode: 'normal',
      id: 'retouch-heal-runtime',
      maskAlpha: targetMask,
      name: 'Retouch heal runtime',
      opacity: 1,
      retouchCloneSource: {
        featherRadiusPx: 2,
        radiusPx: 3,
        retouchMode: 'heal',
        rotationDegrees: 0,
        scale: 1,
        sourcePoint: { x: 1 / 6, y: 3 / 6 },
        targetPoint: { x: 3 / 6, y: 3 / 6 },
      },
      visible: true,
    },
  ],
  width: 7,
});
const removePreview = renderRetouch('remove');
const removeDisabledPreview = renderLayerPreviewStack({
  basePixels,
  height: 7,
  layers: [
    {
      blendMode: 'normal',
      id: 'retouch-remove-runtime',
      maskAlpha: removeTargetMask,
      name: 'Retouch remove runtime',
      opacity: 1,
      retouchRemoveSource: {
        featherRadiusPx: 2,
        generator: 'local_patch_fill_v1',
        generatorVersion: 1,
        provenance: {
          algorithmId: 'local_patch_fill_v1',
          changedPixelCount: 1,
          editableLayer: true,
          featherRadiusPx: 2,
          maskAlphaHash: 'fnv1a32:00000000',
          mode: 'remove',
          outputHash: 'fnv1a32:00000000',
          proofSource: 'mask_aware_retouch_runtime_fixture_v1',
          provenanceVersion: 1,
          radiusPx: 1,
          targetMaskId: 'retouch-remove-mask',
          targetPoint: { x: 0.5, y: 0.5 },
        },
        radiusPx: 1,
        searchRadiusMultiplier: 2,
        seed: 1,
        status: 'ready',
        targetMaskId: 'retouch-remove-mask',
      },
      visible: false,
    },
  ],
  width: 7,
});
const healDelta = healPreview.outputDeltaByLayer[0];
const healApplyDelta = healExport.outputDeltaByLayer[0];
const removeDelta = removePreview.outputDeltaByLayer[0];
const removeSource = removePreview.resolvedRemoveSources[0];

if (healDelta?.status !== 'changed' || healDelta.changedPixelCount <= 0 || healDelta.meanAbsDelta <= 0) {
  throw new Error('Heal preview did not record changed runtime output.');
}
if (JSON.stringify(healDelta) !== JSON.stringify(healApplyDelta)) {
  throw new Error('Heal preview/apply output delta receipts diverged.');
}
if (healDelta.maskAware !== true || !hashPattern.test(healDelta.maskAlphaHash) || healDelta.touchedPixels < 9) {
  throw new Error('Heal output proof did not record mask-aware provenance.');
}
if (healDelta.featherEdgeSmoothness <= 0 || healDelta.maskRegionChangedPixelRatio <= 0) {
  throw new Error('Heal output proof did not record mask-region and feather metrics.');
}
if (
  removeDelta?.status !== 'changed' ||
  removeDelta.changedPixelCount <= 0 ||
  removeDelta.targetMaskId !== 'retouch-remove-mask' ||
  removeSource?.status !== 'ready' ||
  removeSource.resolvedSourcePoint === undefined
) {
  throw new Error('Remove preview did not record changed output and resolved mask-aware source provenance.');
}
if (
  removeDisabledPreview.outputDeltaByLayer.length !== 0 ||
  JSON.stringify(removeDisabledPreview.pixels) !== JSON.stringify(basePixels)
) {
  throw new Error('Disabling editable retouch remove layer did not revert runtime output to the base pixels.');
}

const noOpPreview = renderLayerPreviewStack({
  basePixels,
  height: 7,
  layers: [
    {
      blendMode: 'normal',
      id: 'retouch-no-op-runtime',
      maskAlpha: targetMask,
      name: 'Retouch no-op runtime',
      opacity: 1,
      retouchCloneSource: {
        featherRadiusPx: 0,
        radiusPx: 3,
        retouchMode: 'clone',
        rotationDegrees: 0,
        scale: 1,
        sourcePoint: { x: 3 / 6, y: 3 / 6 },
        targetPoint: { x: 3 / 6, y: 3 / 6 },
      },
      visible: true,
    },
  ],
  width: 7,
});
const noOpDelta = noOpPreview.outputDeltaByLayer[0];
if (noOpDelta?.status !== 'no_op' || noOpDelta.changedPixelCount !== 0 || noOpDelta.touchedPixels <= 0) {
  throw new Error('Retouch runtime did not distinguish no-op output from touched mask coverage.');
}

console.log(
  `retouch remove runtime output ok (heal changed=${healDelta.changedPixelCount}, remove changed=${removeDelta.changedPixelCount})`,
);
