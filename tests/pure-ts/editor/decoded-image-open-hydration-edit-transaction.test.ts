import { beforeEach, describe, expect, test } from 'bun:test';

import { createEditorImageSession, useEditorStore } from '../../../src/store/useEditorStore';
import { publishAdjustmentSnapshot } from '../../../src/utils/adjustmentSnapshots';
import { INITIAL_ADJUSTMENTS } from '../../../src/utils/adjustments';
import { createDefaultEditDocumentV2, patchEditDocumentV2Node } from '../../../src/utils/editDocumentV2';
import {
  buildImageOpenHydrationEditTransaction,
  canContinueImageOpenHydration,
} from '../../../src/utils/imageOpenHydrationEditTransaction';

const path = '/fixtures/decoded-hydration.NEF';
const session = createEditorImageSession({ generation: 42, path, source: 'cold-load' });

describe('decoded image-open hydration edit transaction', () => {
  beforeEach(() => {
    const adjustments = { ...structuredClone(INITIAL_ADJUSTMENTS), exposure: 1.2 };
    const editDocumentV2 = patchEditDocumentV2Node(createDefaultEditDocumentV2(), 'scene_global_color_tone', {
      exposure: adjustments.exposure,
    });
    useEditorStore.getState().hydrateEditorRenderAuthority({
      adjustmentRevision: 8,
      editDocumentV2,
      finalPreviewUrl: 'blob:pre-hydration-preview',
      history: [createDefaultEditDocumentV2(), editDocumentV2],
      historyCheckpoints: [{ createdAt: '2026-07-15T00:00:00.000Z', historyIndex: 1, id: 'old', label: 'Old' }],
      historyIndex: 1,
      imageSession: session,
      lastEditApplicationReceipt: null,
      selectedImage: {
        exif: null,
        height: 0,
        isRaw: true,
        isReady: false,
        metadata: null,
        originalUrl: null,
        path,
        rawDevelopmentReport: null,
        thumbnailUrl: '',
        width: 0,
      },
      transformedOriginalUrl: 'blob:pre-hydration-transform',
      uncroppedAdjustedPreviewUrl: 'blob:pre-hydration-uncropped',
    });
  });

  test('atomically installs decoded metadata, derives aspect ratio, and resets render authority', () => {
    const state = useEditorStore.getState();
    const decoded = { ...structuredClone(INITIAL_ADJUSTMENTS), contrast: 18, exposure: 0.35 };
    const identity = { adjustmentRevision: state.adjustmentRevision, imageSessionId: session.id, path };
    const request = buildImageOpenHydrationEditTransaction(
      state,
      identity,
      patchEditDocumentV2Node(
        patchEditDocumentV2Node(createDefaultEditDocumentV2(), 'scene_global_color_tone', {
          contrast: decoded.contrast,
          exposure: decoded.exposure,
        }),
        'geometry',
        { aspectRatio: 1.5 },
      ),
      'decoded-hydration',
    );

    state.applyEditTransaction(request);
    const after = useEditorStore.getState();
    expect(after.editDocumentV2.geometry.aspectRatio).toBe(1.5);
    expect(after.editDocumentV2.nodes['scene_global_color_tone']!.params).toMatchObject({
      contrast: 18,
      exposure: 0.35,
    });
    expect(after.adjustmentRevision).toBe(9);
    expect(after.history).toEqual([after.editDocumentV2]);
    expect(after.historyIndex).toBe(0);
    expect(after.historyCheckpoints).toEqual([]);
    expect(after.lastEditApplicationReceipt).toMatchObject({
      persistence: 'native-committed',
      source: 'hydration',
      transactionId: 'decoded-hydration',
    });
    expect(after.finalPreviewUrl).toBeNull();
    expect(after.transformedOriginalUrl).toBeNull();
    expect(after.uncroppedAdjustedPreviewUrl).toBeNull();
  });

  test('rejects stale decoded metadata and aspect hydration after a newer user edit', () => {
    const staleIdentity = {
      adjustmentRevision: useEditorStore.getState().adjustmentRevision,
      imageSessionId: session.id,
      path,
    };
    useEditorStore.getState().applyEditTransaction({
      baseAdjustmentRevision: staleIdentity.adjustmentRevision,
      history: 'single-entry',
      imageSessionId: session.id,
      operations: [{ patch: { exposure: 2.1 }, type: 'patch-adjustments' }],
      persistence: 'commit',
      source: 'manual-control',
      transactionId: 'newer-user-edit',
    });
    const newer = useEditorStore.getState();
    const staleDecoded = { ...structuredClone(INITIAL_ADJUSTMENTS), exposure: -1.5 };
    expect(() =>
      buildImageOpenHydrationEditTransaction(
        newer,
        staleIdentity,
        patchEditDocumentV2Node(createDefaultEditDocumentV2(), 'scene_global_color_tone', {
          exposure: staleDecoded.exposure,
        }),
        'stale-decoded',
      ),
    ).toThrow('image_open_hydration.stale_identity');
    expect(useEditorStore.getState().editDocumentV2.nodes['scene_global_color_tone']!.params['exposure']).toBe(2.1);
    expect(canContinueImageOpenHydration(useEditorStore.getState(), staleIdentity)).toBeFalse();
    expect(useEditorStore.getState().editDocumentV2.geometry.aspectRatio).toBeNull();
    expect(useEditorStore.getState().history).toHaveLength(3);
  });

  test('allows aspect hydration to continue after metadataReady owns the intervening revision', () => {
    const originalIdentity = {
      adjustmentRevision: useEditorStore.getState().adjustmentRevision,
      imageSessionId: session.id,
      path,
    };
    const metadataState = useEditorStore.getState();
    metadataState.applyEditTransaction({
      baseAdjustmentRevision: metadataState.adjustmentRevision,
      history: 'reset',
      imageSessionId: session.id,
      operations: [
        {
          adjustments: { ...metadataState.adjustmentSnapshot.value, contrast: 9 },
          type: 'replace-adjustments',
        },
      ],
      persistence: 'native-committed',
      source: 'hydration',
      transactionId: 'metadata-ready',
    });
    const current = useEditorStore.getState();
    expect(canContinueImageOpenHydration(current, originalIdentity)).toBeTrue();
    expect(
      canContinueImageOpenHydration(current, {
        ...originalIdentity,
        adjustmentRevision: originalIdentity.adjustmentRevision - 1,
      }),
    ).toBeFalse();
    expect(canContinueImageOpenHydration(current, { ...originalIdentity, path: '/fixtures/other.NEF' })).toBeFalse();
    const aspectOnly = buildImageOpenHydrationEditTransaction(
      current,
      { ...originalIdentity, adjustmentRevision: current.adjustmentRevision },
      patchEditDocumentV2Node(current.editDocumentV2, 'geometry', { aspectRatio: 1.5 }),
      'fresh-aspect',
    );
    current.applyEditTransaction(aspectOnly);
    expect(useEditorStore.getState().editDocumentV2.geometry.aspectRatio).toBe(1.5);
    expect(useEditorStore.getState().editDocumentV2.nodes['scene_global_color_tone']!.params).toMatchObject({
      contrast: 9,
      exposure: 1.2,
    });
    expect(useEditorStore.getState().history).toEqual([useEditorStore.getState().editDocumentV2]);
  });
});
