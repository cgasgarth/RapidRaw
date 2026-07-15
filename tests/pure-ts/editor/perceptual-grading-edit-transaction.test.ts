import { beforeEach, describe, expect, test } from 'bun:test';

import { createEditorImageSession, useEditorStore } from '../../../src/store/useEditorStore';
import { publishAdjustmentSnapshot } from '../../../src/utils/adjustmentSnapshots';
import { INITIAL_ADJUSTMENTS } from '../../../src/utils/adjustments';
import { perceptualGradingFromWheelSurface } from '../../../src/utils/color/perceptualGrading';
import { legacyAdjustmentsToEditDocumentV2 } from '../../../src/utils/editDocumentV2';
import {
  buildPerceptualGradingEditTransaction,
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
    expect(result.afterEditDocumentV2.nodes.perceptual_grading.params).toEqual({
      colorGrading,
      perceptualGradingV1,
    });
    expect(result.afterEditDocumentV2.nodes.scene_curve).toBe(result.beforeEditDocumentV2.nodes.scene_curve);
    expect(useEditorStore.getState().history).toHaveLength(2);

    useEditorStore.getState().undo();
    expect(useEditorStore.getState().adjustments.colorGrading).toEqual(INITIAL_ADJUSTMENTS.colorGrading);
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
});
