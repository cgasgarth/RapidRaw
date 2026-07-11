import { describe, expect, test } from 'bun:test';
import type { Crop } from 'react-image-crop';
import {
  activeCropDraft,
  cropGeometryIdentity,
  didCropGeometryChange,
  getOrientedDimensions,
  isCropChangeMeaningful,
  isCropValidAfterRotation,
  percentCropFromPixelCrop,
  pixelCropFromPercentCrop,
  resolveCropForGeometryTransaction,
  resolveNextCropForGeometryChange,
  updateCropDraft,
} from '../../../src/utils/cropUtils';

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

  test('uses portrait dimensions for every quarter-turn orientation', () => {
    expect([0, 1, 2, 3].map((step) => getOrientedDimensions(6000, 4000, step))).toEqual([
      { width: 6000, height: 4000 },
      { width: 4000, height: 6000 },
      { width: 6000, height: 4000 },
      { width: 4000, height: 6000 },
    ]);
  });

  test('round trips percent crops with explicit persisted rounding', () => {
    const percent = percentCropFromPixelCrop({ unit: 'px', x: 101, y: 99, width: 799, height: 601 }, 2000, 1000);
    expect(pixelCropFromPercentCrop(percent, 2000, 1000)).toEqual({
      unit: 'px',
      x: 101,
      y: 99,
      width: 799,
      height: 601,
    });
    expect(pixelCropFromPercentCrop({ unit: '%', x: 5.01, y: 9.91, width: 39.99, height: 60.19 }, 2000, 1000)).toEqual({
      unit: 'px',
      x: 101,
      y: 100,
      width: 799,
      height: 601,
    });
  });

  test('identifies image and geometry sessions without crop payload coupling', () => {
    const geometry = { rotation: 2.5, aspectRatio: 1.5, orientationSteps: 1 };
    expect(cropGeometryIdentity('/a.raw', 6000, 4000, geometry)).not.toBe(
      cropGeometryIdentity('/b.raw', 6000, 4000, geometry),
    );
    expect(cropGeometryIdentity('/a.raw', 6000, 4000, geometry)).not.toBe(
      cropGeometryIdentity('/a.raw', 6000, 4000, { ...geometry, rotation: 3 }),
    );
  });

  test('keeps a drag authoritative across canonical parent renders and drops it on image switch', () => {
    const draft = updateCropDraft('a:crop', 'geometry-a', {
      unit: '%',
      x: 10,
      y: 10,
      width: 50,
      height: 50,
    });
    expect(activeCropDraft(draft, 'a:crop')?.x).toBe(10);
    // A delayed canonical value is not an input to the active interaction.
    expect(activeCropDraft(draft, 'a:crop')?.width).toBe(50);
    expect(activeCropDraft(draft, 'b:crop')).toBeNull();
    expect(activeCropDraft({ kind: 'idle' }, 'a:crop')).toBeNull();
  });

  test('commits rotation and crop normalization in one geometry transaction', () => {
    const nextCrop = resolveCropForGeometryTransaction(
      { unit: 'px', x: 0, y: 0, width: 2000, height: 1000 },
      2000,
      1000,
      { rotation: 0, aspectRatio: null, orientationSteps: 0 },
      { rotation: 12, aspectRatio: null, orientationSteps: 0 },
    );
    expect(nextCrop).not.toBeNull();
    expect(isCropValidAfterRotation(nextCrop, 2000, 1000, 12)).toBe(true);
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
