import { describe, expect, test } from 'bun:test';

import { Mask, SubMaskMode } from '../../../src/components/panel/right/layers/Masks';
import { createEditorSubMaskFallback, createEditorSubMaskForImage } from '../../../src/utils/editorSubMaskFactory';

describe('editor sub-mask factory', () => {
  test('initializes linear masks in oriented image coordinates', () => {
    const subMask = createEditorSubMaskForImage({
      type: Mask.Linear,
      imageDimensions: { width: 4000, height: 3000 },
      orientationSteps: 1,
      mode: SubMaskMode.Subtractive,
    });

    expect(subMask.mode).toBe(SubMaskMode.Subtractive);
    expect(subMask.parameters).toMatchObject({
      imageWidth: 3000,
      imageHeight: 4000,
      range: 360,
      startX: 1500,
      startY: 480,
      endX: 1500,
      endY: 2880,
      isInitialDraw: true,
      targetX: -10000,
      targetY: -10000,
      tolerance: 20,
      feather: 35,
    });
  });

  test('initializes radial masks with the initial draw sentinel', () => {
    const subMask = createEditorSubMaskForImage({
      type: Mask.Radial,
      imageDimensions: { width: 2000, height: 1000 },
    });

    expect(subMask.parameters).toMatchObject({
      isInitialDraw: true,
      startX: -10000,
      startY: -10000,
      endX: -10000,
      endY: -10000,
      centerX: -10000,
      centerY: -10000,
      radiusX: 0,
      radiusY: 0,
    });
  });

  test('initializes color and luminance masks with picker defaults', () => {
    for (const type of [Mask.Color, Mask.Luminance]) {
      const subMask = createEditorSubMaskForImage({
        type,
        imageDimensions: { width: 2000, height: 1000 },
      });

      expect(subMask.parameters).toMatchObject({
        isInitialDraw: true,
        targetX: -10000,
        targetY: -10000,
        tolerance: 20,
        feather: 35,
      });
    }
  });

  test('initializes AI depth masks with depth-range defaults', () => {
    const subMask = createEditorSubMaskForImage({
      type: Mask.AiDepth,
      imageDimensions: { width: 2000, height: 1000 },
    });

    expect(subMask.parameters).toMatchObject({
      minDepth: 20,
      maxDepth: 100,
      minFade: 15,
      maxFade: 15,
      feather: 10,
    });
  });

  test('targets person part masks without triggering generation side effects', () => {
    const subMask = createEditorSubMaskForImage({
      type: Mask.AiPerson,
      imageDimensions: { width: 2000, height: 1000 },
      personPart: 'face',
      faceName: 'Face',
    });

    expect(subMask.name).toBe('Face');
    expect(subMask.parameters).toMatchObject({
      grow: 0,
      feather: 0,
      target: { part: 'face', personId: null },
    });
  });

  test('keeps fallback creation equivalent for missing image dimensions', () => {
    const subMask = createEditorSubMaskFallback(Mask.Brush, SubMaskMode.Intersect);

    expect(subMask.mode).toBe(SubMaskMode.Intersect);
    expect(subMask.parameters).toEqual({ lines: [] });
  });
});
