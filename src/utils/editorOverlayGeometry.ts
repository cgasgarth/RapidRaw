import type { Crop } from 'react-image-crop';
import type { RenderSize } from '../hooks/viewport/useImageRenderSize';
import type { ResolvedEditorZoom } from './editorZoom';

declare const overlaySpace: unique symbol;

export type OverlaySpace =
  | 'crop-pixels'
  | 'device-pixels'
  | 'normalized-crop'
  | 'normalized-oriented'
  | 'normalized-source'
  | 'oriented-pixels'
  | 'source-pixels'
  | 'view-css-pixels'
  | 'viewport-css-pixels';

export interface OverlayPoint<Space extends OverlaySpace> {
  readonly [overlaySpace]: Space;
  readonly x: number;
  readonly y: number;
}

export interface OverlayVector<Space extends OverlaySpace> {
  readonly [overlaySpace]: Space;
  readonly x: number;
  readonly y: number;
}

export interface OverlayRect<Space extends OverlaySpace> extends OverlayPoint<Space> {
  readonly height: number;
  readonly width: number;
}

export interface OverlaySize {
  readonly height: number;
  readonly width: number;
}

export interface OverlayTransform {
  readonly scale: number;
  readonly x: number;
  readonly y: number;
}

export interface EditorOverlayGeometryInput {
  readonly crop: Crop | null | undefined;
  readonly devicePixelRatio: number;
  readonly geometryEpoch: number;
  readonly orientationSteps: number;
  readonly renderSize: RenderSize;
  readonly rotationDegrees: number;
  readonly semanticZoom: ResolvedEditorZoom;
  readonly sourceSize: OverlaySize;
  readonly transform: { readonly positionX: number; readonly positionY: number; readonly scale: number };
  readonly viewportSizeCssPixels: OverlaySize;
}

export interface EditorOverlayGeometry {
  readonly cropRectInOrientedPixels: OverlayRect<'oriented-pixels'>;
  readonly devicePixelRatio: number;
  readonly displayedImageRectInViewCssPixels: OverlayRect<'view-css-pixels'>;
  readonly displayedImageRectInViewportCssPixels: OverlayRect<'viewport-css-pixels'>;
  readonly geometryEpoch: number;
  readonly orientationSteps: 0 | 1 | 2 | 3;
  readonly orientedSize: OverlaySize;
  readonly rotationDegrees: number;
  readonly semanticZoom: ResolvedEditorZoom;
  readonly sourceSize: OverlaySize;
  readonly transform: OverlayTransform;
  readonly valid: boolean;
  readonly viewportSizeCssPixels: OverlaySize;
  cropRectToView(rect: OverlayRect<'crop-pixels'>): OverlayRect<'view-css-pixels'>;
  cropPolygonToView(
    polygon: ReadonlyArray<OverlayPoint<'crop-pixels'>>,
  ): ReadonlyArray<OverlayPoint<'view-css-pixels'>>;
  cropToNormalized(point: OverlayPoint<'crop-pixels'>): OverlayPoint<'normalized-crop'>;
  cropToOriented(point: OverlayPoint<'crop-pixels'>): OverlayPoint<'oriented-pixels'>;
  cropToView(point: OverlayPoint<'crop-pixels'>): OverlayPoint<'view-css-pixels'>;
  cropVectorToView(vector: OverlayVector<'crop-pixels'>): OverlayVector<'view-css-pixels'>;
  deviceToViewport(point: OverlayPoint<'device-pixels'>): OverlayPoint<'viewport-css-pixels'>;
  isPointInBounds<Space extends OverlaySpace>(point: OverlayPoint<Space>, space: Space): boolean;
  normalizedCropRectToViewport(rect: OverlayRect<'normalized-crop'>): OverlayRect<'viewport-css-pixels'>;
  normalizedCropRectToView(rect: OverlayRect<'normalized-crop'>): OverlayRect<'view-css-pixels'>;
  normalizedCropToCrop(point: OverlayPoint<'normalized-crop'>): OverlayPoint<'crop-pixels'>;
  normalizedCropToView(point: OverlayPoint<'normalized-crop'>): OverlayPoint<'view-css-pixels'>;
  normalizedCropToViewport(point: OverlayPoint<'normalized-crop'>): OverlayPoint<'viewport-css-pixels'>;
  normalizedOrientedToOriented(point: OverlayPoint<'normalized-oriented'>): OverlayPoint<'oriented-pixels'>;
  normalizedSourceToSource(point: OverlayPoint<'normalized-source'>): OverlayPoint<'source-pixels'>;
  orientedToCrop(point: OverlayPoint<'oriented-pixels'>): OverlayPoint<'crop-pixels'>;
  orientedPolygonToCrop(
    polygon: ReadonlyArray<OverlayPoint<'oriented-pixels'>>,
  ): ReadonlyArray<OverlayPoint<'crop-pixels'>>;
  orientedRectToCrop(rect: OverlayRect<'oriented-pixels'>): OverlayRect<'crop-pixels'>;
  orientedToNormalized(point: OverlayPoint<'oriented-pixels'>): OverlayPoint<'normalized-oriented'>;
  orientedToSource(point: OverlayPoint<'oriented-pixels'>): OverlayPoint<'source-pixels'>;
  orientedVectorToCrop(vector: OverlayVector<'oriented-pixels'>): OverlayVector<'crop-pixels'>;
  sourceRectToOriented(rect: OverlayRect<'source-pixels'>): OverlayRect<'oriented-pixels'>;
  sourceToNormalized(point: OverlayPoint<'source-pixels'>): OverlayPoint<'normalized-source'>;
  sourceToOriented(point: OverlayPoint<'source-pixels'>): OverlayPoint<'oriented-pixels'>;
  sourceVectorToOriented(vector: OverlayVector<'source-pixels'>): OverlayVector<'oriented-pixels'>;
  viewRadiusFromCrop(radius: number): number;
  viewBrushWidthFromCrop(width: number): number;
  viewToCrop(point: OverlayPoint<'view-css-pixels'>): OverlayPoint<'crop-pixels'>;
  viewToViewport(point: OverlayPoint<'view-css-pixels'>): OverlayPoint<'viewport-css-pixels'>;
  viewportToDevice(point: OverlayPoint<'viewport-css-pixels'>): OverlayPoint<'device-pixels'>;
  viewportToNormalizedCrop(point: OverlayPoint<'viewport-css-pixels'>): OverlayPoint<'normalized-crop'>;
  viewportToView(point: OverlayPoint<'viewport-css-pixels'>): OverlayPoint<'view-css-pixels'>;
}

export interface GeometryEpochCapture {
  readonly geometryEpoch: number;
}

const finite = (value: number, fallback = 0): number => (Number.isFinite(value) ? value : fallback);
const positive = (value: number, fallback = 1): number => (Number.isFinite(value) && value > 0 ? value : fallback);

export const overlayPoint = <Space extends OverlaySpace>(x: number, y: number): OverlayPoint<Space> =>
  ({
    x,
    y,
  }) as OverlayPoint<Space>;

export const overlayVector = <Space extends OverlaySpace>(x: number, y: number): OverlayVector<Space> =>
  ({
    x,
    y,
  }) as OverlayVector<Space>;

export const overlayRect = <Space extends OverlaySpace>(
  x: number,
  y: number,
  width: number,
  height: number,
): OverlayRect<Space> => ({ x, y, width, height }) as OverlayRect<Space>;

const normalizeOrientationSteps = (steps: number): 0 | 1 | 2 | 3 =>
  (((Math.round(finite(steps)) % 4) + 4) % 4) as 0 | 1 | 2 | 3;

const rectFromCorners = <Space extends OverlaySpace>(
  corners: ReadonlyArray<OverlayPoint<Space>>,
): OverlayRect<Space> => {
  const xs = corners.map((corner) => corner.x);
  const ys = corners.map((corner) => corner.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  return overlayRect<Space>(minX, minY, maxX - minX, maxY - minY);
};

const mapRect = <From extends OverlaySpace, To extends OverlaySpace>(
  rect: OverlayRect<From>,
  mapPoint: (point: OverlayPoint<From>) => OverlayPoint<To>,
): OverlayRect<To> =>
  rectFromCorners([
    mapPoint(overlayPoint<From>(rect.x, rect.y)),
    mapPoint(overlayPoint<From>(rect.x + rect.width, rect.y)),
    mapPoint(overlayPoint<From>(rect.x, rect.y + rect.height)),
    mapPoint(overlayPoint<From>(rect.x + rect.width, rect.y + rect.height)),
  ]);

const freezePoint = <Space extends OverlaySpace>(point: OverlayPoint<Space>): OverlayPoint<Space> =>
  Object.freeze(point);
const freezeRect = <Space extends OverlaySpace>(rect: OverlayRect<Space>): OverlayRect<Space> => Object.freeze(rect);

export const createEditorOverlayGeometry = (input: EditorOverlayGeometryInput): EditorOverlayGeometry => {
  const sourceSize = Object.freeze({
    height: Math.max(0, finite(input.sourceSize.height)),
    width: Math.max(0, finite(input.sourceSize.width)),
  });
  const orientationSteps = normalizeOrientationSteps(input.orientationSteps);
  const orientedSize = Object.freeze(
    orientationSteps % 2 === 1
      ? { height: sourceSize.width, width: sourceSize.height }
      : { height: sourceSize.height, width: sourceSize.width },
  );
  const crop = input.crop;
  const percentCrop = crop?.unit === '%';
  const cropRectInOrientedPixels = freezeRect(
    crop
      ? overlayRect<'oriented-pixels'>(
          percentCrop ? (crop.x / 100) * orientedSize.width : crop.x,
          percentCrop ? (crop.y / 100) * orientedSize.height : crop.y,
          percentCrop ? (crop.width / 100) * orientedSize.width : crop.width,
          percentCrop ? (crop.height / 100) * orientedSize.height : crop.height,
        )
      : overlayRect<'oriented-pixels'>(0, 0, orientedSize.width, orientedSize.height),
  );
  const transformScale = positive(input.transform.scale);
  const renderScale = positive(input.renderSize.scale);
  const transform = Object.freeze({
    scale: transformScale,
    x: finite(input.transform.positionX),
    y: finite(input.transform.positionY),
  });
  const viewportSizeCssPixels = Object.freeze({
    height: Math.max(0, finite(input.viewportSizeCssPixels.height)),
    width: Math.max(0, finite(input.viewportSizeCssPixels.width)),
  });
  const devicePixelRatio = positive(input.devicePixelRatio);
  const displayedImageRectInViewCssPixels = freezeRect(
    overlayRect<'view-css-pixels'>(
      finite(input.renderSize.offsetX),
      finite(input.renderSize.offsetY),
      Math.max(0, finite(input.renderSize.width)),
      Math.max(0, finite(input.renderSize.height)),
    ),
  );
  const displayedImageRectInViewportCssPixels = freezeRect(
    overlayRect<'viewport-css-pixels'>(
      transform.x + finite(input.renderSize.offsetX) * transform.scale,
      transform.y + finite(input.renderSize.offsetY) * transform.scale,
      Math.max(0, finite(input.renderSize.width)) * transform.scale,
      Math.max(0, finite(input.renderSize.height)) * transform.scale,
    ),
  );

  const sourceToOriented = (point: OverlayPoint<'source-pixels'>): OverlayPoint<'oriented-pixels'> => {
    switch (orientationSteps) {
      case 1:
        return freezePoint(overlayPoint<'oriented-pixels'>(sourceSize.height - point.y, point.x));
      case 2:
        return freezePoint(overlayPoint<'oriented-pixels'>(sourceSize.width - point.x, sourceSize.height - point.y));
      case 3:
        return freezePoint(overlayPoint<'oriented-pixels'>(point.y, sourceSize.width - point.x));
      default:
        return freezePoint(overlayPoint<'oriented-pixels'>(point.x, point.y));
    }
  };
  const orientedToSource = (point: OverlayPoint<'oriented-pixels'>): OverlayPoint<'source-pixels'> => {
    switch (orientationSteps) {
      case 1:
        return freezePoint(overlayPoint<'source-pixels'>(point.y, sourceSize.height - point.x));
      case 2:
        return freezePoint(overlayPoint<'source-pixels'>(sourceSize.width - point.x, sourceSize.height - point.y));
      case 3:
        return freezePoint(overlayPoint<'source-pixels'>(sourceSize.width - point.y, point.x));
      default:
        return freezePoint(overlayPoint<'source-pixels'>(point.x, point.y));
    }
  };
  const sourceVectorToOriented = (vector: OverlayVector<'source-pixels'>): OverlayVector<'oriented-pixels'> => {
    switch (orientationSteps) {
      case 1:
        return Object.freeze(overlayVector<'oriented-pixels'>(-vector.y, vector.x));
      case 2:
        return Object.freeze(overlayVector<'oriented-pixels'>(-vector.x, -vector.y));
      case 3:
        return Object.freeze(overlayVector<'oriented-pixels'>(vector.y, -vector.x));
      default:
        return Object.freeze(overlayVector<'oriented-pixels'>(vector.x, vector.y));
    }
  };
  const cropToView = (point: OverlayPoint<'crop-pixels'>): OverlayPoint<'view-css-pixels'> =>
    freezePoint(overlayPoint<'view-css-pixels'>(point.x * renderScale, point.y * renderScale));
  const viewToCrop = (point: OverlayPoint<'view-css-pixels'>): OverlayPoint<'crop-pixels'> =>
    freezePoint(overlayPoint<'crop-pixels'>(point.x / renderScale, point.y / renderScale));
  const viewToViewport = (point: OverlayPoint<'view-css-pixels'>): OverlayPoint<'viewport-css-pixels'> =>
    freezePoint(
      overlayPoint<'viewport-css-pixels'>(
        displayedImageRectInViewportCssPixels.x + point.x * transform.scale,
        displayedImageRectInViewportCssPixels.y + point.y * transform.scale,
      ),
    );
  const viewportToView = (point: OverlayPoint<'viewport-css-pixels'>): OverlayPoint<'view-css-pixels'> =>
    freezePoint(
      overlayPoint<'view-css-pixels'>(
        (point.x - displayedImageRectInViewportCssPixels.x) / transform.scale,
        (point.y - displayedImageRectInViewportCssPixels.y) / transform.scale,
      ),
    );
  const normalizedCropToCrop = (point: OverlayPoint<'normalized-crop'>): OverlayPoint<'crop-pixels'> =>
    freezePoint(
      overlayPoint<'crop-pixels'>(point.x * cropRectInOrientedPixels.width, point.y * cropRectInOrientedPixels.height),
    );
  const cropToNormalized = (point: OverlayPoint<'crop-pixels'>): OverlayPoint<'normalized-crop'> =>
    freezePoint(
      overlayPoint<'normalized-crop'>(
        point.x / positive(cropRectInOrientedPixels.width),
        point.y / positive(cropRectInOrientedPixels.height),
      ),
    );
  const rotationRadians = (finite(input.rotationDegrees) * Math.PI) / 180;
  const rotationCos = Math.cos(rotationRadians);
  const rotationSin = Math.sin(rotationRadians);
  const orientedCenter = { x: orientedSize.width / 2, y: orientedSize.height / 2 };
  const rotateOrientedPoint = (
    point: OverlayPoint<'oriented-pixels'>,
    direction: 1 | -1,
  ): OverlayPoint<'oriented-pixels'> => {
    const dx = point.x - orientedCenter.x;
    const dy = point.y - orientedCenter.y;
    const sin = rotationSin * direction;
    return freezePoint(
      overlayPoint<'oriented-pixels'>(
        orientedCenter.x + rotationCos * dx - sin * dy,
        orientedCenter.y + sin * dx + rotationCos * dy,
      ),
    );
  };
  const geometryPointToCrop = (point: OverlayPoint<'oriented-pixels'>): OverlayPoint<'crop-pixels'> => {
    const rotated = rotateOrientedPoint(point, 1);
    return freezePoint(
      overlayPoint<'crop-pixels'>(rotated.x - cropRectInOrientedPixels.x, rotated.y - cropRectInOrientedPixels.y),
    );
  };

  const geometry: EditorOverlayGeometry = {
    cropRectInOrientedPixels,
    devicePixelRatio,
    displayedImageRectInViewCssPixels,
    displayedImageRectInViewportCssPixels,
    geometryEpoch: Math.max(1, Math.round(finite(input.geometryEpoch, 1))),
    orientationSteps,
    orientedSize,
    rotationDegrees: finite(input.rotationDegrees),
    semanticZoom: Object.freeze({ ...input.semanticZoom }),
    sourceSize,
    transform,
    valid:
      sourceSize.width > 0 &&
      sourceSize.height > 0 &&
      cropRectInOrientedPixels.width > 0 &&
      cropRectInOrientedPixels.height > 0 &&
      input.renderSize.width > 0 &&
      input.renderSize.height > 0 &&
      viewportSizeCssPixels.width > 0 &&
      viewportSizeCssPixels.height > 0,
    viewportSizeCssPixels,
    cropPolygonToView: (polygon) => Object.freeze(polygon.map(cropToView)),
    cropRectToView: (rect) => freezeRect(mapRect(rect, cropToView)),
    cropToNormalized,
    cropToOriented: (point) =>
      rotateOrientedPoint(
        overlayPoint<'oriented-pixels'>(point.x + cropRectInOrientedPixels.x, point.y + cropRectInOrientedPixels.y),
        -1,
      ),
    cropToView,
    cropVectorToView: (vector) =>
      Object.freeze(overlayVector<'view-css-pixels'>(vector.x * renderScale, vector.y * renderScale)),
    deviceToViewport: (point) =>
      freezePoint(overlayPoint<'viewport-css-pixels'>(point.x / devicePixelRatio, point.y / devicePixelRatio)),
    isPointInBounds: (point, space) => {
      const size =
        space === 'source-pixels'
          ? sourceSize
          : space === 'oriented-pixels'
            ? orientedSize
            : space === 'crop-pixels'
              ? { height: cropRectInOrientedPixels.height, width: cropRectInOrientedPixels.width }
              : space === 'normalized-crop' || space === 'normalized-oriented' || space === 'normalized-source'
                ? { height: 1, width: 1 }
                : space === 'view-css-pixels'
                  ? { height: input.renderSize.height, width: input.renderSize.width }
                  : space === 'device-pixels'
                    ? {
                        height: viewportSizeCssPixels.height * devicePixelRatio,
                        width: viewportSizeCssPixels.width * devicePixelRatio,
                      }
                    : viewportSizeCssPixels;
      return point.x >= 0 && point.y >= 0 && point.x <= size.width && point.y <= size.height;
    },
    normalizedCropRectToViewport: (rect) =>
      freezeRect(mapRect(rect, (point) => viewToViewport(cropToView(normalizedCropToCrop(point))))),
    normalizedCropRectToView: (rect) => freezeRect(mapRect(rect, (point) => cropToView(normalizedCropToCrop(point)))),
    normalizedCropToCrop,
    normalizedCropToView: (point) => cropToView(normalizedCropToCrop(point)),
    normalizedCropToViewport: (point) => viewToViewport(cropToView(normalizedCropToCrop(point))),
    normalizedOrientedToOriented: (point) =>
      freezePoint(overlayPoint<'oriented-pixels'>(point.x * orientedSize.width, point.y * orientedSize.height)),
    normalizedSourceToSource: (point) =>
      freezePoint(overlayPoint<'source-pixels'>(point.x * sourceSize.width, point.y * sourceSize.height)),
    orientedToCrop: geometryPointToCrop,
    orientedToNormalized: (point) =>
      freezePoint(
        overlayPoint<'normalized-oriented'>(
          point.x / positive(orientedSize.width),
          point.y / positive(orientedSize.height),
        ),
      ),
    orientedPolygonToCrop: (polygon) => Object.freeze(polygon.map(geometryPointToCrop)),
    orientedRectToCrop: (rect) => freezeRect(mapRect(rect, geometryPointToCrop)),
    orientedToSource,
    orientedVectorToCrop: (vector) =>
      Object.freeze(
        overlayVector<'crop-pixels'>(
          rotationCos * vector.x - rotationSin * vector.y,
          rotationSin * vector.x + rotationCos * vector.y,
        ),
      ),
    sourceRectToOriented: (rect) => freezeRect(mapRect(rect, sourceToOriented)),
    sourceToNormalized: (point) =>
      freezePoint(
        overlayPoint<'normalized-source'>(point.x / positive(sourceSize.width), point.y / positive(sourceSize.height)),
      ),
    sourceToOriented,
    sourceVectorToOriented,
    viewBrushWidthFromCrop: (width) => Math.abs(finite(width)) * renderScale,
    viewRadiusFromCrop: (radius) => Math.abs(finite(radius)) * renderScale,
    viewToCrop,
    viewToViewport,
    viewportToDevice: (point) =>
      freezePoint(overlayPoint<'device-pixels'>(point.x * devicePixelRatio, point.y * devicePixelRatio)),
    viewportToNormalizedCrop: (point) => cropToNormalized(viewToCrop(viewportToView(point))),
    viewportToView,
  };

  return Object.freeze(geometry);
};

export const captureGeometryEpoch = (geometry: EditorOverlayGeometry): GeometryEpochCapture =>
  Object.freeze({ geometryEpoch: geometry.geometryEpoch });

export const isGeometryEpochCurrent = (
  capture: GeometryEpochCapture | null | undefined,
  geometry: EditorOverlayGeometry,
): boolean => capture !== null && capture !== undefined && capture.geometryEpoch === geometry.geometryEpoch;

export const commitIfGeometryCurrent = <Value>(
  capture: GeometryEpochCapture | null | undefined,
  geometry: EditorOverlayGeometry,
  commit: () => Value,
): Value | undefined => (isGeometryEpochCurrent(capture, geometry) ? commit() : undefined);
