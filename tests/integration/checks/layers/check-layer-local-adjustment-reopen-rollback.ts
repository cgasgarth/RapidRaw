#!/usr/bin/env bun

import { INITIAL_ADJUSTMENTS } from '../../../../src/utils/adjustments.ts';
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
import {
  hydrateLayerStackMasksFromMetadata,
  persistLayerStackSidecarInAdjustments,
} from '../../../../src/utils/layers/layerStackSidecarAdjustments.ts';

const imagePath = '/Users/cgas/Pictures/Capture One/Alaska/RAWENGINE_LAYER_GRAPH_REOPEN.CR3';
const layerId = 'layer_local_reopen_subject';
const maskId = 'mask_local_reopen_subject_brush';

const localAdjustment = applyBrushLocalAdjustmentLayerFlow([], {
  brushMaskName: 'Subject reopen brush',
  brushParameters: {
    lines: [
      {
        feather: 32,
        points: [
          { pressure: 0.75, x: 12, y: 16 },
          { pressure: 0.9, x: 24, y: 22 },
          { pressure: 0.8, x: 36, y: 28 },
        ],
        size: 18,
        tool: 'brush',
      },
    ],
  },
  context: {
    graphRevision: 'layer_graph_reopen_initial',
    imagePath,
    operationId: 'layer_graph_reopen_local_adjustment',
    sessionId: 'check-layer-local-adjustment-reopen-rollback',
  },
  imageSize: { height: 48, width: 64 },
  layer: createBrushLocalAdjustmentLayerDraft({
    layerId,
    maskId,
    maskName: 'Subject reopen brush',
    name: 'Subject reopen lift',
  }),
  toneColor: {
    blackPoint: 1,
    clarity: 7,
    contrast: 11,
    exposureEv: 0.35,
    highlights: -6,
    saturation: 5,
    shadows: 14,
    whitePoint: 2,
  },
});

const persistedAdjustments = persistLayerStackSidecarInAdjustments(
  { ...INITIAL_ADJUSTMENTS, masks: localAdjustment.masks },
  localAdjustment.toneResult.sidecar,
);
const persistedArtifacts = (
  persistedAdjustments as typeof persistedAdjustments & {
    rawEngineArtifacts?: unknown;
  }
).rawEngineArtifacts;

const assertReopenedGraph = (label: string, reopenedAdjustments: typeof INITIAL_ADJUSTMENTS) => {
  const reopenedLayer = reopenedAdjustments.masks.find((mask) => mask.id === layerId);
  const reopenedBrush = reopenedLayer?.subMasks.find((subMask) => subMask.id === maskId);
  const receipt = readBrushLocalAdjustmentReceipt(reopenedBrush?.parameters);

  if (reopenedLayer === undefined || reopenedBrush === undefined) {
    throw new Error(`${label}: reopened local adjustment layer graph was not materialized.`);
  }
  if (receipt === null || receipt.rollbackGraphRevision !== 'layer_graph_reopen_initial') {
    throw new Error(`${label}: reopened local adjustment is missing rollback provenance.`);
  }
  if (reopenedLayer.adjustments.exposure !== 0.35 || reopenedLayer.adjustments.shadows !== 14) {
    throw new Error(`${label}: reopened local adjustment lost layer-scoped tone state.`);
  }
  if (reopenedBrush.parameters === undefined) {
    throw new Error(`${label}: reopened brush mask metadata is missing.`);
  }
};

const reopenedFromRootMetadata = hydrateLayerStackMasksFromMetadata(
  { ...INITIAL_ADJUSTMENTS, masks: [] },
  { rawEngineArtifacts: persistedArtifacts },
  imagePath,
);
assertReopenedGraph('root metadata sidecar reopen', reopenedFromRootMetadata);

const reopenedFromAdjustmentSnapshot = hydrateLayerStackMasksFromMetadata(
  { ...INITIAL_ADJUSTMENTS, masks: [] },
  {
    adjustments: {
      ...INITIAL_ADJUSTMENTS,
      masks: [],
      rawEngineArtifacts: persistedArtifacts,
    },
  },
  imagePath,
);
assertReopenedGraph('adjustment snapshot sidecar reopen', reopenedFromAdjustmentSnapshot);

let rollbackState: EditHistoryState<typeof INITIAL_ADJUSTMENTS> = {
  adjustments: { ...INITIAL_ADJUSTMENTS, exposure: 0.1 },
  history: [{ ...INITIAL_ADJUSTMENTS, exposure: 0.1 }],
  historyIndex: 0,
};
const pushed = pushEditHistoryEntry(rollbackState.history, rollbackState.historyIndex, reopenedFromRootMetadata);
rollbackState = { ...rollbackState, ...pushed, adjustments: reopenedFromRootMetadata };
rollbackState = undoEditHistory(rollbackState);
if (rollbackState.adjustments.masks.some((mask) => mask.id === layerId) || rollbackState.adjustments.exposure !== 0.1) {
  throw new Error('Rollback did not restore the previous pre-layer graph adjustment state.');
}
rollbackState = redoEditHistory(rollbackState);
assertReopenedGraph('redo after rollback', rollbackState.adjustments);

const invalidLayerStack = {
  ...structuredClone(localAdjustment.toneResult.sidecar),
  layers: localAdjustment.toneResult.sidecar.layers.map((layer, index) => {
    if (index !== 0) return structuredClone(layer);
    const { name: _name, ...layerWithoutName } = structuredClone(layer);
    return layerWithoutName;
  }),
};
try {
  hydrateLayerStackMasksFromMetadata(
    { ...INITIAL_ADJUSTMENTS, masks: [] },
    { rawEngineArtifacts: { layerStackSidecars: [invalidLayerStack], schemaVersion: 1 } },
    imagePath,
  );
  throw new Error('Invalid layer graph metadata was accepted.');
} catch (error) {
  if (error instanceof Error && error.message === 'Invalid layer graph metadata was accepted.') {
    throw error;
  }
}

console.log(`layer local adjustment reopen/rollback ok (${layerId} ${localAdjustment.receipt.graphRevision})`);
