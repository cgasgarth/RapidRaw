import { describe, expect, test } from 'bun:test';
import {
  captureGeometryEpoch,
  commitIfGeometryCurrent,
  createEditorOverlayGeometry,
  overlayPoint,
  overlayRect,
  overlayVector,
} from '../../../src/utils/editorOverlayGeometry';
import type { ResolvedEditorZoom } from '../../../src/utils/editorZoom';

const semanticZoom: ResolvedEditorZoom = {
  cssPercent: 150,
  devicePixelsPerImagePixel: 3,
  displayPercent: 300,
  imagePixelsPerCssPixel: 2 / 3,
  imagePixelsPerDevicePixel: 1 / 3,
  mode: { devicePixelsPerImagePixel: 3, kind: 'ratio' },
  requiredPreviewResolution: 3200,
  transformScale: 1.5,
};

const fixture = (orientationSteps: number, geometryEpoch = 7) =>
  createEditorOverlayGeometry({
    crop: { height: 1200, width: 1600, x: 200, y: 100 },
    devicePixelRatio: 2,
    geometryEpoch,
    orientationSteps,
    renderSize: { height: 600, offsetX: 100, offsetY: 50, scale: 0.375, width: 800 },
    rotationDegrees: -7.5,
    semanticZoom,
    sourceSize: { height: 3000, width: 4000 },
    transform: { positionX: -25, positionY: 40, scale: 1.5 },
    viewportSizeCssPixels: { height: 800, width: 1000 },
  });

const expectPointClose = (actual: { x: number; y: number }, expected: { x: number; y: number }) => {
  expect(actual.x).toBeCloseTo(expected.x, 9);
  expect(actual.y).toBeCloseTo(expected.y, 9);
};

describe('editor overlay geometry', () => {
  test('round-trips source points and vectors through every orientation', () => {
    for (const steps of [0, 1, 2, 3]) {
      const geometry = fixture(steps);
      const source = overlayPoint<'source-pixels'>(1234.25, 987.75);
      expectPointClose(geometry.orientedToSource(geometry.sourceToOriented(source)), source);

      const vector = overlayVector<'source-pixels'>(31.5, -18.25);
      const orientedVector = geometry.sourceVectorToOriented(vector);
      expect(Math.hypot(orientedVector.x, orientedVector.y)).toBeCloseTo(Math.hypot(vector.x, vector.y), 9);
    }
  });

  test('round-trips crop, fitted view, zoomed viewport, and DPR without drift', () => {
    const geometry = fixture(0);
    let cropPoint = overlayPoint<'crop-pixels'>(421.125, 731.875);

    for (let iteration = 0; iteration < 100; iteration += 1) {
      const viewportPoint = geometry.viewToViewport(geometry.cropToView(cropPoint));
      const devicePoint = geometry.viewportToDevice(viewportPoint);
      const viewportRoundTrip = geometry.deviceToViewport(devicePoint);
      cropPoint = geometry.viewToCrop(geometry.viewportToView(viewportRoundTrip));
    }

    expectPointClose(cropPoint, { x: 421.125, y: 731.875 });
    expect(geometry.viewRadiusFromCrop(24)).toBeCloseTo(9, 9);
  });

  test('round-trips oriented landmarks through crop space during live rotation', () => {
    const geometry = fixture(0);
    const oriented = overlayPoint<'oriented-pixels'>(1200.25, 800.75);
    const crop = geometry.orientedToCrop(oriented);
    expectPointClose(geometry.cropToOriented(crop), oriented);
    expect(crop.x).not.toBeCloseTo(oriented.x - geometry.cropRectInOrientedPixels.x, 3);
  });

  test('maps normalized crop rectangles and backend landmarks to the same viewport', () => {
    const geometry = fixture(0);
    const normalized = overlayPoint<'normalized-crop'>(0.25, 0.5);
    const viewport = geometry.normalizedCropToViewport(normalized);
    const oriented = geometry.cropToOriented(geometry.normalizedCropToCrop(normalized));
    const backendViewport = geometry.viewToViewport(geometry.cropToView(geometry.orientedToCrop(oriented)));
    expectPointClose(viewport, backendViewport);

    const rect = geometry.normalizedCropRectToViewport(overlayRect<'normalized-crop'>(0.1, 0.2, 0.5, 0.4));
    expect(rect.width).toBeCloseTo(450, 9);
    expect(rect.height).toBeCloseTo(270, 9);
  });

  test('keeps CPU CSS and WGPU device landmarks renderer-equivalent', () => {
    const geometry = fixture(3);
    const landmark = geometry.normalizedCropToViewport(overlayPoint<'normalized-crop'>(0.37, 0.61));
    const wgpuLandmark = geometry.deviceToViewport(geometry.viewportToDevice(landmark));
    expectPointClose(wgpuLandmark, landmark);
    expect(Math.abs(wgpuLandmark.x - landmark.x)).toBeLessThan(0.001);
    expect(Math.abs(wgpuLandmark.y - landmark.y)).toBeLessThan(0.001);
  });

  test('covers portrait, panorama, rotated, cropped, DPR, and high-zoom golden fixtures', () => {
    const cases = [
      { crop: null, dpr: 1, orientationSteps: 0, source: { height: 6000, width: 4000 }, zoom: 1 },
      {
        crop: { height: 1800, width: 7000, x: 400, y: 300 },
        dpr: 2,
        orientationSteps: 0,
        source: { height: 2400, width: 8000 },
        zoom: 0.75,
      },
      {
        crop: { height: 55, unit: '%' as const, width: 65, x: 20, y: 15 },
        dpr: 2.5,
        orientationSteps: 1,
        source: { height: 3000, width: 5000 },
        zoom: 4,
      },
    ];

    for (const [index, current] of cases.entries()) {
      const orientedWidth = current.orientationSteps % 2 === 1 ? current.source.height : current.source.width;
      const orientedHeight = current.orientationSteps % 2 === 1 ? current.source.width : current.source.height;
      const cropWidth = current.crop
        ? current.crop.unit === '%'
          ? (current.crop.width / 100) * orientedWidth
          : current.crop.width
        : orientedWidth;
      const cropHeight = current.crop
        ? current.crop.unit === '%'
          ? (current.crop.height / 100) * orientedHeight
          : current.crop.height
        : orientedHeight;
      const scale = Math.min(900 / cropWidth, 620 / cropHeight);
      const geometry = createEditorOverlayGeometry({
        crop: current.crop,
        devicePixelRatio: current.dpr,
        geometryEpoch: index + 1,
        orientationSteps: current.orientationSteps,
        renderSize: { height: cropHeight * scale, offsetX: 50, offsetY: 40, scale, width: cropWidth * scale },
        rotationDegrees: index === 2 ? 11.25 : 0,
        semanticZoom: { ...semanticZoom, transformScale: current.zoom },
        sourceSize: current.source,
        transform: { positionX: -73, positionY: 29, scale: current.zoom },
        viewportSizeCssPixels: { height: 700, width: 1000 },
      });
      const source = overlayPoint<'source-pixels'>(current.source.width * 0.31, current.source.height * 0.67);
      expectPointClose(geometry.normalizedSourceToSource(geometry.sourceToNormalized(source)), source);
      const oriented = geometry.sourceToOriented(source);
      expectPointClose(geometry.cropToOriented(geometry.orientedToCrop(oriented)), oriented);

      const polygon = [
        overlayPoint<'oriented-pixels'>(oriented.x, oriented.y),
        overlayPoint<'oriented-pixels'>(oriented.x + 10, oriented.y),
        overlayPoint<'oriented-pixels'>(oriented.x, oriented.y + 20),
      ];
      expect(geometry.cropPolygonToView(geometry.orientedPolygonToCrop(polygon))).toHaveLength(3);
      expect(geometry.viewBrushWidthFromCrop(12)).toBeCloseTo(12 * scale, 9);
    }
  });

  test('normalizes percent crops and reports bounds in each declared space', () => {
    const geometry = createEditorOverlayGeometry({
      ...fixtureInput,
      crop: { height: 50, unit: '%', width: 50, x: 25, y: 10 },
      orientationSteps: 1,
    });
    expect(geometry.cropRectInOrientedPixels).toMatchObject({ height: 2000, width: 1500, x: 750, y: 400 });
    expect(geometry.isPointInBounds(overlayPoint<'normalized-crop'>(1, 1), 'normalized-crop')).toBe(true);
    expect(geometry.isPointInBounds(overlayPoint<'normalized-crop'>(1.01, 0.5), 'normalized-crop')).toBe(false);
  });

  test('rejects stale pointer commits after a geometry epoch change', () => {
    const start = fixture(0, 7);
    const capture = captureGeometryEpoch(start);
    let committed = 0;
    expect(commitIfGeometryCurrent(capture, start, () => ++committed)).toBe(1);
    expect(commitIfGeometryCurrent(capture, fixture(0, 8), () => ++committed)).toBeUndefined();
    expect(committed).toBe(1);
  });

  test('freezes the per-frame contract and its public geometry records', () => {
    const geometry = fixture(3);
    expect(Object.isFrozen(geometry)).toBe(true);
    expect(Object.isFrozen(geometry.cropRectInOrientedPixels)).toBe(true);
    expect(Object.isFrozen(geometry.displayedImageRectInViewportCssPixels)).toBe(true);
    expect(Object.isFrozen(geometry.semanticZoom)).toBe(true);
  });
});

const fixtureInput = {
  crop: null,
  devicePixelRatio: 2,
  geometryEpoch: 1,
  orientationSteps: 0,
  renderSize: { height: 600, offsetX: 100, offsetY: 50, scale: 0.2, width: 800 },
  rotationDegrees: 0,
  semanticZoom,
  sourceSize: { height: 3000, width: 4000 },
  transform: { positionX: 0, positionY: 0, scale: 1 },
  viewportSizeCssPixels: { height: 700, width: 1000 },
};
