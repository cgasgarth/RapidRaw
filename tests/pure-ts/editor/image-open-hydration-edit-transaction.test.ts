import { beforeEach, describe, expect, test } from 'bun:test';

import { createEditorImageSession, useEditorStore } from '../../../src/store/useEditorStore';
import { publishAdjustmentSnapshot } from '../../../src/utils/adjustmentSnapshots';
import { INITIAL_ADJUSTMENTS } from '../../../src/utils/adjustments';
import { legacyAdjustmentsToEditDocumentV2 } from '../../../src/utils/editDocumentV2';
import { buildImageOpenHydrationEditTransaction } from '../../../src/utils/imageOpenHydrationEditTransaction';

const path = '/fixtures/hydration.ARW';
const session = createEditorImageSession({ generation: 12, path, source: 'cold-load' });
const selectedImage = {
  exif: null,
  height: 3000,
  isRaw: true,
  isReady: false,
  metadata: null,
  originalUrl: null,
  path,
  rawDevelopmentReport: null,
  thumbnailUrl: '',
  width: 4000,
};

describe('image-open hydration edit transaction', () => {
  beforeEach(() => {
    const adjustments = { ...structuredClone(INITIAL_ADJUSTMENTS), exposure: 0.8 };
    const editDocumentV2 = legacyAdjustmentsToEditDocumentV2(adjustments);
    useEditorStore.setState({
      adjustmentRevision: 5,
      adjustmentSnapshot: publishAdjustmentSnapshot(null, adjustments, editDocumentV2),
      adjustments,
      editDocumentV2,
      finalPreviewUrl: 'blob:stale-prior-image-preview',
      history: [structuredClone(INITIAL_ADJUSTMENTS), adjustments],
      historyCheckpoints: [{ createdAt: '2026-07-15T00:00:00.000Z', historyIndex: 1, id: 'prior', label: 'Prior' }],
      historyIndex: 1,
      imageSession: session,
      lastEditApplicationReceipt: null,
      selectedImage,
    });
  });

  test('atomically installs native metadata and resets prior-image history', () => {
    const state = useEditorStore.getState();
    const hydrated = { ...structuredClone(INITIAL_ADJUSTMENTS), contrast: 14, exposure: 0.25 };
    const request = buildImageOpenHydrationEditTransaction(
      state,
      { imageSessionId: session.id, path },
      hydrated,
      'hydrate-current',
    );

    state.applyEditTransaction(request);
    expect(useEditorStore.getState()).toMatchObject({
      adjustmentRevision: 6,
      adjustments: { contrast: 14, exposure: 0.25 },
      finalPreviewUrl: null,
      historyIndex: 0,
      lastEditApplicationReceipt: {
        adjustmentRevision: 6,
        persistence: 'native-committed',
        source: 'hydration',
        transactionId: 'hydrate-current',
      },
    });
    expect(useEditorStore.getState().history).toEqual([hydrated]);
    expect(useEditorStore.getState().historyCheckpoints).toEqual([]);
  });

  test('rejects stale identity with zero mutation and resets history on an exact no-op', () => {
    const beforeStale = useEditorStore.getState();
    expect(() =>
      buildImageOpenHydrationEditTransaction(
        beforeStale,
        { imageSessionId: 'editor-image-session:stale', path },
        INITIAL_ADJUSTMENTS,
        'hydrate-stale-session',
      ),
    ).toThrow('image_open_hydration.stale_identity');
    expect(() =>
      buildImageOpenHydrationEditTransaction(
        beforeStale,
        { imageSessionId: session.id, path: '/fixtures/other.ARW' },
        INITIAL_ADJUSTMENTS,
        'hydrate-stale-path',
      ),
    ).toThrow('image_open_hydration.stale_identity');
    const afterStale = useEditorStore.getState();
    expect(afterStale.adjustmentRevision).toBe(beforeStale.adjustmentRevision);
    expect(afterStale.adjustments).toBe(beforeStale.adjustments);
    expect(afterStale.history).toBe(beforeStale.history);
    expect(afterStale.lastEditApplicationReceipt).toBe(beforeStale.lastEditApplicationReceipt);

    const request = buildImageOpenHydrationEditTransaction(
      afterStale,
      { imageSessionId: session.id, path },
      afterStale.adjustments,
      'hydrate-no-op',
    );
    afterStale.applyEditTransaction(request);
    expect(useEditorStore.getState().adjustmentRevision).toBe(beforeStale.adjustmentRevision);
    expect(useEditorStore.getState().history).toEqual([beforeStale.adjustments]);
    expect(useEditorStore.getState().historyIndex).toBe(0);
    expect(useEditorStore.getState().historyCheckpoints).toEqual([]);
    expect(useEditorStore.getState().lastEditApplicationReceipt).toBeNull();
  });
});
