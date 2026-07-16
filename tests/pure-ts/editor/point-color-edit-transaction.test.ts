import { beforeEach, describe, expect, test } from 'bun:test';

import { createEditorImageSession, useEditorStore } from '../../../src/store/useEditorStore';
import { publishAdjustmentSnapshot } from '../../../src/utils/adjustmentSnapshots';
import { INITIAL_ADJUSTMENTS } from '../../../src/utils/adjustments';
import { legacyAdjustmentsToEditDocumentV2 } from '../../../src/utils/editDocumentV2';
import {
  buildPointColorEditTransaction,
  isCurrentPointColorIdentity,
  type PointColorCommitIdentity,
} from '../../../src/utils/pointColorEditTransaction';

const sourcePath = '/fixture/point-color.ARW';
const session = createEditorImageSession({ generation: 23, path: sourcePath, source: 'cache' });
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
const identity = (overrides: Partial<PointColorCommitIdentity> = {}): PointColorCommitIdentity => ({
  adjustmentRevision: 0,
  imageSessionId: session.id,
  sourceIdentity: sourcePath,
  ...overrides,
});

describe('point color edit transaction', () => {
  beforeEach(() => {
    const adjustments = structuredClone(INITIAL_ADJUSTMENTS);
    const editDocumentV2 = legacyAdjustmentsToEditDocumentV2(adjustments);
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

  test('commits one complete point-color node revision and preserves unrelated domains through Undo', () => {
    const state = useEditorStore.getState();
    const request = buildPointColorEditTransaction(state, identity(), { enabled: true }, 'point-enable');
    const result = state.applyEditTransaction(request);

    expect(request.operations).toEqual([
      {
        nodeType: 'point_color',
        patch: { pointColor: { ...INITIAL_ADJUSTMENTS.pointColor, enabled: true } },
        type: 'patch-edit-document-node',
      },
    ]);
    expect(result).toMatchObject({ changedKeys: ['pointColor'], nextAdjustmentRevision: 1, noOp: false });
    expect(result.afterEditDocumentV2.nodes.point_color.params.pointColor.enabled).toBe(true);
    expect(result.afterEditDocumentV2.nodes.scene_curve).toBe(result.beforeEditDocumentV2.nodes.scene_curve);
    expect(useEditorStore.getState().history).toHaveLength(2);

    useEditorStore.getState().undo();
    expect(useEditorStore.getState().adjustmentSnapshot.value.pointColor.enabled).toBe(false);
  });

  test('rejects stale source, session, and revision before constructing a node transaction', () => {
    const state = useEditorStore.getState();
    expect(() =>
      buildPointColorEditTransaction(
        state,
        identity({ sourceIdentity: '/fixture/stale.ARW' }),
        { enabled: true },
        'stale-source',
      ),
    ).toThrow('point_color_transaction.stale_source');
    expect(() =>
      buildPointColorEditTransaction(
        state,
        identity({ imageSessionId: 'editor-image-session:stale' }),
        { enabled: true },
        'stale-session',
      ),
    ).toThrow('point_color_transaction.stale_session');
    expect(() =>
      buildPointColorEditTransaction(state, identity({ adjustmentRevision: 1 }), { enabled: true }, 'stale-revision'),
    ).toThrow('point_color_transaction.stale_revision');
  });

  test('commits through fallback authority and rejects stale A to B to A identities', () => {
    useEditorStore.setState({
      finalPreviewUrl: 'blob:fallback-point-color-before',
      imageSession: null,
      imageSessionId: 101,
    });
    const state = useEditorStore.getState();
    const fallbackIdentity: PointColorCommitIdentity = {
      adjustmentRevision: 0,
      imageSessionId: 'editor-image-session:101',
      sourceIdentity: sourcePath,
    };
    const noOp = state.applyEditTransaction(
      buildPointColorEditTransaction(state, fallbackIdentity, {}, 'fallback-point-color-no-op'),
    );
    expect(noOp.noOp).toBeTrue();
    expect(useEditorStore.getState()).toMatchObject({
      adjustmentRevision: 0,
      finalPreviewUrl: 'blob:fallback-point-color-before',
      historyIndex: 0,
      lastEditApplicationReceipt: null,
    });

    const result = state.applyEditTransaction(
      buildPointColorEditTransaction(state, fallbackIdentity, { enabled: true }, 'fallback-point-color'),
    );
    expect(result).toMatchObject({ changedKeys: ['pointColor'], nextAdjustmentRevision: 1, noOp: false });
    expect(useEditorStore.getState()).toMatchObject({
      finalPreviewUrl: null,
      historyIndex: 1,
      lastEditApplicationReceipt: {
        imageSessionId: fallbackIdentity.imageSessionId,
        transactionId: 'fallback-point-color',
      },
    });
    expect(useEditorStore.getState().history).toHaveLength(2);
    useEditorStore.getState().undo();
    expect(useEditorStore.getState().adjustmentSnapshot.value.pointColor.enabled).toBeFalse();

    expect(isCurrentPointColorIdentity(state, fallbackIdentity)).toBeTrue();
    expect(
      isCurrentPointColorIdentity(
        { ...state, imageSessionId: 102, selectedImage: { path: '/fixture/B.ARW' } },
        fallbackIdentity,
      ),
    ).toBeFalse();
    expect(isCurrentPointColorIdentity({ ...state, imageSessionId: 103 }, fallbackIdentity)).toBeFalse();
    expect(isCurrentPointColorIdentity({ ...state, adjustmentRevision: 1 }, fallbackIdentity)).toBeFalse();
    expect(() =>
      buildPointColorEditTransaction(
        { ...state, imageSessionId: 103 },
        fallbackIdentity,
        { enabled: true },
        'stale-reopened-a',
      ),
    ).toThrow('point_color_transaction.stale_session');
  });
});
