#!/usr/bin/env bun

import { Mask, SubMaskMode } from '../../../../src/components/panel/right/layers/Masks.tsx';
import { useUIStore } from '../../../../src/store/useUIStore.ts';
import {
  DEFAULT_LAYER_BLEND_MODE,
  INITIAL_MASK_ADJUSTMENTS,
  type MaskContainer,
} from '../../../../src/utils/adjustments.ts';
import {
  buildLayerMaskContentHash,
  buildLayerMaskLayerOrderHash,
  deriveLayerMaskProvenanceView,
} from '../../../../src/utils/layers/layerMaskProvenance.ts';

const expect = (condition: unknown, message: string): asserts condition => {
  if (!condition) {
    throw new Error(message);
  }
};

const createLayer = (id: string, opacity: number): MaskContainer => ({
  adjustments: structuredClone(INITIAL_MASK_ADJUSTMENTS),
  blendMode: DEFAULT_LAYER_BLEND_MODE,
  id,
  invert: false,
  name: id,
  opacity: 100,
  subMasks: [
    {
      id: `${id}_mask`,
      invert: false,
      mode: SubMaskMode.Additive,
      name: `${id} mask`,
      opacity,
      parameters: { feather: 0.5, seed: id },
      type: Mask.Brush,
      visible: true,
    },
  ],
  visible: true,
});

const baseMasks = [createLayer('layer_a', 100), createLayer('layer_b', 80)];

useUIStore.setState({
  layerMaskProvenanceReceipts: {},
  layerMaskSourceGraphRevision: 'layer_mask_graph_test_initial',
  layerMaskSourceGraphRevisionCounter: 0,
});

useUIStore.getState().recordLayerMaskPreviewReceipt({
  appliedCommandId: 'preview_before_mutation',
  masks: baseMasks,
});

const receiptBefore = useUIStore.getState().layerMaskProvenanceReceipts.layer_a;
expect(receiptBefore !== undefined, 'Layer A preview receipt was not stored.');

const currentBefore = deriveLayerMaskProvenanceView({
  layerId: 'layer_a',
  masks: baseMasks,
  receipt: receiptBefore,
  sourceGraphRevision: useUIStore.getState().layerMaskSourceGraphRevision,
});
expect(currentBefore.status === 'current', 'Stored preview receipt should start current.');

const alphaMutatedMasks = baseMasks.map((layer) =>
  layer.id === 'layer_a'
    ? {
        ...layer,
        subMasks: layer.subMasks.map((subMask) => ({ ...subMask, opacity: 42 })),
      }
    : layer,
);
const alphaMutatedLayer = alphaMutatedMasks.find((layer) => layer.id === 'layer_a');
expect(alphaMutatedLayer !== undefined, 'Alpha-mutated layer A is missing.');
useUIStore.getState().markLayerMaskProvenanceStale({ layerIds: ['layer_a'], reason: 'mask_alpha_changed' });

const staleByAlpha = deriveLayerMaskProvenanceView({
  layerId: 'layer_a',
  masks: alphaMutatedMasks,
  receipt: useUIStore.getState().layerMaskProvenanceReceipts.layer_a,
  sourceGraphRevision: useUIStore.getState().layerMaskSourceGraphRevision,
});
expect(staleByAlpha.status === 'needs_reapply', 'Mask alpha mutation should block stale apply/export parity.');
expect(
  staleByAlpha.receipt.staleReasons.includes('mask_alpha_changed'),
  'Mask alpha mutation should record mask_alpha_changed.',
);
expect(
  staleByAlpha.receipt.maskContentHash !== buildLayerMaskContentHash(alphaMutatedLayer),
  'Mask alpha mutation should change the current mask content hash.',
);

useUIStore.getState().recordLayerMaskPreviewReceipt({
  appliedCommandId: 'preview_after_alpha_mutation',
  masks: alphaMutatedMasks,
});
const refreshedAfterAlpha = deriveLayerMaskProvenanceView({
  layerId: 'layer_a',
  masks: alphaMutatedMasks,
  receipt: useUIStore.getState().layerMaskProvenanceReceipts.layer_a,
  sourceGraphRevision: useUIStore.getState().layerMaskSourceGraphRevision,
});
expect(refreshedAfterAlpha.status === 'current', 'Re-preview should clear mask alpha staleness.');

const reorderedMasks = [alphaMutatedMasks[1], alphaMutatedMasks[0]].filter(
  (layer): layer is MaskContainer => layer !== undefined,
);
useUIStore.getState().markLayerMaskProvenanceStale({ reason: 'layer_order_changed' });
const staleByOrder = deriveLayerMaskProvenanceView({
  layerId: 'layer_a',
  masks: reorderedMasks,
  receipt: useUIStore.getState().layerMaskProvenanceReceipts.layer_a,
  sourceGraphRevision: useUIStore.getState().layerMaskSourceGraphRevision,
});
expect(staleByOrder.status === 'needs_reapply', 'Layer reorder should make stored preview/export receipt stale.');
expect(
  staleByOrder.receipt.staleReasons.includes('layer_order_changed'),
  'Layer reorder should record layer_order_changed.',
);
expect(
  staleByOrder.receipt.layerOrderHash !== buildLayerMaskLayerOrderHash(reorderedMasks),
  'Layer reorder should change the current layer order hash.',
);

const proof = {
  afterAlpha: {
    invalidationReason: staleByAlpha.invalidationReason,
    maskContentHashAfter: buildLayerMaskContentHash(alphaMutatedLayer),
    receiptId: staleByAlpha.receipt.receiptId,
    staleReasons: staleByAlpha.receipt.staleReasons,
  },
  afterPreview: {
    receiptId: refreshedAfterAlpha.receipt.receiptId,
    status: refreshedAfterAlpha.status,
  },
  afterReorder: {
    invalidationReason: staleByOrder.invalidationReason,
    layerOrderHashAfter: buildLayerMaskLayerOrderHash(reorderedMasks),
    receiptId: staleByOrder.receipt.receiptId,
    staleReasons: staleByOrder.receipt.staleReasons,
  },
  before: {
    layerOrderHash: receiptBefore.layerOrderHash,
    maskContentHash: receiptBefore.maskContentHash,
    receiptId: receiptBefore.receiptId,
  },
};

console.log(JSON.stringify(proof, null, 2));
