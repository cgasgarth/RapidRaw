import { beforeEach, describe, expect, test } from 'bun:test';

import { editDocumentDisplayCreativeV2Schema } from '../../../packages/rawengine-schema/src/editDocumentV2';
import { createEditorImageSession, useEditorStore } from '../../../src/store/useEditorStore';
import { publishAdjustmentSnapshot } from '../../../src/utils/adjustmentSnapshots';
import { CreativeAdjustment, Effect, INITIAL_ADJUSTMENTS } from '../../../src/utils/adjustments';
import {
  buildDisplayCreativeEditTransaction,
  buildDisplayCreativePatchEditTransaction,
  DISPLAY_CREATIVE_NODE_ADJUSTMENTS,
  type DisplayCreativeCommitIdentity,
  isDisplayCreativeNodeAdjustment,
} from '../../../src/utils/displayCreativeEditTransaction';
import { createDefaultEditDocumentV2, patchEditDocumentV2Node } from '../../../src/utils/editDocumentV2';

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
    const editDocumentV2 = patchEditDocumentV2Node(
      patchEditDocumentV2Node(createDefaultEditDocumentV2(), 'scene_global_color_tone', {
        exposure: adjustments.exposure,
      }),
      'geometry',
      { flipHorizontal: adjustments.flipHorizontal },
    );
    useEditorStore.getState().hydrateEditorRenderAuthority({
      adjustmentRevision: 0,
      editDocumentV2,
      historyCheckpoints: [],
      historyIndex: 0,
      imageSession: session,
      lastEditApplicationReceipt: null,
      selectedImage,
      history: [editDocumentV2],
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
    expect(result.afterEditDocumentV2.nodes['geometry']).toEqual(result.beforeEditDocumentV2.nodes['geometry']);
    expect(result.afterEditDocumentV2.nodes['scene_global_color_tone']).toEqual(
      result.beforeEditDocumentV2.nodes['scene_global_color_tone'],
    );
    expect(
      editDocumentDisplayCreativeV2Schema.parse(result.afterEditDocumentV2.nodes['display_creative']?.params)
        .vignetteAmount,
    ).toBe(-32);
    expect(useEditorStore.getState().history).toHaveLength(2);
    expect(useEditorStore.getState().lastEditApplicationReceipt).toMatchObject({
      adjustmentRevision: 1,
      persistence: 'commit',
      source: 'manual-control',
    });

    useEditorStore.getState().undo();
    expect(useEditorStore.getState().editDocumentV2.nodes['display_creative']!.params['vignetteAmount']).toBe(0);
    expect(useEditorStore.getState().editDocumentV2.nodes['scene_global_color_tone']!.params['exposure']).toBe(0.4);
    expect(useEditorStore.getState().editDocumentV2.geometry.flipHorizontal).toBe(true);
  });

  test('commits a zero LUT intensity without falling back to the display default', () => {
    const state = useEditorStore.getState();
    const result = state.applyEditTransaction(
      buildDisplayCreativeEditTransaction(state, identity(), Effect.LutIntensity, 0, 'display-creative-lut-zero'),
    );

    expect(result.changedKeys).toEqual(['lutIntensity']);
    expect(result.after.lutIntensity).toBe(0);
    expect(
      editDocumentDisplayCreativeV2Schema.parse(result.afterEditDocumentV2.nodes['display_creative']?.params)
        .lutIntensity,
    ).toBe(0);
    expect(useEditorStore.getState().history).toHaveLength(2);

    useEditorStore.getState().undo();
    expect(useEditorStore.getState().editDocumentV2.nodes['display_creative']!.params['lutIntensity']).toBe(100);
  });

  test('owns display controls, exact no-ops, and rejects stale identity', () => {
    const state = useEditorStore.getState();
    expect(DISPLAY_CREATIVE_NODE_ADJUSTMENTS).toEqual([
      CreativeAdjustment.GlowAmount,
      CreativeAdjustment.HalationAmount,
      CreativeAdjustment.FlareAmount,
      Effect.GrainAmount,
      Effect.GrainSize,
      Effect.GrainRoughness,
      Effect.LutIntensity,
      Effect.VignetteAmount,
      Effect.VignetteFeather,
      Effect.VignetteMidpoint,
      Effect.VignetteRoundness,
    ]);
    for (const field of DISPLAY_CREATIVE_NODE_ADJUSTMENTS) {
      expect(isDisplayCreativeNodeAdjustment(field)).toBeTrue();
      expect(buildDisplayCreativeEditTransaction(state, identity(), field, 37, `field-${field}`).operations).toEqual([
        { nodeType: 'display_creative', patch: { [field]: 37 }, type: 'patch-edit-document-node' },
      ]);
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

  test('commits a grain preset patch as one display node revision and one history boundary', () => {
    const state = useEditorStore.getState();
    const request = buildDisplayCreativePatchEditTransaction(
      state,
      identity(),
      { grainAmount: 28, grainRoughness: 50, grainSize: 34 },
      'display-creative-grain-preset',
    );
    const result = state.applyEditTransaction(request);

    expect(request.operations).toEqual([
      {
        nodeType: 'display_creative',
        patch: { grainAmount: 28, grainRoughness: 50, grainSize: 34 },
        type: 'patch-edit-document-node',
      },
    ]);
    expect(
      editDocumentDisplayCreativeV2Schema.parse(result.afterEditDocumentV2.nodes['display_creative']?.params),
    ).toMatchObject({
      grainAmount: 28,
      grainRoughness: 50,
      grainSize: 34,
    });
    expect(useEditorStore.getState().history).toHaveLength(2);
  });

  test('commits through the canonical selected-image fallback session', () => {
    useEditorStore.setState({
      finalPreviewUrl: 'blob:fallback-display-before',
      imageSession: null,
      imageSessionId: 29,
    });
    const state = useEditorStore.getState();
    const fallbackIdentity: DisplayCreativeCommitIdentity = {
      adjustmentRevision: state.adjustmentRevision,
      imageSessionId: 'editor-image-session:29',
      sourceIdentity: sourcePath,
    };
    const noOp = state.applyEditTransaction(
      buildDisplayCreativeEditTransaction(state, fallbackIdentity, Effect.VignetteAmount, 0, 'fallback-display-no-op'),
    );
    expect(noOp.noOp).toBe(true);
    expect(useEditorStore.getState().finalPreviewUrl).toBe('blob:fallback-display-before');
    const result = useEditorStore
      .getState()
      .applyEditTransaction(
        buildDisplayCreativeEditTransaction(
          useEditorStore.getState(),
          fallbackIdentity,
          Effect.VignetteAmount,
          -18,
          'fallback-display',
        ),
      );
    expect(result).toMatchObject({ changedKeys: ['vignetteAmount'], noOp: false });
    expect(useEditorStore.getState().lastEditApplicationReceipt).toMatchObject({
      imageSessionId: fallbackIdentity.imageSessionId,
      transactionId: 'fallback-display',
    });
    expect(useEditorStore.getState().history).toHaveLength(2);
    expect(useEditorStore.getState().finalPreviewUrl).toBeNull();
    expect(() =>
      buildDisplayCreativeEditTransaction(
        { ...state, imageSessionId: 30 },
        fallbackIdentity,
        Effect.VignetteAmount,
        -20,
        'stale-fallback',
      ),
    ).toThrow('display_creative_transaction.stale_session');
  });
});
