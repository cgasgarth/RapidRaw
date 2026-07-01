#!/usr/bin/env bun

import { INITIAL_ADJUSTMENTS } from '../../../../src/utils/adjustments.ts';
import { buildColorStackPreviewExportParityReceipt } from '../../../../src/utils/colorStackPreviewExportParityReceipt.ts';
import {
  applyColorRangeLocalAdjustmentLayerFlow,
  buildColorRangeProposalSourcePixels,
  createColorRangeLocalAdjustmentLayerDraft,
  readColorRangeLocalAdjustmentReceipt,
} from '../../../../src/utils/layers/colorRangeLocalAdjustmentCommandFlow.ts';
import { materializeMasksFromLayerStackSidecar } from '../../../../src/utils/layers/layerStackCommandBridge.ts';
import { persistLayerStackSidecarInAdjustments } from '../../../../src/utils/layers/layerStackSidecarAdjustments.ts';
import { createColorRangeMaskParameters } from '../../../../src/utils/mask/colorRangeMaskParameters.ts';

const selectedImagePath = '/Users/cgas/Pictures/Capture One/Alaska/DSC_3163.ARW';
const sourceRgbPixels = buildColorRangeProposalSourcePixels('oranges');
const rangeParameters = createColorRangeMaskParameters('oranges', {
  centerHueDegrees: 34,
  feather: 0.42,
  hueToleranceDegrees: 24,
});
const layer = createColorRangeLocalAdjustmentLayerDraft({
  layerId: 'color_range_orange_layer',
  maskId: 'color_range_orange_mask',
  maskName: 'Oranges range mask',
  name: 'Oranges local adjustment',
  parameters: rangeParameters,
});
const toneColor = {
  blackPoint: 0,
  clarity: 0,
  contrast: 0,
  exposureEv: 0.18,
  highlights: -8,
  saturation: 18,
  shadows: 4,
  whitePoint: 0,
};
const context = {
  graphRevision: 'color_range_local_runtime_initial',
  imagePath: selectedImagePath,
  operationId: 'color_range_orange_local_adjustment',
  sessionId: 'check-color-range-local-adjustment-runtime',
};

const result = applyColorRangeLocalAdjustmentLayerFlow([], {
  colorRangeParameters: rangeParameters,
  context,
  imageSize: { height: 8, width: 8 },
  layer,
  maskName: 'Oranges range mask',
  sourceRgbPixels,
  toneColor,
});

const createdLayer = result.masks.find((candidate) => candidate.id === layer.id);
if (createdLayer === undefined) throw new Error('Color range local adjustment did not create a layer.');
if (createdLayer.subMasks.length !== 1 || createdLayer.subMasks[0]?.type !== 'color') {
  throw new Error('Color range local adjustment did not attach a color sub-mask.');
}
if (createdLayer.adjustments.saturation !== toneColor.saturation || createdLayer.adjustments.exposure !== 0.18) {
  throw new Error('Color range local adjustment did not apply layer-scoped tone/color adjustments.');
}

const receipt = readColorRangeLocalAdjustmentReceipt(createdLayer.subMasks[0]?.parameters);
if (receipt === null) throw new Error('Color range local adjustment receipt was not persisted on the sub-mask.');
if (
  receipt.sourceRangeKey !== 'oranges' ||
  receipt.selectedImagePath !== selectedImagePath ||
  receipt.colorRangeContentHash !== result.colorRangeDryRunResult.maskArtifacts[0]?.contentHash ||
  receipt.maskStats.nonzeroAlphaRatio <= 0 ||
  receipt.beforePreviewHash === receipt.afterPreviewHash
) {
  throw new Error('Color range local adjustment receipt did not capture source range, hashes, and mask coverage.');
}
if (
  result.createLayerResult.command.commandType !== 'layerMask.createLayer' ||
  result.colorRangeApplyResult.commandType !== 'layerMask.createRangeMask' ||
  result.attachMaskResult.command.commandType !== 'layerMask.attachMask' ||
  result.toneResult.command.commandType !== 'layerMask.applyLayerAdjustment'
) {
  throw new Error('Color range local adjustment did not use the layer/mask command surface.');
}

const persistedAdjustments = persistLayerStackSidecarInAdjustments(
  { ...INITIAL_ADJUSTMENTS, masks: result.masks },
  result.toneResult.sidecar,
);
const replayedMasks = materializeMasksFromLayerStackSidecar(result.toneResult.sidecar, result.masks);
const replayedLayer = replayedMasks.find((candidate) => candidate.id === layer.id);
if (replayedLayer === undefined || replayedLayer.subMasks[0]?.id !== 'color_range_orange_mask') {
  throw new Error('Color range local adjustment layer/mask did not replay from the sidecar.');
}

const replayResult = applyColorRangeLocalAdjustmentLayerFlow([], {
  colorRangeParameters: receipt.sourceColorRangeParameters,
  context,
  imageSize: { height: 8, width: 8 },
  layer,
  maskName: 'Oranges range mask',
  sourceRgbPixels,
  toneColor,
});
if (replayResult.receipt.replayKey !== receipt.replayKey) {
  throw new Error('Color range local adjustment replay depends on transient Color panel state.');
}

const parityReceipt = buildColorStackPreviewExportParityReceipt({
  adjustments: {
    ...INITIAL_ADJUSTMENTS,
    hsl: {
      ...INITIAL_ADJUSTMENTS.hsl,
      oranges: { hue: 0, luminance: 18, saturation: 18 },
    },
    selectiveColorRangeControls: {
      ...INITIAL_ADJUSTMENTS.selectiveColorRangeControls,
      oranges: {
        centerHueDegrees: 34,
        falloffSmoothness: 1.68,
        widthDegrees: 48,
      },
    },
  },
  exportOutput: {
    byteSize: 24_576,
    colorProfile: 'sRGB IEC61966-2.1',
    effectiveColorProfile: 'sRGB IEC61966-2.1',
    effectiveRenderingIntent: 'relative_colorimetric',
    format: 'jpeg',
    outputPath: '/tmp/rawengine-color-range-local-adjustment.jpg',
    requestedColorProfile: 'sRGB IEC61966-2.1',
    requestedRenderingIntent: 'relative_colorimetric',
    sourcePath: selectedImagePath,
    transformApplied: true,
  },
  exportSoftProofTransform: {
    effectiveColorProfile: 'sRGB IEC61966-2.1',
    effectiveRenderingIntent: 'relative_colorimetric',
  },
  isExportSoftProofEnabled: true,
});
if (parityReceipt.status !== 'matched' || parityReceipt.components.selectiveColorRangeCount !== 1) {
  throw new Error('Color range local adjustment did not keep preview/export parity evidence meaningful.');
}
if (persistedAdjustments.rawEngineArtifacts === undefined) {
  throw new Error('Color range local adjustment did not persist layer stack sidecar artifacts.');
}
if (selectedImagePath !== context.imagePath) {
  throw new Error('Color range local adjustment changed the selected RAW path.');
}

console.log(
  `Color range local adjustment runtime ok: ${receipt.sourceRangeKey} ${receipt.colorRangeContentHash} ${receipt.graphRevision}`,
);
