#!/usr/bin/env bun

import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import {
  dispatchLayerStackCommand,
  type LayerRgbPixel,
  type LayerScopedToneAdjustmentV1,
  renderLayerScopedToneStack,
} from '../../../../packages/rawengine-schema/src';
import { Mask } from '../../../../src/components/panel/right/layers/Masks.tsx';
import { INITIAL_MASK_ADJUSTMENTS, type MaskContainer } from '../../../../src/utils/adjustments.ts';
import {
  type EditHistoryState,
  pushEditHistoryEntry,
  redoEditHistory,
  undoEditHistory,
} from '../../../../src/utils/editHistory.ts';
import {
  applyBrushLocalAdjustmentLayerFlow,
  createBrushLocalAdjustmentLayerDraft,
  readBrushLocalAdjustmentReceipt,
} from '../../../../src/utils/layers/brushLocalAdjustmentCommandFlow.ts';
import { buildLayerStackSidecarFromMasks } from '../../../../src/utils/layers/layerStackCommandBridge.ts';

const OUTPUT_DIR = 'artifacts/layers/layer-brush-local-adjustment-runtime';
const imagePath = '/Users/cgas/Pictures/Capture One/Alaska/RAWENGINE_LAYER_BRUSH_LOCAL.CR3';
const imageSize = { height: 80, width: 120 };
const layerId = 'layer_brush_local_adjustment';
const maskId = 'layer_brush_local_adjustment_mask';
const brushParameters = {
  lines: [
    {
      feather: 48,
      points: [
        { pressure: 0.8, x: 24, y: 24 },
        { pressure: 0.9, x: 46, y: 32 },
        { pressure: 0.75, x: 70, y: 38 },
      ],
      size: 18,
      tool: 'brush' as const,
    },
    {
      feather: 36,
      points: [
        { pressure: 0.7, x: 36, y: 52 },
        { pressure: 0.85, x: 58, y: 56 },
        { pressure: 0.72, x: 84, y: 52 },
      ],
      size: 14,
      tool: 'brush' as const,
    },
  ],
};
const toneColor: LayerScopedToneAdjustmentV1 = {
  blackPoint: 3,
  clarity: 10,
  contrast: 16,
  exposureEv: 0.42,
  highlights: -12,
  saturation: 8,
  shadows: 18,
  whitePoint: 4,
};

const basePixels: Array<LayerRgbPixel> = Array.from({ length: 12 }, (_, index) => ({
  b: 42 + index * 11,
  g: 48 + index * 10,
  r: 54 + index * 9,
}));

const layer = {
  ...createBrushLocalAdjustmentLayerDraft({
    layerId,
    maskId,
    maskName: 'Subject brush',
    name: 'Subject brush lift',
  }),
  subMasks: [
    {
      ...createBrushLocalAdjustmentLayerDraft({
        layerId,
        maskId,
        maskName: 'Subject brush',
        name: 'Subject brush lift',
      }).subMasks[0]!,
      parameters: brushParameters,
    },
  ],
} satisfies MaskContainer;

const initialMasks: Array<MaskContainer> = [
  {
    adjustments: structuredClone(INITIAL_MASK_ADJUSTMENTS),
    blendMode: 'normal',
    id: 'existing_layer',
    invert: false,
    name: 'Existing global dodge',
    opacity: 55,
    subMasks: [],
    visible: true,
  },
];
const result = applyBrushLocalAdjustmentLayerFlow(initialMasks, {
  brushMaskName: 'Subject brush',
  brushParameters,
  context: {
    graphRevision: 'layer_brush_local_initial',
    imagePath,
    operationId: 'layer_brush_local_adjustment',
    sessionId: 'layer-brush-local-adjustment-runtime',
  },
  imageSize,
  layer,
  toneColor,
});

const createdLayer = result.masks.find((candidate) => candidate.id === layerId);
const createdBrush = createdLayer?.subMasks.find((candidate) => candidate.id === maskId);
if (createdLayer === undefined || createdBrush === undefined) {
  throw new Error('Brush local adjustment flow did not create the expected layer and brush mask.');
}
if (
  createdLayer.adjustments.exposure !== toneColor.exposureEv ||
  createdLayer.adjustments.shadows !== toneColor.shadows
) {
  throw new Error('Brush local adjustment flow did not persist layer-scoped tone adjustments.');
}
if (createdBrush.type !== Mask.Brush || createdBrush.visible !== true) {
  throw new Error('Brush local adjustment flow did not create a visible brush sub-mask.');
}
if (!result.brushApplyResult.changedMaskIds[0]?.startsWith('mask_brush_')) {
  throw new Error('Brush local adjustment flow did not report the brush mask mutation.');
}
if (result.toneResult.commandResult.changedLayerIds[0] !== layerId) {
  throw new Error('Brush local adjustment flow did not report the layer-scoped tone mutation.');
}
if (result.attachMaskResult.commandResult.changedMaskIds[0] !== maskId) {
  throw new Error('Brush local adjustment flow did not report the typed attach-mask mutation.');
}

const receipt = readBrushLocalAdjustmentReceipt(createdBrush.parameters);
if (
  receipt === null ||
  receipt.layerId !== layerId ||
  receipt.brushMaskId !== maskId ||
  receipt.brushStrokeCount !== 2 ||
  receipt.imagePath !== imagePath ||
  receipt.rollbackGraphRevision !== 'layer_brush_local_initial' ||
  receipt.beforePreviewHash === receipt.afterPreviewHash
) {
  throw new Error('Brush local adjustment receipt is missing required replay, rollback, or preview hash metadata.');
}

const initialHistory: EditHistoryState<Array<MaskContainer>> = {
  adjustments: initialMasks,
  history: [initialMasks],
  historyIndex: 0,
};
const pushed = pushEditHistoryEntry(initialHistory.history, initialHistory.historyIndex, result.masks);
let historyState: EditHistoryState<Array<MaskContainer>> = {
  adjustments: result.masks,
  history: pushed.history,
  historyIndex: pushed.historyIndex,
};
historyState = undoEditHistory(historyState);
if (historyState.adjustments.some((candidate) => candidate.id === layerId)) {
  throw new Error('Brush local adjustment undo did not restore the previous layer stack.');
}
historyState = redoEditHistory(historyState);
if (!historyState.adjustments.some((candidate) => candidate.id === layerId)) {
  throw new Error('Brush local adjustment redo did not restore the created brush layer.');
}

const initialSidecar = buildLayerStackSidecarFromMasks(initialMasks, {
  graphRevision: 'layer_brush_local_initial',
  imagePath,
  operationId: 'layer_brush_local_replay_initial',
  sessionId: 'layer-brush-local-adjustment-runtime',
});
const createReplay = dispatchLayerStackCommand(result.createLayerResult.command, initialSidecar);
if (!('sidecar' in createReplay)) throw new Error('Brush local adjustment create-layer replay did not mutate sidecar.');
const preAttachMasks = result.createLayerResult.masks.map((mask) =>
  mask.id === layerId ? { ...mask, subMasks: [] } : mask,
);
const preAttachSidecar = buildLayerStackSidecarFromMasks(preAttachMasks, {
  graphRevision: result.brushApplyResult.appliedGraphRevision,
  imagePath,
  operationId: 'layer_brush_local_replay_attach',
  sessionId: 'layer-brush-local-adjustment-runtime',
});
const attachReplay = dispatchLayerStackCommand(result.attachMaskResult.command, preAttachSidecar);
if (!('sidecar' in attachReplay)) throw new Error('Brush local adjustment attach-mask replay did not mutate sidecar.');
if (!attachReplay.sidecar.layers.some((sidecarLayer) => sidecarLayer.maskIds.includes(maskId))) {
  throw new Error('Brush local adjustment attach replay did not bind mask id to sidecar.');
}
const preToneSidecar = buildLayerStackSidecarFromMasks(result.attachMaskResult.masks, {
  graphRevision: result.attachMaskResult.graphRevision,
  imagePath,
  operationId: 'layer_brush_local_replay_tone',
  sessionId: 'layer-brush-local-adjustment-runtime',
});
const toneReplay = dispatchLayerStackCommand(result.toneResult.command, preToneSidecar);
if (!('sidecar' in toneReplay)) throw new Error('Brush local adjustment tone replay did not mutate sidecar.');
const omitPersistedSubMaskPayloads = (layers: typeof toneReplay.sidecar.layers) =>
  layers.map(({ subMasks: _subMasks, ...persistedLayerGraph }) => persistedLayerGraph);
if (
  JSON.stringify(omitPersistedSubMaskPayloads(toneReplay.sidecar.layers)) !==
  JSON.stringify(omitPersistedSubMaskPayloads(result.toneResult.sidecar.layers))
) {
  throw new Error('Brush local adjustment tone replay did not reproduce sidecar layer state.');
}

const rendered = renderLayerScopedToneStack({
  basePixels,
  height: 3,
  sidecar: result.toneResult.sidecar,
  width: 4,
});
if (rendered.previewHash === rendered.sourceHash || rendered.changedPixelCount === 0) {
  throw new Error('Brush local adjustment tone render did not alter preview pixels.');
}
if (rendered.previewHash !== rendered.exportHash || rendered.previewHash !== rendered.headlessHash) {
  throw new Error('Brush local adjustment preview/export/headless hashes diverged.');
}
if (!result.toneResult.sidecar.layers.some((sidecarLayer) => sidecarLayer.maskIds.includes(maskId))) {
  throw new Error('Brush local adjustment sidecar did not bind the brush mask id to the layer.');
}

await mkdir(OUTPUT_DIR, { recursive: true });
await writeFile(
  resolve(OUTPUT_DIR, 'layer-brush-local-adjustment-report.json'),
  `${JSON.stringify(
    {
      afterPreviewHash: receipt.afterPreviewHash,
      beforePreviewHash: receipt.beforePreviewHash,
      brushContentHash: receipt.brushContentHash,
      brushMaskId: receipt.brushMaskId,
      changedPixelCount: rendered.changedPixelCount,
      graphRevision: receipt.graphRevision,
      layerId: receipt.layerId,
      previewHash: rendered.previewHash,
      rollbackGraphRevision: receipt.rollbackGraphRevision,
      strokeCount: receipt.brushStrokeCount,
      validationStatus: 'passed',
    },
    null,
    2,
  )}\n`,
);

console.log(`layer brush local adjustment runtime ok (${receipt.brushStrokeCount} strokes)`);
