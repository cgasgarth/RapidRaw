import { describe, expect, test } from 'bun:test';
import {
  imageCanvasLayer,
  imageCanvasLayerZIndex,
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
});
