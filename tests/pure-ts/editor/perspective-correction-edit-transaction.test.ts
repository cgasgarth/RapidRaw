import { beforeEach, describe, expect, test } from 'bun:test';

import { createEditorImageSession, useEditorStore } from '../../../src/store/useEditorStore';
import { publishAdjustmentSnapshot } from '../../../src/utils/adjustmentSnapshots';
import { INITIAL_ADJUSTMENTS } from '../../../src/utils/adjustments';
import { legacyAdjustmentsToEditDocumentV2 } from '../../../src/utils/editDocumentV2';
import { hydrateImageOpenEditDocumentV2 } from '../../../src/utils/imageOpenAdjustmentHydration';
import {
  buildPerspectiveCorrectionEditTransaction,
  capturePerspectiveCorrectionCommitIdentity,
  isCurrentPerspectiveAnalysisRequest,
  type PerspectiveCorrectionCommitIdentity,
} from '../../../src/utils/perspectiveCorrectionEditTransaction';

const sourcePath = '/fixture/perspective.ARW';
const session = createEditorImageSession({ generation: 18, path: sourcePath, source: 'cache' });
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
const identity = (overrides: Partial<PerspectiveCorrectionCommitIdentity> = {}) => ({
  adjustmentRevision: 0,
  imageSessionId: session.id,
  sourceIdentity: sourcePath,
  ...overrides,
});
const matrix = [
  [1, 0, 0],
  [0, 1, 0],
  [0, 0, 1],
] as const;
const resolvedPlan = {
  analysisIdentity: {
    analysisDimensions: [1024, 768] as [number, number],
    implementationVersion: 1 as const,
    lensGeometryFingerprint: 2,
    orientationFingerprint: 3,
    sourceRevision: 4,
  },
  confidence: 0.92,
  correctedToSource: matrix,
  fingerprint: 42,
  implementationVersion: 1 as const,
  retainedArea: 0.81,
  sourceToCorrected: matrix,
  suggestedCrop: { height: 0.8, width: 0.8, x: 0.1, y: 0.1 },
  validPolygon: [
    [0, 0],
    [1, 0],
    [1, 1],
    [0, 1],
  ] as Array<[number, number]>,
  warningCodes: [],
};

describe('perspective correction edit transaction', () => {
  beforeEach(() => {
    const adjustments = {
      ...structuredClone(INITIAL_ADJUSTMENTS),
      perspectiveCorrection: {
        ...structuredClone(INITIAL_ADJUSTMENTS.perspectiveCorrection),
        mode: 'auto_full' as const,
      },
    };
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

  test('commits a resolved analysis plan as one persistent geometry revision with Undo', () => {
    const state = useEditorStore.getState();
    const beforeGeometry = state.editDocumentV2.nodes.geometry;
    const beforeTone = state.editDocumentV2.nodes.scene_global_color_tone;
    expect(capturePerspectiveCorrectionCommitIdentity(state)).toEqual(identity());
    const request = buildPerspectiveCorrectionEditTransaction(
      state,
      identity(),
      { resolvedPlan },
      'perspective-analysis',
    );
    expect(request.operations).toEqual([
      {
        nodeType: 'geometry',
        patch: { perspectiveCorrection: { ...state.adjustmentSnapshot.value.perspectiveCorrection, resolvedPlan } },
        type: 'patch-edit-document-node',
      },
    ]);
    const result = state.applyEditTransaction(request);

    expect(result.after.perspectiveCorrection.resolvedPlan).toEqual(resolvedPlan);
    expect(result.afterEditDocumentV2.nodes.geometry).not.toBe(beforeGeometry);
    expect(result.afterEditDocumentV2.nodes.geometry.params.perspectiveCorrection).toEqual(
      result.after.perspectiveCorrection,
    );
    expect(result.afterEditDocumentV2.nodes.scene_global_color_tone).toBe(beforeTone);
    expect(result.afterEditDocumentV2.extensions.legacyAdjustments).not.toHaveProperty('perspectiveCorrection');
    const reopened = hydrateImageOpenEditDocumentV2(
      {
        adjustments: structuredClone(result.after),
        editDocumentV2: structuredClone(result.afterEditDocumentV2),
      },
      structuredClone(result.after),
    );
    expect(reopened.nodes.geometry.params.perspectiveCorrection).toEqual(result.after.perspectiveCorrection);
    expect(reopened.extensions.legacyAdjustments).not.toHaveProperty('perspectiveCorrection');
    expect(result.applicationReceipt).toMatchObject({
      adjustmentRevision: 1,
      persistence: 'commit',
      source: 'geometry-tool',
      transactionId: 'perspective-analysis',
    });
    expect(result.invalidatedStages).toContain('geometry');
    expect(useEditorStore.getState()).toMatchObject({ adjustmentRevision: 1, historyIndex: 1 });
    useEditorStore.getState().undo();
    expect(useEditorStore.getState().adjustmentSnapshot.value.perspectiveCorrection.resolvedPlan).toBeNull();
    expect(
      useEditorStore.getState().editDocumentV2.nodes.geometry.params.perspectiveCorrection.resolvedPlan,
    ).toBeNull();
    useEditorStore.getState().redo();
    expect(useEditorStore.getState().editDocumentV2.nodes.geometry.params.perspectiveCorrection.resolvedPlan).toEqual(
      resolvedPlan,
    );
  });

  test('validates manual patches, preserves exact no-ops, and rejects every stale identity dimension', () => {
    const state = useEditorStore.getState();
    const build = (commitIdentity: PerspectiveCorrectionCommitIdentity, patch = { amount: 72 }) =>
      buildPerspectiveCorrectionEditTransaction(state, commitIdentity, patch, 'manual-perspective');

    let storeEmissions = 0;
    const unsubscribe = useEditorStore.subscribe(() => {
      storeEmissions += 1;
    });
    const noOp = state.applyEditTransaction(
      build(identity(), { amount: state.adjustmentSnapshot.value.perspectiveCorrection.amount }),
    );
    unsubscribe();
    expect(noOp.noOp).toBe(true);
    expect(storeEmissions).toBe(0);
    expect(useEditorStore.getState()).toMatchObject({ adjustmentRevision: 0, historyIndex: 0 });
    expect(() => build(identity({ sourceIdentity: '/fixture/stale.ARW' }))).toThrow(
      'perspective_correction_transaction.stale_source',
    );
    expect(() => build(identity({ imageSessionId: 'stale-session' }))).toThrow(
      'perspective_correction_transaction.stale_session',
    );
    expect(() => build(identity({ adjustmentRevision: 7 }))).toThrow(
      'perspective_correction_transaction.stale_revision',
    );
    expect(() => build(identity(), { amount: Number.NaN })).toThrow();
  });

  test('accepts only the latest request for the captured source, session, and revision', () => {
    const state = useEditorStore.getState();
    expect(isCurrentPerspectiveAnalysisRequest(state, identity(), 2, 2)).toBe(true);
    expect(isCurrentPerspectiveAnalysisRequest(state, identity(), 1, 2)).toBe(false);
    expect(isCurrentPerspectiveAnalysisRequest(state, identity({ sourceIdentity: '/fixture/B.ARW' }), 2, 2)).toBe(
      false,
    );
    expect(isCurrentPerspectiveAnalysisRequest(state, identity({ imageSessionId: 'successor' }), 2, 2)).toBe(false);
    expect(isCurrentPerspectiveAnalysisRequest(state, identity({ adjustmentRevision: 1 }), 2, 2)).toBe(false);
  });

  test('routes fallback manual edits while rejecting delayed A to B to A analyses', () => {
    useEditorStore.setState({
      finalPreviewUrl: 'blob:fallback-perspective-before',
      imageSession: null,
      imageSessionId: 67,
    });
    const state = useEditorStore.getState();
    const fallbackIdentity: PerspectiveCorrectionCommitIdentity = {
      adjustmentRevision: 0,
      imageSessionId: 'editor-image-session:67',
      sourceIdentity: sourcePath,
    };
    expect(capturePerspectiveCorrectionCommitIdentity(state)).toEqual(fallbackIdentity);

    const noOp = state.applyEditTransaction(
      buildPerspectiveCorrectionEditTransaction(
        state,
        fallbackIdentity,
        { amount: state.adjustmentSnapshot.value.perspectiveCorrection.amount },
        'fallback-perspective-no-op',
      ),
    );
    expect(noOp.noOp).toBeTrue();
    expect(useEditorStore.getState()).toMatchObject({
      adjustmentRevision: 0,
      finalPreviewUrl: 'blob:fallback-perspective-before',
      historyIndex: 0,
      lastEditApplicationReceipt: null,
    });

    const result = state.applyEditTransaction(
      buildPerspectiveCorrectionEditTransaction(state, fallbackIdentity, { amount: 72 }, 'fallback-perspective'),
    );
    expect(result).toMatchObject({ changedKeys: ['perspectiveCorrection'], nextAdjustmentRevision: 1, noOp: false });
    expect(useEditorStore.getState()).toMatchObject({
      finalPreviewUrl: null,
      historyIndex: 1,
      lastEditApplicationReceipt: {
        imageSessionId: fallbackIdentity.imageSessionId,
        transactionId: 'fallback-perspective',
      },
    });
    expect(useEditorStore.getState().history).toHaveLength(2);
    useEditorStore.getState().undo();
    expect(useEditorStore.getState().adjustmentSnapshot.value.perspectiveCorrection.amount).toBe(
      INITIAL_ADJUSTMENTS.perspectiveCorrection.amount,
    );

    expect(isCurrentPerspectiveAnalysisRequest(state, fallbackIdentity, 9, 9)).toBeTrue();
    expect(isCurrentPerspectiveAnalysisRequest(state, fallbackIdentity, 8, 9)).toBeFalse();
    expect(
      isCurrentPerspectiveAnalysisRequest(
        { ...state, imageSessionId: 68, selectedImage: { path: '/fixture/B.ARW' } },
        fallbackIdentity,
        9,
        9,
      ),
    ).toBeFalse();
    expect(isCurrentPerspectiveAnalysisRequest({ ...state, imageSessionId: 69 }, fallbackIdentity, 9, 9)).toBeFalse();
    expect(
      isCurrentPerspectiveAnalysisRequest({ ...state, adjustmentRevision: 1 }, fallbackIdentity, 9, 9),
    ).toBeFalse();
    expect(() =>
      buildPerspectiveCorrectionEditTransaction(
        { ...state, imageSessionId: 69 },
        fallbackIdentity,
        { resolvedPlan },
        'stale-reopened-a',
      ),
    ).toThrow('perspective_correction_transaction.stale_session');
  });
});
