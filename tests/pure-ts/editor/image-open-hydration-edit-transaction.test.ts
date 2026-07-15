import { beforeEach, describe, expect, test } from 'bun:test';

import { createEditorImageSession, useEditorStore } from '../../../src/store/useEditorStore';
import { publishAdjustmentSnapshot } from '../../../src/utils/adjustmentSnapshots';
import { INITIAL_ADJUSTMENTS } from '../../../src/utils/adjustments';
import { legacyAdjustmentsToEditDocumentV2 } from '../../../src/utils/editDocumentV2';
import {
  buildChangedImageOpenHydrationEditTransaction,
  buildImageOpenHydrationEditTransaction,
} from '../../../src/utils/imageOpenHydrationEditTransaction';

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
      navigatorPreviewArtifact: {
        graphIdentity: 'prior-image-graph',
        id: 'prior-image-navigator',
        imageSessionId: session.id,
        url: 'blob:stale-prior-image-navigator',
      },
      provisionalPreviewFrame: {
        receipt: {
          colorAssumption: 'encoded_srgb_vendor_preview',
          frameGeneration: 1,
          height: 1365,
          imageSession: session.generation,
          orientationApplied: true,
          provisionalReason: 'stale prior-session frame',
          quality: 'embeddedProvisional',
          selectionGeneration: session.generation,
          sourceKind: 'arw',
          sourceRevision: 'source-revision-v1:prior-image',
          width: 2048,
        },
        url: 'blob:stale-prior-image-provisional',
      },
      selectedImage,
      transformedOriginalUrl: 'blob:stale-prior-image-transform',
      uncroppedAdjustedPreviewUrl: 'blob:stale-prior-image-uncropped',
    });
  });

  test('atomically installs native metadata and resets prior-image history', () => {
    const state = useEditorStore.getState();
    const hydrated = { ...structuredClone(INITIAL_ADJUSTMENTS), contrast: 14, exposure: 0.25 };
    const request = buildImageOpenHydrationEditTransaction(
      state,
      { adjustmentRevision: state.adjustmentRevision, imageSessionId: session.id, path },
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
        { adjustmentRevision: beforeStale.adjustmentRevision, imageSessionId: 'editor-image-session:stale', path },
        INITIAL_ADJUSTMENTS,
        'hydrate-stale-session',
      ),
    ).toThrow('image_open_hydration.stale_identity');
    expect(() =>
      buildImageOpenHydrationEditTransaction(
        beforeStale,
        { adjustmentRevision: beforeStale.adjustmentRevision, imageSessionId: session.id, path: '/fixtures/other.ARW' },
        INITIAL_ADJUSTMENTS,
        'hydrate-stale-path',
      ),
    ).toThrow('image_open_hydration.stale_identity');
    expect(() =>
      buildImageOpenHydrationEditTransaction(
        beforeStale,
        { adjustmentRevision: beforeStale.adjustmentRevision - 1, imageSessionId: session.id, path },
        INITIAL_ADJUSTMENTS,
        'hydrate-stale-revision',
      ),
    ).toThrow('image_open_hydration.stale_identity');
    const afterStale = useEditorStore.getState();
    expect(afterStale.adjustmentRevision).toBe(beforeStale.adjustmentRevision);
    expect(afterStale.adjustments).toBe(beforeStale.adjustments);
    expect(afterStale.history).toBe(beforeStale.history);
    expect(afterStale.lastEditApplicationReceipt).toBe(beforeStale.lastEditApplicationReceipt);
    expect(afterStale.finalPreviewUrl).toBe(beforeStale.finalPreviewUrl);
    expect(afterStale.navigatorPreviewArtifact).toBe(beforeStale.navigatorPreviewArtifact);
    expect(afterStale.provisionalPreviewFrame).toBe(beforeStale.provisionalPreviewFrame);
    expect(afterStale.transformedOriginalUrl).toBe(beforeStale.transformedOriginalUrl);
    expect(afterStale.uncroppedAdjustedPreviewUrl).toBe(beforeStale.uncroppedAdjustedPreviewUrl);

    const request = buildImageOpenHydrationEditTransaction(
      afterStale,
      { adjustmentRevision: afterStale.adjustmentRevision, imageSessionId: session.id, path },
      afterStale.adjustments,
      'hydrate-no-op',
    );
    afterStale.applyEditTransaction(request);
    expect(useEditorStore.getState().adjustmentRevision).toBe(beforeStale.adjustmentRevision);
    expect(useEditorStore.getState().history).toEqual([beforeStale.adjustments]);
    expect(useEditorStore.getState().historyIndex).toBe(0);
    expect(useEditorStore.getState().historyCheckpoints).toEqual([]);
    expect(useEditorStore.getState().lastEditApplicationReceipt).toBeNull();
    expect(useEditorStore.getState().finalPreviewUrl).toBeNull();
    expect(useEditorStore.getState().navigatorPreviewArtifact).toBeNull();
    expect(useEditorStore.getState().provisionalPreviewFrame).toBeNull();
    expect(useEditorStore.getState().transformedOriginalUrl).toBeNull();
    expect(useEditorStore.getState().uncroppedAdjustedPreviewUrl).toBeNull();
  });

  test('preserves a matching cached preview until authoritative background metadata replaces it', () => {
    const initial = useEditorStore.getState();
    const cachedAdjustments = { ...structuredClone(INITIAL_ADJUSTMENTS), exposure: 0.4 };
    initial.applyEditTransaction(
      buildImageOpenHydrationEditTransaction(
        initial,
        { adjustmentRevision: initial.adjustmentRevision, imageSessionId: session.id, path },
        cachedAdjustments,
        'hydrate-cache',
      ),
    );
    useEditorStore.setState({
      finalPreviewUrl: 'blob:matching-cache-preview',
      uncroppedAdjustedPreviewUrl: 'blob:matching-cache-uncropped',
    });
    expect(useEditorStore.getState().finalPreviewUrl).toBe('blob:matching-cache-preview');

    const cached = useEditorStore.getState();
    expect(
      buildChangedImageOpenHydrationEditTransaction(
        cached,
        { adjustmentRevision: cached.adjustmentRevision, imageSessionId: session.id, path },
        structuredClone(cachedAdjustments),
        'hydrate-unchanged-background-metadata',
      ),
    ).toBeNull();
    expect(useEditorStore.getState().finalPreviewUrl).toBe('blob:matching-cache-preview');
    const authoritativeAdjustments = { ...cachedAdjustments, contrast: 12 };
    const backgroundTransaction = buildChangedImageOpenHydrationEditTransaction(
      cached,
      { adjustmentRevision: cached.adjustmentRevision, imageSessionId: session.id, path },
      authoritativeAdjustments,
      'hydrate-background-metadata',
    );
    if (backgroundTransaction === null) throw new Error('Expected changed background hydration transaction.');
    cached.applyEditTransaction(backgroundTransaction);
    expect(useEditorStore.getState()).toMatchObject({
      adjustments: { contrast: 12, exposure: 0.4 },
      finalPreviewUrl: null,
      historyIndex: 0,
      uncroppedAdjustedPreviewUrl: null,
    });
    expect(useEditorStore.getState().history).toEqual([authoritativeAdjustments]);
  });
});
