import { describe, expect, test } from 'bun:test';
import {
  resolveViewerRetouchFootprint,
  viewerRetouchNormalizedToView,
  viewerRetouchViewToNormalized,
} from '../../../src/components/panel/editor/viewerRetouchGeometry';
import { createEditorOverlayGeometry } from '../../../src/utils/editorOverlayGeometry';

const geometry = createEditorOverlayGeometry({
  crop: { height: 1200, width: 1600, x: 200, y: 100 },
  devicePixelRatio: 2,
  geometryEpoch: 7,
  orientationSteps: 1,
  renderSize: { height: 600, offsetX: 100, offsetY: 50, scale: 0.375, width: 800 },
  rotationDegrees: -7.5,
  semanticZoom: {
    cssPercent: 150,
    devicePixelsPerImagePixel: 3,
    displayPercent: 300,
    imagePixelsPerCssPixel: 2 / 3,
    imagePixelsPerDevicePixel: 1 / 3,
    mode: { devicePixelsPerImagePixel: 3, kind: 'ratio' },
    requiredPreviewResolution: 3200,
    transformScale: 1.5,
  },
  sourceSize: { height: 3000, width: 4000 },
  transform: { positionX: -25, positionY: 40, scale: 1.5 },
  viewportSizeCssPixels: { height: 800, width: 1000 },
});

describe('viewer retouch geometry', () => {
  test('round-trips normalized source and target points through crop, rotation, and zoom', () => {
    for (const point of [
      { x: 0.2, y: 0.3 },
      { x: 0.75, y: 0.6 },
    ]) {
      const roundTrip = viewerRetouchViewToNormalized(geometry, viewerRetouchNormalizedToView(geometry, point));
      expect(roundTrip.x).toBeCloseTo(point.x, 9);
      expect(roundTrip.y).toBeCloseTo(point.y, 9);
    }
  });

  test('preserves radius, feather, scale, and rotation in the source footprint', () => {
    const footprint = resolveViewerRetouchFootprint({
      featherRadiusPx: 24,
      handleRadius: 8,
      radiusPx: 48,
      rotationDegrees: 90,
      scale: 2,
      sourcePoint: { x: 100, y: 200 },
      viewRadiusFromCrop: (radius) => radius * 0.5,
    });
    expect(footprint.radius).toBe(24);
    expect(footprint.featherRadius).toBe(36);
    expect(footprint.sourceFootprintRadius).toBe(12);
    expect(footprint.axisEnd.x).toBeCloseTo(100, 9);
    expect(footprint.axisEnd.y).toBeCloseTo(188, 9);
  });
});
