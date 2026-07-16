import { beforeEach, describe, expect, test } from 'bun:test';
import { editDocumentGeometryV2Schema } from '../../../packages/rawengine-schema/src/editDocumentV2';
import { createEditorImageSession, useEditorStore } from '../../../src/store/useEditorStore';
import { publishAdjustmentSnapshot } from '../../../src/utils/adjustmentSnapshots';
import { INITIAL_ADJUSTMENTS } from '../../../src/utils/adjustments';
import {
  buildLensModalEditTransaction,
  buildTransformModalEditTransaction,
  type CropModalEditIdentity,
  captureCropModalEditIdentity,
  isCurrentCropModalEditIdentity,
  type LensModalPatchInput,
} from '../../../src/utils/cropModalEditTransaction';
import { legacyAdjustmentsToEditDocumentV2 } from '../../../src/utils/editDocumentV2';

const sourcePath = '/fixture/crop-modal.ARW';
const session = createEditorImageSession({ generation: 61, path: sourcePath, source: 'cache' });
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
const identity = (overrides: Partial<CropModalEditIdentity> = {}): CropModalEditIdentity => ({
  adjustmentRevision: 0,
  imageSessionId: session.id,
  sourceIdentity: sourcePath,
  ...overrides,
});

const transformInput = {
  aspect: 4,
  distortion: 5,
  horizontal: 6,
  rotate: 1.5,
  scale: 108,
  vertical: 7,
  x_offset: 8,
  y_offset: 9,
};

const lensInput: LensModalPatchInput = {
  lensCorrectionMode: 'manual',
  lensDistortionAmount: 87,
  lensDistortionEnabled: true,
  lensDistortionParams: {
    k1: 0.01,
    k2: 0.02,
    k3: 0.03,
    model: 1,
    tca_vb: 0.99,
    tca_vr: 1.01,
    vig_k1: 0.1,
    vig_k2: 0.2,
    vig_k3: 0.3,
  },
  lensMaker: 'Fixture Optics',
  lensModel: 'Prime 50',
  lensTcaAmount: 77,
  lensTcaEnabled: true,
  lensVignetteAmount: 66,
  lensVignetteEnabled: false,
};

describe('crop modal edit transactions', () => {
  beforeEach(() => {
    const adjustments = { ...structuredClone(INITIAL_ADJUSTMENTS), exposure: 0.45 };
    const editDocumentV2 = legacyAdjustmentsToEditDocumentV2(adjustments);
    useEditorStore.getState().hydrateEditorRenderAuthority({
      adjustmentRevision: 0,
      editDocumentV2,
      finalPreviewUrl: 'blob:crop-modal-before-final',
      historyCheckpoints: [],
      historyIndex: 0,
      imageSession: session,
      imageSessionId: session.generation,
      lastEditApplicationReceipt: null,
      navigatorPreviewArtifact: {
        graphIdentity: 'crop-modal-before-graph',
        id: 'crop-modal-before-navigator',
        imageSessionId: session.id,
        url: 'blob:crop-modal-before-navigator',
      },
      selectedImage,
      history: [editDocumentV2],
    });
  });

  test('commits the transform modal as one geometry transaction with output invalidation and Undo', () => {
    const state = useEditorStore.getState();
    expect(captureCropModalEditIdentity(state)).toEqual(identity());
    const request = buildTransformModalEditTransaction(state, identity(), transformInput, 'transform-modal-apply');
    expect(request.operations).toEqual([
      {
        nodeType: 'geometry',
        patch: {
          transformAspect: 4,
          transformDistortion: 5,
          transformHorizontal: 6,
          transformRotate: 1.5,
          transformScale: 108,
          transformVertical: 7,
          transformXOffset: 8,
          transformYOffset: 9,
        },
        type: 'patch-edit-document-node',
      },
    ]);
    const result = state.applyEditTransaction(request);
    const after = useEditorStore.getState();

    expect(result).toMatchObject({ nextAdjustmentRevision: 1, noOp: false, source: 'geometry-tool' });
    expect(result.changedKeys).toEqual([
      'transformAspect',
      'transformDistortion',
      'transformHorizontal',
      'transformRotate',
      'transformScale',
      'transformVertical',
      'transformXOffset',
      'transformYOffset',
    ]);
    expect(after.history).toHaveLength(2);
    expect(after.lastEditApplicationReceipt).toMatchObject({
      persistence: 'commit',
      source: 'geometry-tool',
      transactionId: 'transform-modal-apply',
    });
    expect(after.finalPreviewUrl).toBeNull();
    expect(after.navigatorPreviewArtifact).toBeNull();

    after.undo();
    expect(useEditorStore.getState().adjustmentSnapshot.value).toMatchObject({
      exposure: 0.45,
      transformDistortion: INITIAL_ADJUSTMENTS.transformDistortion,
      transformScale: INITIAL_ADJUSTMENTS.transformScale,
    });
  });

  test('commits all lens modal fields through one lens-correction node operation', () => {
    const state = useEditorStore.getState();
    const request = buildLensModalEditTransaction(state, identity(), lensInput, 'lens-modal-apply');
    expect(request.operations).toEqual([
      { nodeType: 'lens_correction', patch: lensInput, type: 'patch-edit-document-node' },
    ]);
    const result = state.applyEditTransaction(request);
    expect(result).toMatchObject({ nextAdjustmentRevision: 1, noOp: false, source: 'manual-control' });
    expect(result.after).toMatchObject(lensInput);
    expect(useEditorStore.getState().history).toHaveLength(2);
    expect(useEditorStore.getState().lastEditApplicationReceipt).toMatchObject({
      persistence: 'commit',
      transactionId: 'lens-modal-apply',
    });
  });

  test('keeps an unchanged lens modal apply an exact no-op without invalidating outputs', () => {
    const before = useEditorStore.getState();
    const currentLens: LensModalPatchInput = {
      lensCorrectionMode: before.adjustmentSnapshot.value.lensCorrectionMode,
      lensDistortionAmount: before.adjustmentSnapshot.value.lensDistortionAmount,
      lensDistortionEnabled: before.adjustmentSnapshot.value.lensDistortionEnabled,
      lensDistortionParams: before.adjustmentSnapshot.value.lensDistortionParams,
      lensMaker: before.adjustmentSnapshot.value.lensMaker,
      lensModel: before.adjustmentSnapshot.value.lensModel,
      lensTcaAmount: before.adjustmentSnapshot.value.lensTcaAmount,
      lensTcaEnabled: before.adjustmentSnapshot.value.lensTcaEnabled,
      lensVignetteAmount: before.adjustmentSnapshot.value.lensVignetteAmount,
      lensVignetteEnabled: before.adjustmentSnapshot.value.lensVignetteEnabled,
    };
    const result = before.applyEditTransaction(
      buildLensModalEditTransaction(before, identity(), currentLens, 'lens-modal-no-op'),
    );
    const after = useEditorStore.getState();
    expect(result).toMatchObject({ changedKeys: [], nextAdjustmentRevision: 0, noOp: true });
    expect(after.history).toBe(before.history);
    expect(after.lastEditApplicationReceipt).toBeNull();
    expect(after.finalPreviewUrl).toBe('blob:crop-modal-before-final');
    expect(after.navigatorPreviewArtifact).toBe(before.navigatorPreviewArtifact);
  });

  test('keeps an unchanged transform modal apply an exact no-op', () => {
    const before = useEditorStore.getState();
    const currentTransform = {
      aspect: before.adjustmentSnapshot.value.transformAspect,
      distortion: before.adjustmentSnapshot.value.transformDistortion,
      horizontal: before.adjustmentSnapshot.value.transformHorizontal,
      rotate: before.adjustmentSnapshot.value.transformRotate,
      scale: before.adjustmentSnapshot.value.transformScale,
      vertical: before.adjustmentSnapshot.value.transformVertical,
      x_offset: before.adjustmentSnapshot.value.transformXOffset,
      y_offset: before.adjustmentSnapshot.value.transformYOffset,
    };
    const result = before.applyEditTransaction(
      buildTransformModalEditTransaction(before, identity(), currentTransform, 'transform-modal-no-op'),
    );
    const after = useEditorStore.getState();
    expect(result).toMatchObject({ changedKeys: [], nextAdjustmentRevision: 0, noOp: true });
    expect(after.history).toBe(before.history);
    expect(after.finalPreviewUrl).toBe('blob:crop-modal-before-final');
  });

  test('rejects stale source, session, and revision identities before editor mutation', () => {
    const before = useEditorStore.getState();
    expect(() =>
      buildTransformModalEditTransaction(
        before,
        identity({ sourceIdentity: '/fixture/other.ARW' }),
        transformInput,
        'stale',
      ),
    ).toThrow('crop_modal_transaction.stale_source');
    expect(() =>
      buildLensModalEditTransaction(before, identity({ imageSessionId: 'successor-session' }), lensInput, 'stale'),
    ).toThrow('crop_modal_transaction.stale_session');
    expect(() =>
      buildLensModalEditTransaction(before, identity({ adjustmentRevision: 1 }), lensInput, 'stale'),
    ).toThrow('crop_modal_transaction.stale_revision');
    expect(isCurrentCropModalEditIdentity(before, identity({ adjustmentRevision: 1 }))).toBe(false);
    expect(useEditorStore.getState().adjustmentSnapshot.value).toBe(before.adjustmentSnapshot.value);
    expect(useEditorStore.getState().history).toBe(before.history);
  });

  test('captures and validates canonical fallback image-session identity', () => {
    useEditorStore.setState({ imageSession: null, imageSessionId: 62 });
    const state = useEditorStore.getState();
    const fallbackIdentity = captureCropModalEditIdentity(state);
    expect(fallbackIdentity).toEqual({
      adjustmentRevision: 0,
      imageSessionId: 'editor-image-session:62',
      sourceIdentity: sourcePath,
    });
    if (fallbackIdentity === null) throw new Error('expected fallback modal identity');
    expect(isCurrentCropModalEditIdentity(state, fallbackIdentity)).toBe(true);
    const result = state.applyEditTransaction(
      buildTransformModalEditTransaction(state, fallbackIdentity, transformInput, 'fallback-transform'),
    );
    expect(result.noOp).toBe(false);
  });

  test('hydrates older geometry nodes with backward-compatible transform defaults', () => {
    expect(
      editDocumentGeometryV2Schema.parse({
        aspectRatio: null,
        crop: null,
        flipHorizontal: false,
        flipVertical: false,
        orientationSteps: 0,
        rotation: 0,
      }),
    ).toMatchObject({
      transformAspect: 0,
      transformDistortion: 0,
      transformHorizontal: 0,
      transformRotate: 0,
      transformScale: 100,
      transformVertical: 0,
      transformXOffset: 0,
      transformYOffset: 0,
    });
  });
});
