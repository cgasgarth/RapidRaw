import { beforeEach, describe, expect, test } from 'bun:test';

import { createEditorImageSession, useEditorStore } from '../../../src/store/useEditorStore';
import { publishAdjustmentSnapshot } from '../../../src/utils/adjustmentSnapshots';
import { INITIAL_ADJUSTMENTS } from '../../../src/utils/adjustments';
import type { CameraInputCommitIdentity } from '../../../src/utils/cameraInputEditTransaction';
import {
  buildCameraInputEditTransaction,
  captureCameraInputCommitIdentity,
} from '../../../src/utils/cameraInputEditTransaction';
import { buildTechnicalWhiteBalance } from '../../../src/utils/color/whiteBalance';
import { legacyAdjustmentsToEditDocumentV2 } from '../../../src/utils/editDocumentV2';

const sourcePath = '/fixture/camera-input.ARW';
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
const identity = (overrides: Partial<CameraInputCommitIdentity> = {}): CameraInputCommitIdentity => ({
  adjustmentRevision: 0,
  imageSessionId: session.id,
  sourceIdentity: sourcePath,
  ...overrides,
});

describe('camera input edit transaction', () => {
  beforeEach(() => {
    const adjustments = { ...structuredClone(INITIAL_ADJUSTMENTS), exposure: 0.45 };
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

  test('commits profile identity and amount as one exact Camera Input node revision', () => {
    const state = useEditorStore.getState();
    const request = buildCameraInputEditTransaction(
      state,
      identity(),
      { cameraProfile: 'camera_neutral', cameraProfileAmount: 72 },
      'profile',
    );
    const result = state.applyEditTransaction(request);

    expect(request.operations).toEqual([
      {
        nodeType: 'camera_input',
        patch: { cameraProfile: 'camera_neutral', cameraProfileAmount: 72 },
        type: 'patch-edit-document-node',
      },
    ]);
    expect(result.after).toMatchObject({ cameraProfile: 'camera_neutral', cameraProfileAmount: 72, exposure: 0.45 });
    expect(result.afterEditDocumentV2.nodes.camera_input.params).toMatchObject({
      cameraProfile: 'camera_neutral',
      cameraProfileAmount: 72,
    });
    expect(result.afterEditDocumentV2.nodes.scene_curve).toBe(result.beforeEditDocumentV2.nodes.scene_curve);
    expect(useEditorStore.getState().history).toHaveLength(2);
    expect(useEditorStore.getState().lastEditApplicationReceipt).toMatchObject({
      adjustmentRevision: 1,
      persistence: 'commit',
      source: 'manual-control',
    });

    useEditorStore.getState().undo();
    expect(useEditorStore.getState().adjustments).toMatchObject({
      cameraProfile: 'camera_standard',
      cameraProfileAmount: 100,
      exposure: 0.45,
    });
  });

  test('commits the complete technical and creative white-balance identity atomically', () => {
    const whiteBalanceTechnical = buildTechnicalWhiteBalance('kelvin_tint', 5_200, -0.012, 'user', 'raw_scene_linear');
    const state = useEditorStore.getState();
    const result = state.applyEditTransaction(
      buildCameraInputEditTransaction(
        state,
        identity(),
        {
          creativeTemperature: 14,
          creativeTint: -8,
          whiteBalanceMigration: 'native_v1',
          whiteBalanceTechnical,
        },
        'white-balance',
      ),
    );

    expect(result.changedKeys).toEqual(['creativeTemperature', 'creativeTint', 'whiteBalanceTechnical']);
    expect(result.afterEditDocumentV2.nodes.camera_input.params).toMatchObject({
      creativeTemperature: 14,
      creativeTint: -8,
      whiteBalanceMigration: 'native_v1',
      whiteBalanceTechnical,
    });
    expect(useEditorStore.getState().history).toHaveLength(2);
    useEditorStore.getState().undo();
    expect(useEditorStore.getState().adjustments.whiteBalanceTechnical.mode).toBe('as_shot');
  });

  test('captures identity, rejects stale commits and malformed values, and preserves exact no-ops', () => {
    const state = useEditorStore.getState();
    expect(captureCameraInputCommitIdentity(state)).toEqual(identity());
    expect(() =>
      buildCameraInputEditTransaction(
        state,
        identity({ sourceIdentity: '/fixture/stale.ARW' }),
        { cameraProfile: 'camera_neutral' },
        'stale-source',
      ),
    ).toThrow('camera_input_transaction.stale_source');
    expect(() =>
      buildCameraInputEditTransaction(
        state,
        identity({ imageSessionId: 'editor-image-session:stale' }),
        { cameraProfile: 'camera_neutral' },
        'stale-session',
      ),
    ).toThrow('camera_input_transaction.stale_session');
    expect(() =>
      buildCameraInputEditTransaction(
        state,
        identity({ adjustmentRevision: 1 }),
        { cameraProfile: 'camera_neutral' },
        'stale-revision',
      ),
    ).toThrow('camera_input_transaction.stale_revision');
    expect(() =>
      state.applyEditTransaction(
        buildCameraInputEditTransaction(state, identity(), { cameraProfileAmount: 101 }, 'invalid'),
      ),
    ).toThrow();

    const noOp = state.applyEditTransaction(
      buildCameraInputEditTransaction(state, identity(), { cameraProfile: 'camera_standard' }, 'no-op'),
    );
    expect(noOp.noOp).toBeTrue();
    expect(useEditorStore.getState().history).toHaveLength(1);
    expect(useEditorStore.getState().adjustmentRevision).toBe(0);
  });
});
