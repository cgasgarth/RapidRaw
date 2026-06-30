import { describe, expect, test } from 'bun:test';
import type { Crop } from 'react-image-crop';
import {
  didCropGeometryChange,
  isCropChangeMeaningful,
  isCropValidAfterRotation,
  percentCropFromPixelCrop,
  resolveNextCropForGeometryChange,
} from '../../src/utils/cropUtils';

const currentCrop: Crop = {
  unit: 'px',
  x: 100,
  y: 100,
  width: 800,
  height: 600,
};

describe('crop auto-fit helpers', () => {
  test('detects crop geometry changes explicitly', () => {
    expect(didCropGeometryChange(null, { rotation: 0, aspectRatio: null, orientationSteps: 0 })).toBe(true);
    expect(
      didCropGeometryChange(
        { rotation: 0, aspectRatio: null, orientationSteps: 0 },
        { rotation: 0, aspectRatio: null, orientationSteps: 0 },
      ),
    ).toBe(false);
    expect(
      didCropGeometryChange(
        { rotation: 0, aspectRatio: null, orientationSteps: 0 },
        { rotation: 5, aspectRatio: null, orientationSteps: 0 },
      ),
    ).toBe(true);
  });

  test('converts pixel crop to percent crop in oriented dimensions', () => {
    expect(percentCropFromPixelCrop(currentCrop, 2000, 1000)).toEqual({
      unit: '%',
      x: 5,
      y: 10,
      width: 40,
      height: 60,
    });
  });

  test('validates crop corners after rotation', () => {
    expect(isCropValidAfterRotation(currentCrop, 2000, 1000, 0)).toBe(true);
    expect(isCropValidAfterRotation({ unit: 'px', x: -50, y: 100, width: 500, height: 500 }, 2000, 1000, 0)).toBe(
      false,
    );
  });

  test('refits existing crop when aspect ratio changes', () => {
    const result = resolveNextCropForGeometryChange({
      aspectRatio: 1,
      currentCrop,
      effectiveRotation: 0,
      imageHeight: 1000,
      imageWidth: 2000,
      isDraggingRotation: false,
      orientationSteps: 0,
      previousParams: { rotation: 0, aspectRatio: null, orientationSteps: 0 },
      rotation: 0,
    });

    expect(result.nextPixelCrop).toEqual({
      unit: 'px',
      x: 200,
      y: 100,
      width: 600,
      height: 600,
    });
  });

  test('re-centers maximized crop while dragging rotation', () => {
    const result = resolveNextCropForGeometryChange({
      aspectRatio: null,
      currentCrop: { unit: 'px', x: 0, y: 0, width: 2000, height: 1000 },
      effectiveRotation: 10,
      imageHeight: 1000,
      imageWidth: 2000,
      isDraggingRotation: true,
      orientationSteps: 0,
      previousParams: { rotation: 0, aspectRatio: null, orientationSteps: 0 },
      rotation: 0,
    });

    expect(result.nextPixelCrop?.width).toBeLessThan(2000);
    expect(result.nextPixelCrop?.height).toBeLessThan(1000);
    expect(isCropValidAfterRotation(result.nextPixelCrop, result.orientedWidth, result.orientedHeight, 10)).toBe(true);
  });

  test('uses thresholded crop change comparison', () => {
    expect(isCropChangeMeaningful(currentCrop, { ...currentCrop, x: 100.5 })).toBe(false);
    expect(isCropChangeMeaningful(currentCrop, { ...currentCrop, x: 102 })).toBe(true);
  });
});
