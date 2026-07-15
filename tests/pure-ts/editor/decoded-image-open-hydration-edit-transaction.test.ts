import { beforeEach, describe, expect, test } from 'bun:test';

import { createEditorImageSession, useEditorStore } from '../../../src/store/useEditorStore';
import { publishAdjustmentSnapshot } from '../../../src/utils/adjustmentSnapshots';
import { INITIAL_ADJUSTMENTS } from '../../../src/utils/adjustments';
import { legacyAdjustmentsToEditDocumentV2 } from '../../../src/utils/editDocumentV2';
import {
  buildImageOpenHydrationEditTransaction,
  canContinueImageOpenHydration,
} from '../../../src/utils/imageOpenHydrationEditTransaction';

const path = '/fixtures/decoded-hydration.NEF';
const session = createEditorImageSession({ generation: 42, path, source: 'cold-load' });

describe('decoded image-open hydration edit transaction', () => {
  beforeEach(() => {
    const adjustments = { ...structuredClone(INITIAL_ADJUSTMENTS), exposure: 1.2 };
    const editDocumentV2 = legacyAdjustmentsToEditDocumentV2(adjustments);
    useEditorStore.setState({
      adjustmentRevision: 8,
      adjustmentSnapshot: publishAdjustmentSnapshot(null, adjustments, editDocumentV2),
      adjustments,
      editDocumentV2,
      finalPreviewUrl: 'blob:pre-hydration-preview',
      history: [structuredClone(INITIAL_ADJUSTMENTS), adjustments],
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
      { ...decoded, aspectRatio: 1.5 },
      'decoded-hydration',
    );

    state.applyEditTransaction(request);
    const after = useEditorStore.getState();
    expect(after.adjustments).toMatchObject({ aspectRatio: 1.5, contrast: 18, exposure: 0.35 });
    expect(after.adjustmentRevision).toBe(9);
    expect(after.history).toEqual([after.adjustments]);
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
    expect(() => buildImageOpenHydrationEditTransaction(newer, staleIdentity, staleDecoded, 'stale-decoded')).toThrow(
      'image_open_hydration.stale_identity',
    );
    expect(useEditorStore.getState().adjustments.exposure).toBe(2.1);
    expect(canContinueImageOpenHydration(useEditorStore.getState(), staleIdentity)).toBeFalse();
    expect(useEditorStore.getState().adjustments.aspectRatio).toBeNull();
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
          adjustments: { ...metadataState.adjustments, contrast: 9 },
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
      { ...current.adjustments, aspectRatio: 1.5 },
      'fresh-aspect',
    );
    current.applyEditTransaction(aspectOnly);
    expect(useEditorStore.getState().adjustments).toMatchObject({ aspectRatio: 1.5, contrast: 9, exposure: 1.2 });
    expect(useEditorStore.getState().history).toEqual([useEditorStore.getState().adjustments]);
  });
});
