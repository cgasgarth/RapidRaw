import { describe, expect, test } from 'bun:test';
import {
  imageCanvasLayer,
  imageCanvasLayerZIndex,
  resolveCropPreviewVisibility,
  resolveDisplayedMaskUrl,
  resolveEffectiveBrushTool,
  resolveImageCanvasPointerOwner,
  resolveViewerChromeRegionContract,
} from '../../../src/components/panel/editor/imageCanvasContracts';

describe('ImageCanvas layer and pointer contracts', () => {
  test('keeps visual layers in deterministic paint order', () => {
    const order = Object.keys(imageCanvasLayer).map((layer) =>
      imageCanvasLayerZIndex(layer as keyof typeof imageCanvasLayer),
    );

    expect(order).toEqual([...order].sort((left, right) => left - right));
  });

  test('keeps persistent commands outside the image for normal, crop, compare, fullscreen, and compact layouts', () => {
    const desktop = resolveViewerChromeRegionContract({ isCompact: false, isFullScreen: false });
    const fullscreen = resolveViewerChromeRegionContract({ isCompact: false, isFullScreen: true });
    const compact = resolveViewerChromeRegionContract({ isCompact: true, isFullScreen: false });

    for (const scenario of [
      { name: 'normal', contract: desktop },
      { name: 'crop', contract: desktop },
      { name: 'compare', contract: desktop },
      { name: 'fullscreen', contract: fullscreen },
      { name: 'compact', contract: compact },
    ]) {
      expect(scenario.contract.persistentControlPlacement, scenario.name).toBe('outside-image');
    }

    expect(fullscreen.layout).toBe('fullscreen');
    expect(compact.layout).toBe('compact');
    expect(desktop.layout).toBe('desktop');
  });

  test('gives the active crop and tools pointer ownership while preserving middle-click pan', () => {
    expect(
      resolveImageCanvasPointerOwner({ isCropping: true, isMaskInteractionActive: false, isToolActive: false }),
    ).toBe('crop');
    expect(
      resolveImageCanvasPointerOwner({ isCropping: false, isMaskInteractionActive: true, isToolActive: false }),
    ).toBe('active-tool');
    expect(
      resolveImageCanvasPointerOwner({ isCropping: false, isMaskInteractionActive: false, isToolActive: true }),
    ).toBe('active-tool');
    expect(
      resolveImageCanvasPointerOwner({
        isCropping: true,
        isMaskInteractionActive: true,
        isToolActive: true,
        pointerButton: 1,
      }),
    ).toBe('pan-zoom');
  });

  test('derives Alt inversion from the latest canonical brush tool', () => {
    expect(resolveEffectiveBrushTool('brush', false)).toBe('brush');
    expect(resolveEffectiveBrushTool('brush', true)).toBe('eraser');
    expect(resolveEffectiveBrushTool('eraser', true)).toBe('brush');
    expect(resolveEffectiveBrushTool('eraser', false)).toBe('eraser');
  });

  test('shows crop only after the current source loads and hides stale/error sources', () => {
    expect(
      resolveCropPreviewVisibility({ cropPreviewUrl: 'blob:current', isCropping: true, loadedCropPreviewUrl: null }),
    ).toBe(false);
    expect(
      resolveCropPreviewVisibility({
        cropPreviewUrl: 'blob:current',
        isCropping: true,
        loadedCropPreviewUrl: 'blob:previous',
      }),
    ).toBe(false);
    expect(
      resolveCropPreviewVisibility({
        cropPreviewUrl: 'blob:current',
        isCropping: true,
        loadedCropPreviewUrl: 'blob:current',
      }),
    ).toBe(true);
    expect(
      resolveCropPreviewVisibility({
        cropPreviewUrl: 'blob:current',
        isCropping: false,
        loadedCropPreviewUrl: 'blob:current',
      }),
    ).toBe(false);
  });

  test('derives mask visibility from the active editing panel without retaining a stale overlay', () => {
    expect(resolveDisplayedMaskUrl({ isAiEditing: false, isMasking: true, maskOverlayUrl: 'blob:mask' })).toBe(
      'blob:mask',
    );
    expect(resolveDisplayedMaskUrl({ isAiEditing: true, isMasking: false, maskOverlayUrl: 'blob:ai' })).toBe('blob:ai');
    expect(resolveDisplayedMaskUrl({ isAiEditing: false, isMasking: false, maskOverlayUrl: 'blob:stale' })).toBeNull();
  });
});
