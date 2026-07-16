import { beforeEach, describe, expect, test } from 'bun:test';

import { createEditorImageSession, useEditorStore } from '../../../src/store/useEditorStore';
import { INITIAL_ADJUSTMENTS } from '../../../src/utils/adjustments';
import { perceptualGradingFromWheelSurface } from '../../../src/utils/color/perceptualGrading';
import { legacyAdjustmentsToEditDocumentV2 } from '../../../src/utils/editDocumentV2';
import {
  buildPerceptualGradingEditTransaction,
  isCurrentPerceptualGradingIdentity,
  type PerceptualGradingCommitIdentity,
} from '../../../src/utils/perceptualGradingEditTransaction';

const sourcePath = '/fixture/perceptual-grading.ARW';
const session = createEditorImageSession({ generation: 31, path: sourcePath, source: 'cache' });
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
const identity = (overrides: Partial<PerceptualGradingCommitIdentity> = {}): PerceptualGradingCommitIdentity => ({
  adjustmentRevision: 0,
  imageSessionId: session.id,
  sourceIdentity: sourcePath,
  ...overrides,
});

describe('perceptual grading edit transaction', () => {
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

  test('commits one complete perceptual-grading node revision and preserves unrelated nodes through Undo', () => {
    const state = useEditorStore.getState();
    const colorGrading = { ...structuredClone(INITIAL_ADJUSTMENTS.colorGrading), balance: 20 };
    const perceptualGradingV1 = perceptualGradingFromWheelSurface(colorGrading);
    const request = buildPerceptualGradingEditTransaction(
      state,
      identity(),
      colorGrading,
      perceptualGradingV1,
      'grading-balance',
    );
    const result = state.applyEditTransaction(request);

    expect(result).toMatchObject({
      changedKeys: ['colorGrading', 'perceptualGradingV1'],
      nextAdjustmentRevision: 1,
      noOp: false,
    });
    expect(result.afterEditDocumentV2.nodes['perceptual_grading']?.params).toEqual({
      colorGrading,
      perceptualGradingV1,
    });
    expect(result.afterEditDocumentV2.nodes['scene_curve']).toBe(result.beforeEditDocumentV2.nodes['scene_curve']);
    expect(useEditorStore.getState().history).toHaveLength(2);

    useEditorStore.getState().undo();
    expect(useEditorStore.getState().adjustmentSnapshot.value.colorGrading).toEqual(INITIAL_ADJUSTMENTS.colorGrading);
  });

  test('rejects stale source, session, and revision before constructing a node transaction', () => {
    const state = useEditorStore.getState();
    const perceptual = perceptualGradingFromWheelSurface(INITIAL_ADJUSTMENTS.colorGrading);
    expect(() =>
      buildPerceptualGradingEditTransaction(
        state,
        identity({ sourceIdentity: '/fixture/stale.ARW' }),
        INITIAL_ADJUSTMENTS.colorGrading,
        perceptual,
        'stale-source',
      ),
    ).toThrow('perceptual_grading_transaction.stale_source');
    expect(() =>
      buildPerceptualGradingEditTransaction(
        state,
        identity({ imageSessionId: 'editor-image-session:stale' }),
        INITIAL_ADJUSTMENTS.colorGrading,
        perceptual,
        'stale-session',
      ),
    ).toThrow('perceptual_grading_transaction.stale_session');
    expect(() =>
      buildPerceptualGradingEditTransaction(
        state,
        identity({ adjustmentRevision: 1 }),
        INITIAL_ADJUSTMENTS.colorGrading,
        perceptual,
        'stale-revision',
      ),
    ).toThrow('perceptual_grading_transaction.stale_revision');
  });

  test('commits through fallback authority and rejects stale A to B to A identities', () => {
    useEditorStore.setState({
      finalPreviewUrl: 'blob:fallback-grading-before',
      imageSession: null,
      imageSessionId: 104,
    });
    const state = useEditorStore.getState();
    const fallbackIdentity: PerceptualGradingCommitIdentity = {
      adjustmentRevision: 0,
      imageSessionId: 'editor-image-session:104',
      sourceIdentity: sourcePath,
    };
    const initialPerceptual = perceptualGradingFromWheelSurface(INITIAL_ADJUSTMENTS.colorGrading);
    const noOp = state.applyEditTransaction(
      buildPerceptualGradingEditTransaction(
        state,
        fallbackIdentity,
        structuredClone(INITIAL_ADJUSTMENTS.colorGrading),
        initialPerceptual,
        'fallback-grading-no-op',
      ),
    );
    expect(noOp.noOp).toBeTrue();
    expect(useEditorStore.getState()).toMatchObject({
      adjustmentRevision: 0,
      finalPreviewUrl: 'blob:fallback-grading-before',
      historyIndex: 0,
      lastEditApplicationReceipt: null,
    });

    const next = { ...structuredClone(INITIAL_ADJUSTMENTS.colorGrading), balance: 25 };
    const nextPerceptual = perceptualGradingFromWheelSurface(next);
    const result = state.applyEditTransaction(
      buildPerceptualGradingEditTransaction(state, fallbackIdentity, next, nextPerceptual, 'fallback-grading'),
    );
    expect(result).toMatchObject({
      changedKeys: ['colorGrading', 'perceptualGradingV1'],
      nextAdjustmentRevision: 1,
      noOp: false,
    });
    expect(useEditorStore.getState()).toMatchObject({
      finalPreviewUrl: null,
      historyIndex: 1,
      lastEditApplicationReceipt: {
        imageSessionId: fallbackIdentity.imageSessionId,
        transactionId: 'fallback-grading',
      },
    });
    expect(useEditorStore.getState().history).toHaveLength(2);
    useEditorStore.getState().undo();
    expect(useEditorStore.getState().adjustmentSnapshot.value.colorGrading).toEqual(INITIAL_ADJUSTMENTS.colorGrading);

    expect(isCurrentPerceptualGradingIdentity(state, fallbackIdentity)).toBeTrue();
    expect(
      isCurrentPerceptualGradingIdentity(
        { ...state, imageSessionId: 105, selectedImage: { path: '/fixture/B.ARW' } },
        fallbackIdentity,
      ),
    ).toBeFalse();
    expect(isCurrentPerceptualGradingIdentity({ ...state, imageSessionId: 106 }, fallbackIdentity)).toBeFalse();
    expect(isCurrentPerceptualGradingIdentity({ ...state, adjustmentRevision: 1 }, fallbackIdentity)).toBeFalse();
    expect(() =>
      buildPerceptualGradingEditTransaction(
        { ...state, imageSessionId: 106 },
        fallbackIdentity,
        next,
        nextPerceptual,
        'stale-reopened-a',
      ),
    ).toThrow('perceptual_grading_transaction.stale_session');
  });
});
