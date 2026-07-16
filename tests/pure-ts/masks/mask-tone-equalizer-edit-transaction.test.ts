import { beforeEach, describe, expect, test } from 'bun:test';
import { editDocumentLayersV2Schema } from '../../../packages/rawengine-schema/src/editDocumentV2';

import { useEditorStore } from '../../../src/store/useEditorStore';
import {
  createDefaultMaskEditNodes,
  INITIAL_ADJUSTMENTS,
  INITIAL_MASK_ADJUSTMENTS,
  type MaskContainer,
} from '../../../src/utils/adjustments';
import { selectEditDocumentMasks } from '../../../src/utils/editDocumentSelectors';
import { createDefaultEditDocumentV2, patchEditDocumentV2Node } from '../../../src/utils/editDocumentV2';
import { applyMaskContainerAdjustmentCandidate } from '../../../src/utils/mask/maskContainerAdjustmentTransaction';

const layer: MaskContainer = {
  adjustments: structuredClone(INITIAL_MASK_ADJUSTMENTS),
  blendMode: 'normal',
  editNodes: createDefaultMaskEditNodes(),
  editNodeSchemaVersion: 1,
  id: 'tone-equalizer-layer',
  invert: false,
  name: 'Tone Equalizer layer',
  opacity: 100,
  subMasks: [],
  visible: true,
};

const seedStore = () => {
  const editDocumentV2 = patchEditDocumentV2Node(createDefaultEditDocumentV2(), 'layers', {
    masks: editDocumentLayersV2Schema.parse({
      masks: [{ ...structuredClone(layer), adjustments: {} }],
    }).masks,
  });
  useEditorStore.getState().hydrateEditorRenderAuthority({
    adjustmentRevision: 0,
    finalPreviewUrl: 'blob:mask-tone-current',
    historyCheckpoints: [],
    historyIndex: 0,
    imageSession: null,
    imageSessionId: 44,
    lastEditApplicationReceipt: null,
    navigatorPreviewArtifact: {
      graphIdentity: 'mask-tone-before',
      id: 'navigator-before',
      imageSessionId: 'editor-image-session:44',
      url: 'blob:navigator-before',
    },
    transformedOriginalUrl: 'blob:original-before',
    editDocumentV2,
    history: [editDocumentV2],
  });
};

const transactionFor = (masks: readonly MaskContainer[], transactionId: string) => ({
  baseAdjustmentRevision: useEditorStore.getState().adjustmentRevision,
  history: 'single-entry' as const,
  imageSessionId: 'editor-image-session:44',
  operations: [
    {
      nodeType: 'layers' as const,
      patch: editDocumentLayersV2Schema.parse({ masks }),
      type: 'patch-edit-document-node' as const,
    },
  ],
  persistence: 'commit' as const,
  source: 'manual-control' as const,
  transactionId,
});

beforeEach(seedStore);

describe('mask Tone Equalizer EditTransaction boundary', () => {
  test('promotes the graph and updates the local layer through one canonical transaction', () => {
    const state = useEditorStore.getState();
    const currentLayer = selectEditDocumentMasks(state.editDocumentV2)[0];
    expect(currentLayer).toBeDefined();
    if (currentLayer === undefined) return;
    const next = applyMaskContainerAdjustmentCandidate(selectEditDocumentMasks(state.editDocumentV2), currentLayer.id, {
      ...currentLayer.adjustments,
      toneEqualizer: { ...currentLayer.adjustments.toneEqualizer, enabled: true },
    });
    const result = state.applyEditTransaction(transactionFor(next, 'mask-tone-enable'));
    const committed = useEditorStore.getState();

    expect(result).toMatchObject({
      imageSessionId: 'editor-image-session:44',
      nextAdjustmentRevision: 1,
      noOp: false,
      source: 'manual-control',
      transactionId: 'mask-tone-enable',
    });
    expect(result.changedKeys).toEqual(['nodes.layers.params.masks']);
    expect(selectEditDocumentMasks(committed.editDocumentV2)[0]?.adjustments.toneEqualizer.enabled).toBe(true);
    expect(committed.adjustmentRevision).toBe(1);
    expect(committed.history).toHaveLength(2);
    expect(committed.historyIndex).toBe(1);
    expect(committed.lastEditApplicationReceipt).toMatchObject({
      adjustmentRevision: 1,
      baseAdjustmentRevision: 0,
      persistence: 'commit',
      transactionId: 'mask-tone-enable',
    });
    expect(committed.finalPreviewUrl).toBeNull();
    expect(committed.navigatorPreviewArtifact).toBeNull();
    expect(committed.transformedOriginalUrl).toBeNull();
  });

  test('an exact repeated local adjustment remains a no-op and unrelated local edits do not promote graph v2', () => {
    const state = useEditorStore.getState();
    const currentLayer = selectEditDocumentMasks(state.editDocumentV2)[0];
    expect(currentLayer).toBeDefined();
    if (currentLayer === undefined) return;

    const unchanged = applyMaskContainerAdjustmentCandidate(
      selectEditDocumentMasks(state.editDocumentV2),
      currentLayer.id,
      currentLayer.adjustments,
    );
    expect(unchanged).toBe(selectEditDocumentMasks(state.editDocumentV2));
    const noOp = state.applyEditTransaction(transactionFor(unchanged, 'mask-tone-no-op'));
    expect(noOp.noOp).toBe(true);
    expect(useEditorStore.getState().history).toHaveLength(1);
    expect(useEditorStore.getState().lastEditApplicationReceipt).toBeNull();

    const exposureOnly = applyMaskContainerAdjustmentCandidate(
      selectEditDocumentMasks(state.editDocumentV2),
      currentLayer.id,
      {
        ...currentLayer.adjustments,
        exposure: 0.4,
      },
    );
    expect(exposureOnly[0]?.adjustments.exposure).toBe(0.4);
  });

  test('rejects a stale tone-equalizer proposal without publishing graph promotion', () => {
    const base = useEditorStore.getState();
    const currentLayer = selectEditDocumentMasks(base.editDocumentV2)[0];
    expect(currentLayer).toBeDefined();
    if (currentLayer === undefined) return;
    const proposed = applyMaskContainerAdjustmentCandidate(
      selectEditDocumentMasks(base.editDocumentV2),
      currentLayer.id,
      {
        ...currentLayer.adjustments,
        toneEqualizer: { ...currentLayer.adjustments.toneEqualizer, enabled: true },
      },
    );
    const stale = transactionFor(proposed, 'mask-tone-stale');
    base.applyEditTransaction({
      baseAdjustmentRevision: base.adjustmentRevision,
      history: 'single-entry',
      imageSessionId: 'editor-image-session:44',
      operations: [
        {
          nodeType: 'scene_global_color_tone',
          patch: { exposure: 0.25 },
          type: 'patch-edit-document-node',
        },
      ],
      persistence: 'commit',
      source: 'manual-control',
      transactionId: 'newer-edit',
    });

    expect(() => useEditorStore.getState().applyEditTransaction(stale)).toThrow('edit_transaction.stale_base:0:1');
    const committed = useEditorStore.getState();
    expect(selectEditDocumentMasks(committed.editDocumentV2)[0]).toEqual(currentLayer);
  });
});
