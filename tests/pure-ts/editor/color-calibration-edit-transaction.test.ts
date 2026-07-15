import { beforeEach, describe, expect, test } from 'bun:test';

import { createEditorImageSession, useEditorStore } from '../../../src/store/useEditorStore';
import { publishAdjustmentSnapshot } from '../../../src/utils/adjustmentSnapshots';
import { INITIAL_ADJUSTMENTS } from '../../../src/utils/adjustments';
import {
  buildColorCalibrationEditTransaction,
  type ColorCalibrationCommitIdentity,
  isCurrentColorCalibrationIdentity,
} from '../../../src/utils/colorCalibrationEditTransaction';
import { legacyAdjustmentsToEditDocumentV2 } from '../../../src/utils/editDocumentV2';

const sourcePath = '/fixture/color-calibration.ARW';
const session = createEditorImageSession({ generation: 41, path: sourcePath, source: 'cache' });
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
const identity = (overrides: Partial<ColorCalibrationCommitIdentity> = {}): ColorCalibrationCommitIdentity => ({
  adjustmentRevision: 0,
  imageSessionId: session.id,
  sourceIdentity: sourcePath,
  ...overrides,
});

describe('color calibration edit transaction', () => {
  beforeEach(() => {
    const adjustments = structuredClone(INITIAL_ADJUSTMENTS);
    const editDocumentV2 = legacyAdjustmentsToEditDocumentV2(adjustments);
    useEditorStore.getState().hydrateEditorRenderAuthority({
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

  test('commits one complete calibration node revision and preserves unrelated nodes through Undo', () => {
    const state = useEditorStore.getState();
    const colorCalibration = { ...INITIAL_ADJUSTMENTS.colorCalibration, redHue: 18 };
    const result = state.applyEditTransaction(
      buildColorCalibrationEditTransaction(state, identity(), colorCalibration, 'calibration-red-hue'),
    );

    expect(result).toMatchObject({ changedKeys: ['colorCalibration'], nextAdjustmentRevision: 1, noOp: false });
    expect(result.afterEditDocumentV2.nodes.color_calibration.params).toEqual({ colorCalibration });
    expect(result.afterEditDocumentV2.nodes.scene_curve).toBe(result.beforeEditDocumentV2.nodes.scene_curve);
    expect(useEditorStore.getState().history).toHaveLength(2);

    useEditorStore.getState().undo();
    expect(useEditorStore.getState().adjustments.colorCalibration).toEqual(INITIAL_ADJUSTMENTS.colorCalibration);
  });

  test('rejects stale source, session, and revision before constructing a node transaction', () => {
    const state = useEditorStore.getState();
    const calibration = INITIAL_ADJUSTMENTS.colorCalibration;
    expect(() =>
      buildColorCalibrationEditTransaction(
        state,
        identity({ sourceIdentity: '/fixture/stale.ARW' }),
        calibration,
        'stale-source',
      ),
    ).toThrow('color_calibration_transaction.stale_source');
    expect(() =>
      buildColorCalibrationEditTransaction(
        state,
        identity({ imageSessionId: 'editor-image-session:stale' }),
        calibration,
        'stale-session',
      ),
    ).toThrow('color_calibration_transaction.stale_session');
    expect(() =>
      buildColorCalibrationEditTransaction(state, identity({ adjustmentRevision: 1 }), calibration, 'stale-revision'),
    ).toThrow('color_calibration_transaction.stale_revision');
  });

  test('commits through fallback authority and rejects stale A to B to A identities', () => {
    useEditorStore.setState({
      finalPreviewUrl: 'blob:fallback-calibration-before',
      imageSession: null,
      imageSessionId: 87,
    });
    const state = useEditorStore.getState();
    const fallbackIdentity: ColorCalibrationCommitIdentity = {
      adjustmentRevision: 0,
      imageSessionId: 'editor-image-session:87',
      sourceIdentity: sourcePath,
    };
    const noOp = state.applyEditTransaction(
      buildColorCalibrationEditTransaction(
        state,
        fallbackIdentity,
        structuredClone(INITIAL_ADJUSTMENTS.colorCalibration),
        'fallback-calibration-no-op',
      ),
    );
    expect(noOp.noOp).toBeTrue();
    expect(useEditorStore.getState()).toMatchObject({
      adjustmentRevision: 0,
      finalPreviewUrl: 'blob:fallback-calibration-before',
      historyIndex: 0,
      lastEditApplicationReceipt: null,
    });

    const next = { ...INITIAL_ADJUSTMENTS.colorCalibration, redHue: 22 };
    const result = state.applyEditTransaction(
      buildColorCalibrationEditTransaction(state, fallbackIdentity, next, 'fallback-calibration'),
    );
    expect(result).toMatchObject({ changedKeys: ['colorCalibration'], nextAdjustmentRevision: 1, noOp: false });
    expect(useEditorStore.getState()).toMatchObject({
      finalPreviewUrl: null,
      historyIndex: 1,
      lastEditApplicationReceipt: {
        imageSessionId: fallbackIdentity.imageSessionId,
        transactionId: 'fallback-calibration',
      },
    });
    expect(useEditorStore.getState().history).toHaveLength(2);
    useEditorStore.getState().undo();
    expect(useEditorStore.getState().adjustments.colorCalibration).toEqual(INITIAL_ADJUSTMENTS.colorCalibration);

    expect(isCurrentColorCalibrationIdentity(state, fallbackIdentity)).toBeTrue();
    expect(
      isCurrentColorCalibrationIdentity(
        { ...state, imageSessionId: 88, selectedImage: { path: '/fixture/B.ARW' } },
        fallbackIdentity,
      ),
    ).toBeFalse();
    expect(isCurrentColorCalibrationIdentity({ ...state, imageSessionId: 89 }, fallbackIdentity)).toBeFalse();
    expect(isCurrentColorCalibrationIdentity({ ...state, adjustmentRevision: 1 }, fallbackIdentity)).toBeFalse();
    expect(() =>
      buildColorCalibrationEditTransaction(
        { ...state, imageSessionId: 89 },
        fallbackIdentity,
        next,
        'stale-reopened-a',
      ),
    ).toThrow('color_calibration_transaction.stale_session');
  });
});
