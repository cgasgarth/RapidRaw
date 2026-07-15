import { beforeEach, describe, expect, test } from 'bun:test';

import { createEditorImageSession, useEditorStore } from '../../../src/store/useEditorStore';
import { publishAdjustmentSnapshot } from '../../../src/utils/adjustmentSnapshots';
import { INITIAL_ADJUSTMENTS } from '../../../src/utils/adjustments';
import {
  buildColorCalibrationEditTransaction,
  type ColorCalibrationCommitIdentity,
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
});
