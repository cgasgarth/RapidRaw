import { describe, expect, test } from 'bun:test';
import {
  resolveViewerRetouchFootprint,
  viewerRetouchNormalizedToView,
  viewerRetouchSurfacePointToView,
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

  test('keeps overlay and command coordinates identical across Fit, Fill, zoom, crop, resize, and DPR', () => {
    const baseInput: Parameters<typeof createEditorOverlayGeometry>[0] = {
      crop: null,
      devicePixelRatio: 1,
      geometryEpoch: 1,
      orientationSteps: 0,
      renderSize: { height: 600, offsetX: 100, offsetY: 50, scale: 0.2, width: 800 },
      rotationDegrees: 0,
      semanticZoom: {
        cssPercent: 100,
        devicePixelsPerImagePixel: 1,
        displayPercent: 100,
        imagePixelsPerCssPixel: 1,
        imagePixelsPerDevicePixel: 1,
        mode: { kind: 'fit' },
        requiredPreviewResolution: 1600,
        transformScale: 1,
      },
      sourceSize: { height: 3000, width: 4000 },
      transform: { positionX: 0, positionY: 0, scale: 1 },
      viewportSizeCssPixels: { height: 800, width: 1000 },
    };
    const cases: ReadonlyArray<[string, Parameters<typeof createEditorOverlayGeometry>[0]]> = [
      ['fit', baseInput],
      [
        'fill',
        {
          ...baseInput,
          geometryEpoch: 2,
          renderSize: { height: 900, offsetX: -100, offsetY: -50, scale: 0.3, width: 1200 },
          semanticZoom: { ...baseInput.semanticZoom, mode: { kind: 'fill' } },
        },
      ],
      [
        'zoom',
        {
          ...baseInput,
          geometryEpoch: 3,
          semanticZoom: {
            ...baseInput.semanticZoom,
            cssPercent: 200,
            mode: { devicePixelsPerImagePixel: 2, kind: 'ratio' },
            transformScale: 2,
          },
          transform: { positionX: -220, positionY: 90, scale: 2 },
        },
      ],
      [
        'crop',
        {
          ...baseInput,
          crop: { height: 1600, unit: 'px', width: 2200, x: 500, y: 400 },
          geometryEpoch: 4,
          orientationSteps: 1,
          rotationDegrees: -8,
        },
      ],
      [
        'resize',
        {
          ...baseInput,
          geometryEpoch: 5,
          renderSize: { height: 750, offsetX: 200, offsetY: 75, scale: 0.25, width: 1000 },
          viewportSizeCssPixels: { height: 900, width: 1400 },
        },
      ],
      ['dpr', { ...baseInput, devicePixelRatio: 3, geometryEpoch: 6 }],
    ];
    const normalized = { x: 0.68, y: 0.62 };
    for (const [label, input] of cases) {
      const candidate = createEditorOverlayGeometry(input);
      const overlayPoint = viewerRetouchNormalizedToView(candidate, normalized);
      const surfaceRect = {
        height: candidate.viewportSizeCssPixels.height * 0.8,
        layoutHeight: candidate.viewportSizeCssPixels.height,
        layoutWidth: candidate.viewportSizeCssPixels.width,
        width: candidate.viewportSizeCssPixels.width * 0.8,
        x: 20,
        y: 30,
      };
      const pointer = {
        clientX:
          surfaceRect.x +
          (candidate.displayedImageRectInViewCssPixels.x + overlayPoint.x) *
            (surfaceRect.width / surfaceRect.layoutWidth),
        clientY:
          surfaceRect.y +
          (candidate.displayedImageRectInViewCssPixels.y + overlayPoint.y) *
            (surfaceRect.height / surfaceRect.layoutHeight),
      };
      const commandPoint = viewerRetouchSurfacePointToView(candidate, pointer, surfaceRect);
      expect(commandPoint, label).not.toBeNull();
      const roundTrip = viewerRetouchViewToNormalized(candidate, commandPoint!);
      expect(roundTrip.x, label).toBeCloseTo(normalized.x, 9);
      expect(roundTrip.y, label).toBeCloseTo(normalized.y, 9);
    }
  });
});
