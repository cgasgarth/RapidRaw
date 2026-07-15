import { beforeEach, describe, expect, test } from 'bun:test';

import { createEditorImageSession, useEditorStore } from '../../../src/store/useEditorStore';
import { publishAdjustmentSnapshot } from '../../../src/utils/adjustmentSnapshots';
import { CreativeAdjustment, Effect, INITIAL_ADJUSTMENTS } from '../../../src/utils/adjustments';
import {
  buildDisplayCreativeEditTransaction,
  DISPLAY_CREATIVE_NODE_ADJUSTMENTS,
  type DisplayCreativeCommitIdentity,
  isDisplayCreativeNodeAdjustment,
} from '../../../src/utils/displayCreativeEditTransaction';
import { legacyAdjustmentsToEditDocumentV2 } from '../../../src/utils/editDocumentV2';

const sourcePath = '/fixture/display-creative-controls.ARW';
const session = createEditorImageSession({ generation: 19, path: sourcePath, source: 'cache' });
const selectedImage = {
  exif: null,
  height: 3000,
  isRaw: true,
  isReady: true,
  metadata: null,
  originalUrl: null,
  path: sourcePath,
  rawDevelopmentReport: null,
  thumbnailUrl: '',
  width: 4000,
};
const identity = (overrides: Partial<DisplayCreativeCommitIdentity> = {}): DisplayCreativeCommitIdentity => ({
  adjustmentRevision: 0,
  imageSessionId: session.id,
  sourceIdentity: sourcePath,
  ...overrides,
});

describe('display creative edit transaction', () => {
  beforeEach(() => {
    const adjustments = { ...structuredClone(INITIAL_ADJUSTMENTS), exposure: 0.4, flipHorizontal: true };
    const editDocumentV2 = legacyAdjustmentsToEditDocumentV2(adjustments);
    useEditorStore.setState({
      adjustmentRevision: 0,
      adjustmentSnapshot: publishAdjustmentSnapshot(null, adjustments, editDocumentV2),
      adjustments,
      editDocumentV2,
      history: [adjustments],
      historyCheckpoints: [],
      historyIndex: 0,
      imageSession: session,
      lastEditApplicationReceipt: null,
      selectedImage,
    });
  });

  test('commits one display-creative vignette revision while preserving tone, geometry, and Undo', () => {
    const state = useEditorStore.getState();
    const request = buildDisplayCreativeEditTransaction(
      state,
      identity(),
      Effect.VignetteAmount,
      -32,
      'display-creative-vignette',
    );
    const result = state.applyEditTransaction(request);

    expect(request.operations).toEqual([
      { nodeType: 'display_creative', patch: { vignetteAmount: -32 }, type: 'patch-edit-document-node' },
    ]);
    expect(result).toMatchObject({
      changedKeys: ['vignetteAmount'],
      nextAdjustmentRevision: 1,
      noOp: false,
      source: 'manual-control',
    });
    expect(result.afterEditDocumentV2.nodes.geometry).toEqual(result.beforeEditDocumentV2.nodes.geometry);
    expect(result.afterEditDocumentV2.nodes.scene_global_color_tone).toEqual(
      result.beforeEditDocumentV2.nodes.scene_global_color_tone,
    );
    expect(result.afterEditDocumentV2.nodes.display_creative.params.vignetteAmount).toBe(-32);
    expect(useEditorStore.getState().history).toHaveLength(2);
    expect(useEditorStore.getState().lastEditApplicationReceipt).toMatchObject({
      adjustmentRevision: 1,
      persistence: 'commit',
      source: 'manual-control',
    });

    useEditorStore.getState().undo();
    expect(useEditorStore.getState().adjustments.vignetteAmount).toBe(0);
    expect(useEditorStore.getState().adjustments.exposure).toBe(0.4);
    expect(useEditorStore.getState().adjustments.flipHorizontal).toBe(true);
  });

  test('owns only the migrated global Vignette control, exact no-ops, and rejects stale identity', () => {
    const state = useEditorStore.getState();
    expect(DISPLAY_CREATIVE_NODE_ADJUSTMENTS).toEqual([Effect.VignetteAmount]);
    expect(isDisplayCreativeNodeAdjustment(Effect.VignetteAmount)).toBeTrue();
    for (const field of [
      CreativeAdjustment.GlowAmount,
      CreativeAdjustment.HalationAmount,
      Effect.GrainAmount,
      Effect.GrainSize,
      Effect.LutIntensity,
      Effect.VignetteFeather,
    ]) {
      expect(isDisplayCreativeNodeAdjustment(field)).toBeFalse();
    }

    const noOp = state.applyEditTransaction(
      buildDisplayCreativeEditTransaction(state, identity(), Effect.VignetteAmount, 0, 'no-op'),
    );
    expect(noOp.noOp).toBe(true);
    expect(useEditorStore.getState().adjustmentRevision).toBe(0);
    expect(useEditorStore.getState().history).toHaveLength(1);
    expect(useEditorStore.getState().lastEditApplicationReceipt).toBeNull();

    expect(() =>
      buildDisplayCreativeEditTransaction(
        state,
        identity({ sourceIdentity: '/fixture/stale.ARW' }),
        Effect.VignetteAmount,
        1,
        'stale-source',
      ),
    ).toThrow('display_creative_transaction.stale_source');
    expect(() =>
      buildDisplayCreativeEditTransaction(
        state,
        identity({ imageSessionId: 'editor-image-session:stale' }),
        Effect.VignetteAmount,
        1,
        'stale-session',
      ),
    ).toThrow('display_creative_transaction.stale_session');
    expect(() =>
      buildDisplayCreativeEditTransaction(
        state,
        identity({ adjustmentRevision: 1 }),
        Effect.VignetteAmount,
        1,
        'stale-revision',
      ),
    ).toThrow('display_creative_transaction.stale_revision');
  });
});
