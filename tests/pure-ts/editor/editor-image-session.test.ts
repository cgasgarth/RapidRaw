import { afterEach, describe, expect, test } from 'bun:test';
import type { SelectedImage } from '../../../src/components/ui/AppProperties';
import {
  createEditorImageSession,
  isEditorImageSessionCurrent,
  useEditorStore,
} from '../../../src/store/useEditorStore';
import { INITIAL_ADJUSTMENTS } from '../../../src/utils/adjustments';
import { buildImageCacheEntry } from '../../../src/utils/ImageLRUCache';
import { resolvePreviewViewportRoi } from '../../../src/utils/previewCoordinator';

const originalEditorState = useEditorStore.getState();

const selectedImage = (path: string): SelectedImage => ({
  exif: null,
  height: 4000,
  isRaw: true,
  isReady: true,
  metadata: null,
  originalUrl: null,
  path,
  rawDevelopmentReport: null,
  thumbnailUrl: `thumb:${path}`,
  width: 6000,
});

const viewportLayout = {
  containerHeight: 600,
  containerWidth: 800,
  height: 600,
  offsetX: 0,
  offsetY: 0,
  width: 800,
};

afterEach(() => {
  useEditorStore.getState().hydrateEditorRenderAuthority(originalEditorState);
});

describe('editor image session ownership', () => {
  test('A to B to A produces distinct identities and rejects both earlier opens', () => {
    const sessionA1 = createEditorImageSession({ generation: 2, path: '/raw/A.ARW', source: 'cold-load' });
    const sessionB = createEditorImageSession({ generation: 3, path: '/raw/B.ARW', source: 'cold-load' });
    const sessionA2 = createEditorImageSession({ generation: 4, path: '/raw/A.ARW', source: 'cache' });

    useEditorStore.getState().setEditor({ imageSession: sessionA1 });
    useEditorStore.getState().setEditor({ imageSession: sessionB });
    useEditorStore.getState().setEditor({ imageSession: sessionA2 });

    expect(sessionA2.id).not.toBe(sessionA1.id);
    expect(isEditorImageSessionCurrent(sessionA1.id)).toBe(false);
    expect(isEditorImageSessionCurrent(sessionB.id)).toBe(false);
    expect(isEditorImageSessionCurrent(sessionA2.id)).toBe(true);
  });

  test('back to library invalidates image-owned work even when the path later reopens', () => {
    const first = createEditorImageSession({ generation: 7, path: '/raw/A.ARW', source: 'cold-load' });
    useEditorStore.getState().setEditor({ imageSession: first });
    useEditorStore.getState().setEditor({ imageSession: null, selectedImage: null });
    expect(isEditorImageSessionCurrent(first.id)).toBe(false);

    const reopened = createEditorImageSession({ generation: 9, path: '/raw/A.ARW', source: 'cache' });
    useEditorStore.getState().setEditor({ imageSession: reopened });
    expect(reopened.id).not.toBe(first.id);
    expect(isEditorImageSessionCurrent(first.id)).toBe(false);
  });

  test('cache snapshot is built only for a coherent ready current image', () => {
    const session = createEditorImageSession({ generation: 2, path: '/raw/A.ARW', source: 'cold-load' });
    const snapshot = {
      adjustments: INITIAL_ADJUSTMENTS,
      finalPreviewUrl: 'blob:preview-a',
      hasRenderedFirstFrame: false,
      histogram: null,
      imageSession: session,
      originalSize: { height: 4000, width: 6000 },
      previewSize: { height: 1280, width: 1920 },
      selectedImage: {
        exif: null,
        height: 4000,
        isRaw: true,
        isReady: true,
        metadata: null,
        originalUrl: null,
        path: '/raw/A.ARW',
        rawDevelopmentReport: null,
        thumbnailUrl: 'thumb-a',
        width: 6000,
      },
      uncroppedAdjustedPreviewUrl: null,
      waveform: null,
    };

    expect(buildImageCacheEntry(snapshot)).toMatchObject({
      imageSessionId: session.id,
      sourceIdentity: '/raw/A.ARW',
    });
    expect(buildImageCacheEntry({ ...snapshot, imageSession: { ...session, path: '/raw/B.ARW' } })).toBeNull();
    expect(
      buildImageCacheEntry({ ...snapshot, selectedImage: { ...snapshot.selectedImage, isReady: false } }),
    ).toBeNull();
  });

  test('settled viewport publication advances revision only for material transform changes and Fit clears ROI', () => {
    const publish = useEditorStore.getState().publishPreviewViewportTransform;
    const baselineRevision = useEditorStore.getState().viewportRevision;

    publish({ positionX: -400, positionY: -300, scale: 2 });
    let editor = useEditorStore.getState();
    expect(editor.viewportRevision).toBe(baselineRevision + 1);
    expect(resolvePreviewViewportRoi(viewportLayout, editor.previewViewportTransform)).toEqual([0.25, 0.25, 0.5, 0.5]);

    publish({ positionX: -400, positionY: -300, scale: 2 });
    expect(useEditorStore.getState().viewportRevision).toBe(baselineRevision + 1);

    publish({ positionX: 0, positionY: 0, scale: 1 });
    editor = useEditorStore.getState();
    expect(editor.viewportRevision).toBe(baselineRevision + 2);
    expect(resolvePreviewViewportRoi(viewportLayout, editor.previewViewportTransform)).toBeNull();

    publish({ positionX: 0, positionY: 0, scale: 1 });
    expect(useEditorStore.getState().viewportRevision).toBe(baselineRevision + 2);
  });

  test('image source replacement resets a zoomed viewport snapshot to full-frame authority', () => {
    const editor = useEditorStore.getState();
    editor.setEditor({ selectedImage: selectedImage('/raw/A.ARW') });
    editor.publishPreviewViewportTransform({ positionX: -400, positionY: -300, scale: 2 });
    const zoomedRevision = useEditorStore.getState().viewportRevision;
    expect(
      resolvePreviewViewportRoi(viewportLayout, useEditorStore.getState().previewViewportTransform),
    ).not.toBeNull();

    useEditorStore.getState().setEditor({ selectedImage: selectedImage('/raw/B.ARW') });
    const replaced = useEditorStore.getState();
    expect(replaced.previewViewportTransform).toEqual({ positionX: 0, positionY: 0, scale: 1 });
    expect(replaced.viewportRevision).toBeGreaterThan(zoomedRevision);
    expect(resolvePreviewViewportRoi(viewportLayout, replaced.previewViewportTransform)).toBeNull();
  });
});
