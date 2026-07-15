import { beforeEach, describe, expect, test } from 'bun:test';

import { createEditorImageSession, useEditorStore } from '../../../src/store/useEditorStore';
import { publishAdjustmentSnapshot } from '../../../src/utils/adjustmentSnapshots';
import { INITIAL_ADJUSTMENTS } from '../../../src/utils/adjustments';
import { legacyAdjustmentsToEditDocumentV2 } from '../../../src/utils/editDocumentV2';
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

  test('commits a resolved analysis plan as one persistent geometry revision with Undo', () => {
    const state = useEditorStore.getState();
    expect(capturePerspectiveCorrectionCommitIdentity(state)).toEqual(identity());
    const request = buildPerspectiveCorrectionEditTransaction(
      state,
      identity(),
      { resolvedPlan },
      'perspective-analysis',
    );
    const result = state.applyEditTransaction(request);

    expect(result.after.perspectiveCorrection.resolvedPlan).toEqual(resolvedPlan);
    expect(result.applicationReceipt).toMatchObject({
      adjustmentRevision: 1,
      persistence: 'commit',
      source: 'geometry-tool',
      transactionId: 'perspective-analysis',
    });
    expect(result.invalidatedStages).toContain('geometry');
    expect(useEditorStore.getState()).toMatchObject({ adjustmentRevision: 1, historyIndex: 1 });
    useEditorStore.getState().undo();
    expect(useEditorStore.getState().adjustments.perspectiveCorrection.resolvedPlan).toBeNull();
  });

  test('validates manual patches, preserves exact no-ops, and rejects every stale identity dimension', () => {
    const state = useEditorStore.getState();
    const build = (commitIdentity: PerspectiveCorrectionCommitIdentity, patch = { amount: 72 }) =>
      buildPerspectiveCorrectionEditTransaction(state, commitIdentity, patch, 'manual-perspective');

    const noOp = state.applyEditTransaction(
      build(identity(), { amount: state.adjustments.perspectiveCorrection.amount }),
    );
    expect(noOp.noOp).toBe(true);
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
});
