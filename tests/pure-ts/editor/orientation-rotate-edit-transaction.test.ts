import { beforeEach, describe, expect, test } from 'bun:test';
import { editDocumentGeometryV2Schema } from '../../../packages/rawengine-schema/src/editDocumentV2';
import { createEditorImageSession, useEditorStore } from '../../../src/store/useEditorStore';
import { INITIAL_ADJUSTMENTS } from '../../../src/utils/adjustments';
import { calculateCenteredCrop, normalizedCropFromPixelCrop } from '../../../src/utils/cropUtils';
import { createDefaultEditDocumentV2, patchEditDocumentV2Node } from '../../../src/utils/editDocumentV2';
import {
  buildOrientationRotateEditTransaction,
  captureOrientationRotateCommitIdentity,
  type OrientationRotateCommitIdentity,
} from '../../../src/utils/orientationRotateEditTransaction';

const sourcePath = '/fixture/orientation-rotate.ARW';
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

const identity = (overrides: Partial<OrientationRotateCommitIdentity> = {}): OrientationRotateCommitIdentity => ({
  adjustmentRevision: 0,
  imageSessionId: session.id,
  sourceIdentity: sourcePath,
  ...overrides,
});

describe('orientation rotate edit transaction', () => {
  beforeEach(() => {
    const adjustments = {
      ...structuredClone(INITIAL_ADJUSTMENTS),
      aspectRatio: 4 / 3,
      crop: { height: 0.6, unit: 'normalized' as const, width: 0.6, x: 0.2, y: 0.2 },
      exposure: 0.35,
      rotation: 2.5,
    };
    const editDocumentV2 = patchEditDocumentV2Node(
      patchEditDocumentV2Node(createDefaultEditDocumentV2(), 'geometry', {
        aspectRatio: adjustments.aspectRatio,
        crop: adjustments.crop,
        rotation: adjustments.rotation,
      }),
      'scene_global_color_tone',
      { exposure: adjustments.exposure },
    );
    useEditorStore.getState().hydrateEditorRenderAuthority({
      adjustmentRevision: 0,
      editDocumentV2,
      finalPreviewUrl: 'blob:orientation-before-final',
      historyCheckpoints: [],
      historyIndex: 0,
      imageSession: session,
      imageSessionId: session.generation,
      lastEditApplicationReceipt: null,
      navigatorPreviewArtifact: {
        graphIdentity: 'orientation-before-graph',
        id: 'orientation-before-navigator',
        imageSessionId: session.id,
        url: 'blob:orientation-before-navigator',
      },
      selectedImage,
      history: [editDocumentV2],
    });
  });

  test('captures exact authority and commits clockwise geometry with one history entry and Undo', () => {
    const state = useEditorStore.getState();
    expect(captureOrientationRotateCommitIdentity(state)).toEqual(identity());
    const request = buildOrientationRotateEditTransaction(state, identity(), 90, 'rotate-cw');
    expect(request.operations).toEqual([
      {
        nodeType: 'geometry',
        patch: {
          aspectRatio: 3 / 4,
          crop: normalizedCropFromPixelCrop(calculateCenteredCrop(4000, 3000, 1, 3 / 4)!, 3000, 4000),
          orientationSteps: 1,
          rotation: 0,
        },
        type: 'patch-edit-document-node',
      },
    ]);
    const result = state.applyEditTransaction(request);
    const after = useEditorStore.getState();

    expect(result).toMatchObject({
      changedKeys: [
        'nodes.geometry.params.aspectRatio',
        'nodes.geometry.params.crop',
        'nodes.geometry.params.orientationSteps',
        'nodes.geometry.params.rotation',
      ],
      nextAdjustmentRevision: 1,
      noOp: false,
      source: 'geometry-tool',
    });
    expect(after.history).toHaveLength(2);
    expect(after.lastEditApplicationReceipt).toMatchObject({
      adjustmentRevision: 1,
      persistence: 'commit',
      source: 'geometry-tool',
      transactionId: 'rotate-cw',
    });
    expect(after.finalPreviewUrl).toBeNull();
    expect(after.navigatorPreviewArtifact).toBeNull();
    expect(editDocumentGeometryV2Schema.parse(result.after.nodes['geometry']?.params)).toMatchObject({
      aspectRatio: 3 / 4,
      orientationSteps: 1,
      rotation: 0,
    });

    after.undo();
    expect(useEditorStore.getState().editDocumentV2.geometry).toMatchObject({
      aspectRatio: 4 / 3,
      orientationSteps: 0,
      rotation: 2.5,
    });
    expect(useEditorStore.getState().editDocumentV2.nodes['scene_global_color_tone']?.params['exposure']).toBe(0.35);
  });

  test('supports counterclockwise and half-turn geometry semantics', () => {
    const state = useEditorStore.getState();
    const counterclockwise = buildOrientationRotateEditTransaction(state, identity(), -90, 'rotate-ccw');
    expect(counterclockwise.operations[0]).toMatchObject({
      nodeType: 'geometry',
      patch: { aspectRatio: 3 / 4, orientationSteps: 3, rotation: 0 },
    });
    const halfTurn = buildOrientationRotateEditTransaction(state, identity(), 180, 'rotate-half');
    expect(halfTurn.operations[0]).toMatchObject({
      nodeType: 'geometry',
      patch: { aspectRatio: 4 / 3, orientationSteps: 2, rotation: 0 },
    });
  });

  test('keeps a full-cycle rotation an exact no-op without history, receipt, or output invalidation', () => {
    const before = useEditorStore.getState();
    const result = before.applyEditTransaction(
      buildOrientationRotateEditTransaction(before, identity(), 360, 'rotate-full-cycle'),
    );
    const after = useEditorStore.getState();

    expect(result).toMatchObject({ changedKeys: [], nextAdjustmentRevision: 0, noOp: true });
    expect(after.editDocumentV2).toBe(before.editDocumentV2);
    expect(after.history).toBe(before.history);
    expect(after.lastEditApplicationReceipt).toBeNull();
    expect(after.finalPreviewUrl).toBe('blob:orientation-before-final');
    expect(after.navigatorPreviewArtifact).toBe(before.navigatorPreviewArtifact);
  });

  test('rejects stale source, session, and revision with zero editor mutation', () => {
    const before = useEditorStore.getState();
    expect(() =>
      buildOrientationRotateEditTransaction(before, identity({ sourceIdentity: '/fixture/other.ARW' }), 90, 'stale'),
    ).toThrow('orientation_rotate_transaction.stale_source');
    expect(() =>
      buildOrientationRotateEditTransaction(before, identity({ imageSessionId: 'successor-session' }), 90, 'stale'),
    ).toThrow('orientation_rotate_transaction.stale_session');
    expect(() =>
      buildOrientationRotateEditTransaction(before, identity({ adjustmentRevision: 1 }), 90, 'stale'),
    ).toThrow('orientation_rotate_transaction.stale_revision');
    expect(useEditorStore.getState().editDocumentV2).toBe(before.editDocumentV2);
    expect(useEditorStore.getState().history).toBe(before.history);
    expect(useEditorStore.getState().adjustmentRevision).toBe(0);
  });

  test('rejects malformed angles and requires a selected image', () => {
    const state = useEditorStore.getState();
    expect(() => buildOrientationRotateEditTransaction(state, identity(), 45, 'invalid')).toThrow(
      'orientation_rotate_transaction.invalid_degrees',
    );
    expect(() => buildOrientationRotateEditTransaction(state, identity(), Number.NaN, 'invalid')).toThrow(
      'orientation_rotate_transaction.invalid_degrees',
    );
    expect(captureOrientationRotateCommitIdentity({ ...state, selectedImage: null })).toBeNull();
  });

  test('rotates selected-image fallback sessions without an explicit imageSession object', () => {
    const state = useEditorStore.getState();
    useEditorStore.setState({ imageSession: null, imageSessionId: 52 });
    const fallbackState = useEditorStore.getState();
    const fallbackIdentity = captureOrientationRotateCommitIdentity(fallbackState);
    expect(fallbackIdentity).toEqual({
      adjustmentRevision: 0,
      imageSessionId: 'editor-image-session:52',
      sourceIdentity: sourcePath,
    });
    if (fallbackIdentity === null) throw new Error('expected fallback identity');
    const result = fallbackState.applyEditTransaction(
      buildOrientationRotateEditTransaction(fallbackState, fallbackIdentity, -90, 'fallback-rotate'),
    );
    expect(result).toMatchObject({
      changedKeys: [
        'nodes.geometry.params.aspectRatio',
        'nodes.geometry.params.crop',
        'nodes.geometry.params.orientationSteps',
        'nodes.geometry.params.rotation',
      ],
      noOp: false,
    });
    expect(useEditorStore.getState().editDocumentV2.geometry).toMatchObject({
      aspectRatio: 3 / 4,
      orientationSteps: 3,
    });

    expect(() =>
      buildOrientationRotateEditTransaction(
        { ...state, imageSession: null, imageSessionId: 53 },
        fallbackIdentity,
        90,
        'stale-fallback',
      ),
    ).toThrow('orientation_rotate_transaction.stale_session');
  });
});
