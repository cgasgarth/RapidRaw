import { beforeEach, describe, expect, test } from 'bun:test';

import { createEditorImageSession, useEditorStore } from '../../../src/store/useEditorStore';
import { publishAdjustmentSnapshot } from '../../../src/utils/adjustmentSnapshots';
import { INITIAL_ADJUSTMENTS } from '../../../src/utils/adjustments';
import {
  createDefaultEditDocumentV2,
  editDocumentV2ToLegacyAdjustments,
  legacyAdjustmentsToEditDocumentV2,
} from '../../../src/utils/editDocumentV2';
import {
  applyEditorTeardownIfCurrent,
  buildEditorTeardownTransaction,
  captureEditorTeardownIdentity,
  isEditorTeardownIdentityCurrent,
} from '../../../src/utils/editorTeardownTransaction';
import { buildImageOpenHydrationEditTransaction } from '../../../src/utils/imageOpenHydrationEditTransaction';

const path = '/fixtures/teardown-A.ARW';
const session = createEditorImageSession({ generation: 70, path, source: 'cache' });
const selectedImage = {
  exif: null,
  height: 3000,
  isRaw: true,
  isReady: true,
  metadata: null,
  originalUrl: null,
  path,
  rawDevelopmentReport: null,
  thumbnailUrl: '',
  width: 4500,
};

describe('editor teardown transaction', () => {
  const defaultDocument = createDefaultEditDocumentV2();
  const defaultAdjustments = editDocumentV2ToLegacyAdjustments(defaultDocument);
  beforeEach(() => {
    const adjustments = { ...structuredClone(INITIAL_ADJUSTMENTS), contrast: 12, exposure: 1.4 };
    const editDocumentV2 = legacyAdjustmentsToEditDocumentV2(adjustments);
    useEditorStore.getState().hydrateEditorRenderAuthority({
      activeMaskContainerId: 'mask-container-A',
      activeMaskId: 'mask-A',
      adjustmentRevision: 5,
      editDocumentV2,
      finalPreviewUrl: 'blob:image-a-preview',
      hasRenderedFirstFrame: true,
      history: [legacyAdjustmentsToEditDocumentV2(INITIAL_ADJUSTMENTS), editDocumentV2],
      historyCheckpoints: [{ createdAt: '2026-07-15T00:00:00.000Z', historyIndex: 1, id: 'a', label: 'A' }],
      historyIndex: 1,
      imageSession: session,
      imageSessionId: session.generation,
      interactivePatch: {
        basePreviewUrl: 'blob:image-a-preview',
        fullHeight: 3000,
        fullWidth: 4500,
        geometryIdentity: 1,
        normH: 0.1,
        normW: 0.1,
        normX: 0.2,
        normY: 0.2,
        pixelHeight: 300,
        pixelWidth: 450,
        sourceImagePath: path,
        url: 'blob:image-a-patch',
      },
      lastWhiteBalancePickerReceipt: {
        algorithm: 'neutral_patch_scene_linear_chromaticity_v1',
        averageRgb: { blue: 120, green: 128, red: 130 },
        clippedChannelCount: 0,
        confidence: 0.9,
        coordinates: { imageX: 10, imageY: 20, previewPixelX: 5, previewPixelY: 10 },
        estimatedDuv: 0,
        estimatedKelvin: 5500,
        estimatedXy: [0.33, 0.34],
        patchPixelCount: 25,
        previewIdentity: 'blob:image-a-preview',
        rejectedClippedPixels: 0,
        resultingDuv: 0,
        resultingKelvin: 5500,
        selectedImagePath: path,
        spatialVariance: 0.01,
      },
      navigatorPreviewArtifact: {
        graphIdentity: 'image-a-graph',
        id: 'image-a-navigator',
        imageSessionId: session.id,
        url: 'blob:image-a-navigator',
      },
      previewQualityStatus: {
        backend: 'wgpu',
        effectiveRoi: null,
        effectiveTargetResolution: 4096,
        estimatedWorkingBytes: 1,
        generation: 1,
        limitedBy: null,
        phase: 'final_ready',
        reason: 'test',
        requestId: 1,
        requestedTargetResolution: 4096,
        sufficientForSemanticZoom: true,
        tier: 'viewport_full',
      },
      provisionalPreviewFrame: {
        receipt: {
          colorAssumption: 'encoded_srgb_vendor_preview',
          frameGeneration: 1,
          height: 1365,
          imageSession: session.generation,
          orientationApplied: true,
          provisionalReason: 'teardown fixture',
          quality: 'embeddedProvisional',
          selectionGeneration: session.generation,
          sourceKind: 'arw',
          sourceRevision: 'source-revision-v1:image-a',
          width: 2048,
        },
        url: 'blob:image-a-provisional',
      },
      selectedImage,
      transformedOriginalUrl: 'blob:image-a-transform',
      uncroppedAdjustedPreviewUrl: 'blob:image-a-uncropped',
    });
  });

  test('editor exit atomically resets authority without a persistence receipt or Undo resurrection', () => {
    const state = useEditorStore.getState();
    const identity = captureEditorTeardownIdentity(state);
    if (identity === null) throw new Error('Expected editor teardown identity.');
    const request = buildEditorTeardownTransaction(state, identity, 'navigation-back');
    let publications = 0;
    const unsubscribe = useEditorStore.subscribe(() => {
      publications += 1;
    });

    const result = state.applyEditorTeardownTransaction(request);
    unsubscribe();
    const after = useEditorStore.getState();
    expect(publications).toBe(1);
    expect(result).toEqual({ adjustmentRevision: 6, adjustmentsChanged: true, transactionId: 'navigation-back' });
    expect(request).not.toHaveProperty('persistence');
    expect(after).toMatchObject({
      activeMaskContainerId: null,
      activeMaskId: null,
      adjustmentRevision: 6,
      finalPreviewUrl: null,
      hasRenderedFirstFrame: false,
      historyIndex: 0,
      imageSession: null,
      interactivePatch: null,
      lastEditApplicationReceipt: null,
      lastWhiteBalancePickerReceipt: null,
      navigatorPreviewArtifact: null,
      previewQualityStatus: null,
      provisionalPreviewFrame: null,
      selectedImage: null,
      transformedOriginalUrl: null,
      uncroppedAdjustedPreviewUrl: null,
    });
    expect(after.adjustmentSnapshot.value).toEqual(defaultAdjustments);
    expect(after.history).toEqual([defaultDocument]);
    expect(after.historyCheckpoints).toEqual([]);

    after.undo();
    expect(useEditorStore.getState().adjustmentSnapshot.value).toEqual(defaultAdjustments);
    expect(useEditorStore.getState().selectedImage).toBeNull();
  });

  test('async folder-switch completion rejects a superseded image with zero mutation', () => {
    const imageA = useEditorStore.getState();
    const identity = captureEditorTeardownIdentity(imageA);
    if (identity === null) throw new Error('Expected folder-switch identity.');
    const request = buildEditorTeardownTransaction(imageA, identity, 'folder-switch');
    const pathB = '/fixtures/teardown-B.CR3';
    const sessionB = createEditorImageSession({ generation: 71, path: pathB, source: 'cold-load' });
    const adjustmentsB = { ...imageA.adjustmentSnapshot.value, exposure: 2.2 };
    const editDocumentB = legacyAdjustmentsToEditDocumentV2(adjustmentsB);
    useEditorStore.getState().hydrateEditorRenderAuthority({
      adjustmentRevision: 6,
      finalPreviewUrl: 'blob:image-b-preview',
      historyIndex: 0,
      imageSession: sessionB,
      imageSessionId: sessionB.generation,
      selectedImage: { ...selectedImage, path: pathB },
      editDocumentV2: editDocumentB,
      history: [editDocumentB],
    });
    const before = useEditorStore.getState();

    expect(isEditorTeardownIdentityCurrent(before, identity)).toBeFalse();
    expect(applyEditorTeardownIfCurrent(before, identity, 'folder-switch-late')).toBeFalse();
    expect(() => before.applyEditorTeardownTransaction(request)).toThrow('editor_teardown.stale_identity');
    const after = useEditorStore.getState();
    expect(after.imageSession).toBe(sessionB);
    expect(after.selectedImage).toBe(before.selectedImage);
    expect(after.adjustmentSnapshot.value).toEqual(adjustmentsB);
    expect(after.history).toBe(before.history);
    expect(after.finalPreviewUrl).toBe('blob:image-b-preview');
  });

  test('canonical fallback clears a legacy selected image without an explicit session', () => {
    useEditorStore.setState({ imageSession: null, imageSessionId: 88 });
    const legacy = useEditorStore.getState();
    const identity = captureEditorTeardownIdentity(legacy);
    expect(identity).toEqual({
      adjustmentRevision: 5,
      imageSessionId: 'editor-image-session:88',
      path,
    });
    if (identity === null) throw new Error('Expected fallback teardown identity.');
    expect(applyEditorTeardownIfCurrent(legacy, identity, 'legacy-exit')).toBeTrue();
    expect(useEditorStore.getState()).toMatchObject({ imageSession: null, selectedImage: null });
    expect(useEditorStore.getState().adjustmentSnapshot.value).toEqual(defaultAdjustments);
  });

  test('clears an already-neutral session without inventing an adjustment revision', () => {
    const editDocumentV2 = structuredClone(defaultDocument);
    useEditorStore.getState().hydrateEditorRenderAuthority({
      adjustmentRevision: 9,
      editDocumentV2,
      historyIndex: 0,
      history: [editDocumentV2],
    });
    const state = useEditorStore.getState();
    const identity = captureEditorTeardownIdentity(state);
    if (identity === null) throw new Error('Expected neutral teardown identity.');

    const result = state.applyEditorTeardownTransaction(
      buildEditorTeardownTransaction(state, identity, 'folder-switch-neutral'),
    );
    expect(result).toEqual({
      adjustmentRevision: 9,
      adjustmentsChanged: false,
      transactionId: 'folder-switch-neutral',
    });
    expect(useEditorStore.getState().adjustmentRevision).toBe(9);
    expect(useEditorStore.getState().lastEditApplicationReceipt).toBeNull();
  });

  test('re-enter hydrates a new image from the clean teardown baseline', () => {
    const state = useEditorStore.getState();
    const identity = captureEditorTeardownIdentity(state);
    if (identity === null) throw new Error('Expected editor teardown identity.');
    state.applyEditorTeardownTransaction(buildEditorTeardownTransaction(state, identity, 'navigation-home'));

    const pathB = '/fixtures/re-enter-B.NEF';
    const sessionB = createEditorImageSession({ generation: 72, path: pathB, source: 'cold-load' });
    useEditorStore.getState().setEditor({
      imageSession: sessionB,
      selectedImage: { ...selectedImage, isReady: false, path: pathB },
    });
    const reentered = useEditorStore.getState();
    const hydrated = { ...structuredClone(INITIAL_ADJUSTMENTS), exposure: -0.6 };
    reentered.applyEditTransaction(
      buildImageOpenHydrationEditTransaction(
        reentered,
        { adjustmentRevision: reentered.adjustmentRevision, imageSessionId: sessionB.id, path: pathB },
        legacyAdjustmentsToEditDocumentV2(hydrated),
        're-enter-hydration',
      ),
    );

    const after = useEditorStore.getState();
    expect(after.imageSession).toBe(sessionB);
    expect(after.selectedImage?.path).toBe(pathB);
    expect(after.adjustmentSnapshot.value.exposure).toBe(-0.6);
    expect(after.adjustmentSnapshot.value.contrast).toBe(0);
    expect(after.history).toEqual([after.editDocumentV2]);
  });
});
