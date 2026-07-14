import { beforeEach, describe, expect, test } from 'bun:test';

import { useEditorStore } from '../../../src/store/useEditorStore';
import { publishAdjustmentSnapshot } from '../../../src/utils/adjustmentSnapshots';
import { INITIAL_ADJUSTMENTS, INITIAL_MASK_ADJUSTMENTS, type MaskContainer } from '../../../src/utils/adjustments';
import { applyMaskContainerAdjustmentCandidate } from '../../../src/utils/mask/maskContainerAdjustmentTransaction';

const layer: MaskContainer = {
  adjustments: structuredClone(INITIAL_MASK_ADJUSTMENTS),
  blendMode: 'normal',
  id: 'tone-equalizer-layer',
  invert: false,
  name: 'Tone Equalizer layer',
  opacity: 100,
  subMasks: [],
  visible: true,
};

const seedStore = () => {
  const adjustments = { ...structuredClone(INITIAL_ADJUSTMENTS), masks: [structuredClone(layer)] };
  useEditorStore.setState({
    adjustmentRevision: 0,
    adjustmentSnapshot: publishAdjustmentSnapshot(null, adjustments),
    adjustments,
    finalPreviewUrl: 'blob:mask-tone-current',
    history: [adjustments],
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
  });
};

const transactionFor = (adjustments: typeof INITIAL_ADJUSTMENTS, transactionId: string) => ({
  baseAdjustmentRevision: useEditorStore.getState().adjustmentRevision,
  history: 'single-entry' as const,
  imageSessionId: 'editor-image-session:44',
  operations: [{ adjustments, type: 'replace-adjustments' as const }],
  persistence: 'commit' as const,
  source: 'manual-control' as const,
  transactionId,
});

beforeEach(seedStore);

describe('mask Tone Equalizer EditTransaction boundary', () => {
  test('promotes the graph and updates the local layer through one canonical transaction', () => {
    const state = useEditorStore.getState();
    const currentLayer = state.adjustments.masks[0];
    expect(currentLayer).toBeDefined();
    if (currentLayer === undefined) return;
    const next = applyMaskContainerAdjustmentCandidate(state.adjustments, currentLayer.id, {
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
    expect(result.changedKeys).toEqual(['rawEngineEditGraphVersion', 'masks']);
    expect(committed.adjustments.rawEngineEditGraphVersion).toBe(2);
    expect(committed.adjustments.masks[0]?.adjustments.toneEqualizer.enabled).toBe(true);
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
    const currentLayer = state.adjustments.masks[0];
    expect(currentLayer).toBeDefined();
    if (currentLayer === undefined) return;

    const unchanged = applyMaskContainerAdjustmentCandidate(
      state.adjustments,
      currentLayer.id,
      currentLayer.adjustments,
    );
    expect(unchanged).toBe(state.adjustments);
    const noOp = state.applyEditTransaction(transactionFor(unchanged, 'mask-tone-no-op'));
    expect(noOp.noOp).toBe(true);
    expect(useEditorStore.getState().history).toHaveLength(1);
    expect(useEditorStore.getState().lastEditApplicationReceipt).toBeNull();

    const exposureOnly = applyMaskContainerAdjustmentCandidate(state.adjustments, currentLayer.id, {
      ...currentLayer.adjustments,
      exposure: 0.4,
    });
    expect(exposureOnly.rawEngineEditGraphVersion).toBe(1);
  });

  test('rejects a stale tone-equalizer proposal without publishing graph promotion', () => {
    const base = useEditorStore.getState();
    const currentLayer = base.adjustments.masks[0];
    expect(currentLayer).toBeDefined();
    if (currentLayer === undefined) return;
    const proposed = applyMaskContainerAdjustmentCandidate(base.adjustments, currentLayer.id, {
      ...currentLayer.adjustments,
      toneEqualizer: { ...currentLayer.adjustments.toneEqualizer, enabled: true },
    });
    const stale = transactionFor(proposed, 'mask-tone-stale');
    base.applyEditTransaction(transactionFor({ ...base.adjustments, exposure: 0.25 }, 'newer-edit'));

    expect(() => useEditorStore.getState().applyEditTransaction(stale)).toThrow('edit_transaction.stale_base:0:1');
    const committed = useEditorStore.getState();
    expect(committed.adjustments.rawEngineEditGraphVersion).toBe(1);
    expect(committed.adjustments.masks[0]?.adjustments.toneEqualizer.enabled).toBe(false);
  });
});
