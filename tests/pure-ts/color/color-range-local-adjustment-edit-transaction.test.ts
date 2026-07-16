import { afterEach, describe, expect, test } from 'bun:test';

import { readLayerStackSidecarsFromSidecar } from '../../../packages/rawengine-schema/src';
import { useEditorStore } from '../../../src/store/useEditorStore';
import { selectEditDocumentAiPatches, selectEditDocumentMasks } from '../../../src/utils/editDocumentSelectors';
import { createDefaultEditDocumentV2 } from '../../../src/utils/editDocumentV2';
import {
  applyColorRangeLocalAdjustmentLayerFlow,
  buildColorRangeProposalSourcePixels,
  createColorRangeLocalAdjustmentLayerDraft,
} from '../../../src/utils/layers/colorRangeLocalAdjustmentCommandFlow';
import { buildLayerEditTransactionRequest } from '../../../src/utils/layers/layerEditTransaction';
import { persistLayerStackSidecarInEditDocumentCandidate } from '../../../src/utils/layers/layerStackSidecarAdjustments';
import { createColorRangeMaskParameters } from '../../../src/utils/mask/colorRangeMaskParameters';

const imagePath = '/fixtures/color-range-transaction.ARW';

const seedStore = () => {
  const editDocumentV2 = createDefaultEditDocumentV2();
  useEditorStore.getState().hydrateEditorRenderAuthority({
    activeMaskContainerId: null,
    activeMaskId: null,
    adjustmentRevision: 0,
    finalPreviewUrl: 'blob:color-range-before',
    historyCheckpoints: [],
    historyIndex: 0,
    imageSession: null,
    imageSessionId: 17,
    lastEditApplicationReceipt: null,
    transformedOriginalUrl: 'blob:color-range-original',
    editDocumentV2,
    history: [editDocumentV2],
  });
};

const buildColorRangeAdjustments = (operationId: string) => {
  const state = useEditorStore.getState();
  const parameters = createColorRangeMaskParameters('oranges', {
    centerHueDegrees: 34,
    feather: 0.42,
    hueToleranceDegrees: 24,
  });
  const layer = createColorRangeLocalAdjustmentLayerDraft({
    layerId: 'color-range-layer',
    maskId: 'color-range-mask',
    maskName: 'Oranges range mask',
    name: 'Oranges local adjustment',
    parameters,
  });
  const flow = applyColorRangeLocalAdjustmentLayerFlow(selectEditDocumentMasks(state.editDocumentV2), {
    colorRangeParameters: parameters,
    context: {
      graphRevision: `history_${String(state.historyIndex)}`,
      imagePath,
      operationId,
      sessionId: 'color-range-transaction-test',
    },
    imageSize: { height: 8, width: 8 },
    layer,
    maskName: 'Oranges range mask',
    sourceRgbPixels: buildColorRangeProposalSourcePixels('oranges'),
    toneColor: {
      blackPoint: 0,
      clarity: 0,
      contrast: 0,
      exposureEv: 0.18,
      highlights: 0,
      saturation: 18,
      shadows: 0,
      whitePoint: 0,
    },
  });

  return persistLayerStackSidecarInEditDocumentCandidate(state.editDocumentV2, flow.masks, flow.toneResult.sidecar);
};

afterEach(seedStore);

describe('Color range local adjustment EditTransaction boundary', () => {
  test('commits the layer and its source artifact through one revision and history boundary', () => {
    seedStore();
    const state = useEditorStore.getState();
    const transaction = buildLayerEditTransactionRequest(
      state,
      buildColorRangeAdjustments('color-range-commit'),
      'color-range-commit',
    );
    const result = state.applyEditTransaction(transaction);
    const committed = useEditorStore.getState();

    expect(result).toMatchObject({
      imageSessionId: 'editor-image-session:17',
      nextAdjustmentRevision: 1,
      noOp: false,
      source: 'layer-command',
      transactionId: 'color-range-commit',
    });
    expect(result.invalidatedStages).toEqual(['preview', 'navigator', 'thumbnail']);
    expect(committed.history).toHaveLength(2);
    expect(committed.historyIndex).toBe(1);
    expect(committed.adjustmentRevision).toBe(1);
    expect(committed.lastEditApplicationReceipt).toMatchObject({
      adjustmentRevision: 1,
      baseAdjustmentRevision: 0,
      persistence: 'commit',
      transactionId: 'color-range-commit',
    });
    expect(committed.finalPreviewUrl).toBeNull();
    expect(committed.transformedOriginalUrl).toBeNull();
    expect(committed.editDocumentV2.layers.masks.map((mask) => mask.id)).toEqual(['color-range-layer']);
    expect(readLayerStackSidecarsFromSidecar(committed.editDocumentV2.extensions)).toMatchObject([
      { sourceImagePath: imagePath },
    ]);
  });

  test('an exact no-op preserves history, revision, receipt, and current pixels', () => {
    seedStore();
    const first = useEditorStore.getState();
    first.applyEditTransaction(
      buildLayerEditTransactionRequest(first, buildColorRangeAdjustments('color-range-first'), 'color-range-first'),
    );
    useEditorStore.setState({ finalPreviewUrl: 'blob:color-range-current' });
    const current = useEditorStore.getState();
    const result = current.applyEditTransaction(
      buildLayerEditTransactionRequest(
        current,
        {
          aiPatches: selectEditDocumentAiPatches(current.editDocumentV2),
          masks: selectEditDocumentMasks(current.editDocumentV2),
          rawEngineArtifacts: current.editDocumentV2.extensions['rawEngineArtifacts'],
        },
        'color-range-no-op',
      ),
    );
    const committed = useEditorStore.getState();

    expect(result.noOp).toBe(true);
    expect(result.invalidatedStages).toEqual([]);
    expect(committed.adjustmentRevision).toBe(1);
    expect(committed.history).toHaveLength(2);
    expect(committed.lastEditApplicationReceipt?.transactionId).toBe('color-range-first');
    expect(committed.finalPreviewUrl).toBe('blob:color-range-current');
  });

  test('rejects a stale color-range proposal without publishing its layer artifact', () => {
    seedStore();
    const base = useEditorStore.getState();
    const stale = buildLayerEditTransactionRequest(
      base,
      buildColorRangeAdjustments('color-range-stale'),
      'color-range-stale',
    );
    base.applyEditTransaction({
      baseAdjustmentRevision: base.adjustmentRevision,
      history: 'single-entry',
      imageSessionId: 'editor-image-session:17',
      operations: [{ nodeType: 'scene_global_color_tone', patch: { exposure: 0.5 }, type: 'patch-edit-document-node' }],
      persistence: 'commit',
      source: 'manual-control',
      transactionId: 'newer-editor-transaction',
    });

    expect(() => useEditorStore.getState().applyEditTransaction(stale)).toThrow('edit_transaction.stale_base:0:1');
    const committed = useEditorStore.getState();
    expect(committed.editDocumentV2.nodes['scene_global_color_tone']!.params['exposure']).toBe(0.5);
    expect(committed.editDocumentV2.layers.masks).toEqual([]);
    expect(readLayerStackSidecarsFromSidecar(committed.editDocumentV2.extensions)).toEqual([]);
  });
});
