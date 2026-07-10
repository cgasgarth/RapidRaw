import { describe, expect, test } from 'bun:test';
import {
  imageCanvasLayer,
  imageCanvasLayerZIndex,
  resolveImageCanvasPointerOwner,
} from '../../../src/components/panel/editor/imageCanvasContracts';

describe('ImageCanvas layer and pointer contracts', () => {
  test('keeps visual layers in deterministic paint order', () => {
    const order = Object.keys(imageCanvasLayer).map((layer) =>
      imageCanvasLayerZIndex(layer as keyof typeof imageCanvasLayer),
    );

    expect(order).toEqual([...order].sort((left, right) => left - right));
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
