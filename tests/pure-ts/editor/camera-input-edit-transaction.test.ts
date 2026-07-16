import { beforeEach, describe, expect, test } from 'bun:test';

import { createEditorImageSession, useEditorStore } from '../../../src/store/useEditorStore';
import { INITIAL_ADJUSTMENTS } from '../../../src/utils/adjustments';
import type { CameraInputCommitIdentity } from '../../../src/utils/cameraInputEditTransaction';
import {
  buildCameraInputEditTransaction,
  captureCameraInputCommitIdentity,
  isCurrentAutoWhiteBalanceRequest,
  isCurrentCameraInputAsyncRequest,
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
    expect(result.afterEditDocumentV2.nodes['camera_input']?.params).toMatchObject({
      cameraProfile: 'camera_neutral',
      cameraProfileAmount: 72,
    });
    expect(result.afterEditDocumentV2.nodes['scene_curve']).toBe(result.beforeEditDocumentV2.nodes['scene_curve']);
    expect(useEditorStore.getState().history).toHaveLength(2);
    expect(useEditorStore.getState().lastEditApplicationReceipt).toMatchObject({
      adjustmentRevision: 1,
      persistence: 'commit',
      source: 'manual-control',
    });

    useEditorStore.getState().undo();
    expect(useEditorStore.getState().adjustmentSnapshot.value).toMatchObject({
      cameraProfile: 'camera_standard',
      cameraProfileAmount: 100,
      exposure: 0.45,
    });
  });

  test('commits the complete technical white-balance identity atomically', () => {
    const whiteBalanceTechnical = buildTechnicalWhiteBalance('kelvin_tint', 5_200, -0.012, 'user', 'raw_scene_linear');
    const state = useEditorStore.getState();
    const result = state.applyEditTransaction(
      buildCameraInputEditTransaction(state, identity(), { whiteBalanceTechnical }, 'white-balance'),
    );

    expect(result.changedKeys).toEqual(['whiteBalanceTechnical']);
    expect(result.afterEditDocumentV2.nodes['camera_input']?.params).toMatchObject({
      whiteBalanceTechnical,
    });
    expect(useEditorStore.getState().history).toHaveLength(2);
    useEditorStore.getState().undo();
    expect(useEditorStore.getState().adjustmentSnapshot.value.whiteBalanceTechnical.mode).toBe('as_shot');
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

  test('accepts only the latest Auto white-balance request for the captured source, session, and revision', () => {
    const state = useEditorStore.getState();
    expect(isCurrentCameraInputAsyncRequest(state, identity(), 5, 5)).toBeTrue();
    expect(isCurrentCameraInputAsyncRequest(state, identity(), 4, 5)).toBeFalse();
    expect(isCurrentCameraInputAsyncRequest(state, identity({ adjustmentRevision: 1 }), 5, 5)).toBeFalse();
    expect(
      isCurrentCameraInputAsyncRequest(
        { ...state, selectedImage: { path: '/fixture/successor.ARW' } },
        identity(),
        5,
        5,
      ),
    ).toBeFalse();
    expect(
      isCurrentCameraInputAsyncRequest(
        { ...state, imageSession: { id: 'editor-image-session:successor' } },
        identity(),
        5,
        5,
      ),
    ).toBeFalse();
    const rawConfiguration = { enabled: true, inputSemantics: 'raw_scene_linear' } as const;
    expect(isCurrentAutoWhiteBalanceRequest(state, identity(), 5, 5, rawConfiguration, rawConfiguration)).toBeTrue();
    expect(
      isCurrentAutoWhiteBalanceRequest(state, identity(), 5, 5, rawConfiguration, {
        enabled: true,
        inputSemantics: 'rendered_scene_linear_approximation',
      }),
    ).toBeFalse();
    expect(
      isCurrentAutoWhiteBalanceRequest(state, identity(), 5, 5, rawConfiguration, {
        ...rawConfiguration,
        enabled: false,
      }),
    ).toBeFalse();
  });

  test('applies and validates camera input through the canonical fallback session', () => {
    useEditorStore.setState({
      finalPreviewUrl: 'blob:fallback-camera-before',
      imageSession: null,
      imageSessionId: 32,
    });
    const state = useEditorStore.getState();
    const fallbackIdentity = captureCameraInputCommitIdentity(state);
    expect(fallbackIdentity).toEqual({
      adjustmentRevision: 0,
      imageSessionId: 'editor-image-session:32',
      sourceIdentity: sourcePath,
    });
    if (fallbackIdentity === null) throw new Error('expected fallback camera identity');
    const noOp = state.applyEditTransaction(
      buildCameraInputEditTransaction(state, fallbackIdentity, { cameraProfile: 'camera_standard' }, 'fallback-no-op'),
    );
    expect(noOp.noOp).toBeTrue();
    expect(useEditorStore.getState().finalPreviewUrl).toBe('blob:fallback-camera-before');
    const result = useEditorStore
      .getState()
      .applyEditTransaction(
        buildCameraInputEditTransaction(
          useEditorStore.getState(),
          fallbackIdentity,
          { cameraProfile: 'camera_neutral', cameraProfileAmount: 64 },
          'fallback-camera',
        ),
      );
    expect(result).toMatchObject({ changedKeys: ['cameraProfile', 'cameraProfileAmount'], noOp: false });
    expect(useEditorStore.getState().history).toHaveLength(2);
    expect(useEditorStore.getState().finalPreviewUrl).toBeNull();
    expect(useEditorStore.getState().lastEditApplicationReceipt).toMatchObject({
      imageSessionId: fallbackIdentity.imageSessionId,
      transactionId: 'fallback-camera',
    });
    useEditorStore.getState().undo();
    expect(useEditorStore.getState().adjustmentSnapshot.value.cameraProfile).toBe('camera_standard');

    expect(() =>
      buildCameraInputEditTransaction(
        { ...state, imageSessionId: 33 },
        fallbackIdentity,
        { cameraProfile: 'camera_neutral' },
        'stale-fallback',
      ),
    ).toThrow('camera_input_transaction.stale_session');
    expect(isCurrentCameraInputAsyncRequest({ ...state, imageSessionId: 33 }, fallbackIdentity, 1, 1)).toBeFalse();
  });
});
