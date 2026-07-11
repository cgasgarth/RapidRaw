import type { TransformState } from '../components/ui/AppProperties';
import type { RenderSize } from '../hooks/viewport/useImageRenderSize';

export type RgbaColor = [number, number, number, number];

export interface WgpuTransformColors {
  bgPrimary: RgbaColor;
  bgSecondary: RgbaColor;
}

export interface WgpuTransformPayload {
  bgPrimary: RgbaColor;
  bgSecondary: RgbaColor;
  clipHeight: number;
  clipWidth: number;
  clipX: number;
  clipY: number;
  height: number;
  pixelated: boolean;
  width: number;
  windowHeight: number;
  windowWidth: number;
  x: number;
  y: number;
}

export interface WgpuTransformGeometry {
  containerRect: Pick<DOMRect, 'height' | 'left' | 'top' | 'width'>;
  dpr: number;
  imageRenderSize: RenderSize;
  maxScale: number;
  transformState: TransformState;
  windowHeight: number;
  windowWidth: number;
}

export const WGPU_TRANSFORM_OVERLAP_PX = 2;
export const WGPU_HIDDEN_COORDINATE = -999999;

const MIN_WGPU_SURFACE_SIZE = 1;
const PIXELATED_MAX_SCALE_EPSILON = 0.5;

export const shouldSubmitVisibleWgpuTransform = (
  useWgpuRenderer: boolean | undefined,
  selectedImageIsReady: boolean,
): boolean => useWgpuRenderer !== false && selectedImageIsReady;

export const parseCssRgbColor = (rgbStr: string): RgbaColor => {
  const match = rgbStr.match(/[\d.]+/g);
  const [r, g, b] = match ?? [];
  if (r !== undefined && g !== undefined && b !== undefined) {
    return [parseFloat(r) / 255, parseFloat(g) / 255, parseFloat(b) / 255, 1.0];
  }
  return [0, 0, 0, 1.0];
};

export const buildHiddenWgpuTransformPayload = (
  geometry: Pick<WgpuTransformGeometry, 'containerRect' | 'dpr' | 'windowHeight' | 'windowWidth'>,
  colors: WgpuTransformColors,
): WgpuTransformPayload => {
  const clip = buildClipRect(geometry.containerRect, geometry.dpr);

  return {
    windowWidth: geometry.windowWidth,
    windowHeight: geometry.windowHeight,
    x: WGPU_HIDDEN_COORDINATE,
    y: WGPU_HIDDEN_COORDINATE,
    width: MIN_WGPU_SURFACE_SIZE,
    height: MIN_WGPU_SURFACE_SIZE,
    clipX: clip.x,
    clipY: clip.y,
    clipWidth: clip.width,
    clipHeight: clip.height,
    bgPrimary: colors.bgPrimary,
    bgSecondary: colors.bgSecondary,
    pixelated: false,
  };
};

export const buildVisibleWgpuTransformPayload = (
  geometry: WgpuTransformGeometry,
  colors: WgpuTransformColors,
  isCropViewVisible: boolean,
): WgpuTransformPayload => {
  const clip = buildClipRect(geometry.containerRect, geometry.dpr);
  const { scale, positionX, positionY } = geometry.transformState;
  const { imageRenderSize } = geometry;
  const offsetX = imageRenderSize.width > 0 ? imageRenderSize.offsetX : 0;
  const offsetY = imageRenderSize.height > 0 ? imageRenderSize.offsetY : 0;
  const baseW = imageRenderSize.width > 0 ? imageRenderSize.width : geometry.containerRect.width;
  const baseH = imageRenderSize.height > 0 ? imageRenderSize.height : geometry.containerRect.height;

  let screenX = (geometry.containerRect.left + positionX + offsetX * scale) * geometry.dpr || 0;
  let screenY = (geometry.containerRect.top + positionY + offsetY * scale) * geometry.dpr || 0;
  let screenW = baseW * scale * geometry.dpr || MIN_WGPU_SURFACE_SIZE;
  let screenH = baseH * scale * geometry.dpr || MIN_WGPU_SURFACE_SIZE;

  if (isCropViewVisible) {
    screenX = WGPU_HIDDEN_COORDINATE;
    screenY = WGPU_HIDDEN_COORDINATE;
    screenW = MIN_WGPU_SURFACE_SIZE;
    screenH = MIN_WGPU_SURFACE_SIZE;
  } else {
    screenW = Math.max(screenW, MIN_WGPU_SURFACE_SIZE);
    screenH = Math.max(screenH, MIN_WGPU_SURFACE_SIZE);
  }

  return {
    windowWidth: geometry.windowWidth,
    windowHeight: geometry.windowHeight,
    x: screenX,
    y: screenY,
    width: screenW,
    height: screenH,
    clipX: clip.x,
    clipY: clip.y,
    clipWidth: clip.width,
    clipHeight: clip.height,
    bgPrimary: colors.bgPrimary,
    bgSecondary: colors.bgSecondary,
    pixelated: scale >= geometry.maxScale - PIXELATED_MAX_SCALE_EPSILON,
  };
};

export const fingerprintWgpuTransformPayload = (payload: WgpuTransformPayload): string =>
  [
    payload.windowWidth,
    payload.windowHeight,
    payload.x,
    payload.y,
    payload.width,
    payload.height,
    payload.clipX,
    payload.clipY,
    payload.clipWidth,
    payload.clipHeight,
    ...payload.bgPrimary,
    ...payload.bgSecondary,
  ].join(',');

const buildClipRect = (containerRect: Pick<DOMRect, 'height' | 'left' | 'top' | 'width'>, dpr: number) => ({
  x: (containerRect.left - WGPU_TRANSFORM_OVERLAP_PX) * dpr,
  y: (containerRect.top - WGPU_TRANSFORM_OVERLAP_PX) * dpr,
  width: Math.max((containerRect.width + WGPU_TRANSFORM_OVERLAP_PX * 2) * dpr, MIN_WGPU_SURFACE_SIZE),
  height: Math.max((containerRect.height + WGPU_TRANSFORM_OVERLAP_PX * 2) * dpr, MIN_WGPU_SURFACE_SIZE),
});
