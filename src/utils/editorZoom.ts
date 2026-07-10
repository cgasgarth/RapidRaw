export interface EditorZoomDimensions {
  height: number;
  width: number;
}

export interface EditorZoomRenderSize extends EditorZoomDimensions {
  scale: number;
}

export type EditorZoomMode = { kind: 'fit' } | { kind: 'fill' } | { devicePixelsPerImagePixel: number; kind: 'ratio' };

export type EditorZoomCommand =
  | { kind: 'fit' }
  | { kind: 'fill' }
  | { kind: 'one-to-one' }
  | { kind: 'two-to-one' }
  | { devicePixelsPerImagePixel: number; kind: 'ratio' }
  | { direction: 'in' | 'out'; kind: 'step' }
  | { kind: 'cycle' };

export interface ResolveEditorZoomInput {
  devicePixelRatio: number;
  mode: EditorZoomMode;
  renderSize: EditorZoomRenderSize;
  sourceSize: EditorZoomDimensions;
  viewportSize: EditorZoomDimensions;
}

export interface EditorZoomSourceInput {
  crop: EditorZoomDimensions | null | undefined;
  orientationSteps: number | undefined;
  originalSize: EditorZoomDimensions;
}

export interface ResolvedEditorZoom {
  cssPercent: number;
  devicePixelsPerImagePixel: number;
  displayPercent: number;
  imagePixelsPerCssPixel: number;
  imagePixelsPerDevicePixel: number;
  mode: EditorZoomMode;
  requiredPreviewResolution: number;
  transformScale: number;
}

export type EditorZoomResolutionState = 'ready' | 'settling' | 'limited';

export const DEFAULT_EDITOR_ZOOM_MODE: EditorZoomMode = { kind: 'fit' };
export const EDITOR_ZOOM_MIN_RATIO = 0.1;
export const EDITOR_ZOOM_MAX_RATIO = 4;
export const EDITOR_ZOOM_STEP_LADDER = [0.25, 1 / 3, 0.5, 2 / 3, 1, 1.5, 2, 3, 4] as const;
export const PIXELATED_INSPECTION_DEVICE_RATIO = 2;

const finitePositive = (value: number, fallback: number): number =>
  Number.isFinite(value) && value > 0 ? value : fallback;

export const normalizeEditorZoomRatio = (value: number): number =>
  Math.min(EDITOR_ZOOM_MAX_RATIO, Math.max(EDITOR_ZOOM_MIN_RATIO, finitePositive(value, 1)));

export const getEditorZoomDpr = (value: number | undefined): number => finitePositive(value ?? 1, 1);

export const getEditorZoomTransformScale = ({
  devicePixelRatio,
  devicePixelsPerImagePixel,
  renderScale,
}: {
  devicePixelRatio: number;
  devicePixelsPerImagePixel: number;
  renderScale: number;
}): number =>
  normalizeEditorZoomRatio(devicePixelsPerImagePixel) /
  (getEditorZoomDpr(devicePixelRatio) * finitePositive(renderScale, 1));

export const getEditorZoomSourceSize = ({
  crop,
  orientationSteps,
  originalSize,
}: EditorZoomSourceInput): EditorZoomDimensions => {
  if (crop && crop.width > 0 && crop.height > 0) return crop;
  const isRotated = (orientationSteps ?? 0) % 2 !== 0;
  return isRotated
    ? { height: originalSize.width, width: originalSize.height }
    : { height: originalSize.height, width: originalSize.width };
};

export const isEditorZoomModeEqual = (left: EditorZoomMode, right: EditorZoomMode): boolean =>
  left.kind === right.kind &&
  (left.kind !== 'ratio' ||
    right.kind !== 'ratio' ||
    left.devicePixelsPerImagePixel === right.devicePixelsPerImagePixel);

export const resolveEditorZoom = ({
  devicePixelRatio,
  mode,
  renderSize,
  sourceSize,
  viewportSize,
}: ResolveEditorZoomInput): ResolvedEditorZoom => {
  const dpr = getEditorZoomDpr(devicePixelRatio);
  const sourceWidth = finitePositive(sourceSize.width, 1);
  const sourceHeight = finitePositive(sourceSize.height, 1);
  const renderWidth = finitePositive(renderSize.width, 0);
  const renderHeight = finitePositive(renderSize.height, 0);
  const renderScale = finitePositive(renderSize.scale, renderWidth / sourceWidth || 1);
  const viewportWidth = finitePositive(viewportSize.width, renderWidth || 1);
  const viewportHeight = finitePositive(viewportSize.height, renderHeight || 1);
  const fillScale = Math.max(
    viewportWidth / (renderWidth || viewportWidth),
    viewportHeight / (renderHeight || viewportHeight),
  );
  const requestedRatio = mode.kind === 'ratio' ? normalizeEditorZoomRatio(mode.devicePixelsPerImagePixel) : null;
  const transformScale =
    mode.kind === 'fit'
      ? 1
      : mode.kind === 'fill'
        ? fillScale
        : getEditorZoomTransformScale({
            devicePixelRatio: dpr,
            devicePixelsPerImagePixel: requestedRatio ?? 1,
            renderScale,
          });
  const devicePixelsPerImagePixel = dpr * renderScale * transformScale;
  const requiredPreviewResolution = Math.min(
    Math.max(sourceWidth, sourceHeight),
    Math.max(1, Math.ceil(Math.max(renderWidth * transformScale, renderHeight * transformScale) * dpr)),
  );

  return {
    cssPercent: (devicePixelsPerImagePixel / dpr) * 100,
    devicePixelsPerImagePixel,
    displayPercent: Math.round(devicePixelsPerImagePixel * 100),
    imagePixelsPerCssPixel: dpr / devicePixelsPerImagePixel,
    imagePixelsPerDevicePixel: 1 / devicePixelsPerImagePixel,
    mode,
    requiredPreviewResolution,
    transformScale,
  };
};

export const getEditorZoomModeForCommand = (
  command: EditorZoomCommand,
  current: ResolvedEditorZoom,
): EditorZoomMode => {
  switch (command.kind) {
    case 'fit':
      return { kind: 'fit' };
    case 'fill':
      return { kind: 'fill' };
    case 'one-to-one':
      return { devicePixelsPerImagePixel: 1, kind: 'ratio' };
    case 'two-to-one':
      return { devicePixelsPerImagePixel: 2, kind: 'ratio' };
    case 'ratio':
      return { devicePixelsPerImagePixel: normalizeEditorZoomRatio(command.devicePixelsPerImagePixel), kind: 'ratio' };
    case 'cycle':
      if (current.mode.kind === 'fit') return { devicePixelsPerImagePixel: 1, kind: 'ratio' };
      if (current.mode.kind === 'ratio' && current.mode.devicePixelsPerImagePixel < 1.5) {
        return { devicePixelsPerImagePixel: 2, kind: 'ratio' };
      }
      return { kind: 'fit' };
    case 'step': {
      const ratio = current.devicePixelsPerImagePixel;
      if (command.direction === 'in') {
        return {
          devicePixelsPerImagePixel:
            EDITOR_ZOOM_STEP_LADDER.find((step) => step > ratio + 0.001) ?? EDITOR_ZOOM_MAX_RATIO,
          kind: 'ratio',
        };
      }

      const lowerSteps = EDITOR_ZOOM_STEP_LADDER.filter((step) => step < ratio - 0.001);
      const nextRatio = lowerSteps.at(-1);
      if (nextRatio === undefined || (nextRatio <= current.devicePixelsPerImagePixel && nextRatio < 0.25)) {
        return { kind: 'fit' };
      }
      return { devicePixelsPerImagePixel: nextRatio, kind: 'ratio' };
    }
  }
};

export const getEditorZoomResolutionState = ({
  renderedPreviewResolution,
  requestedPreviewResolution,
  resolvedZoom,
}: {
  renderedPreviewResolution: number;
  requestedPreviewResolution: number;
  resolvedZoom: ResolvedEditorZoom;
}): EditorZoomResolutionState => {
  if (requestedPreviewResolution < resolvedZoom.requiredPreviewResolution) return 'limited';
  if (renderedPreviewResolution < resolvedZoom.requiredPreviewResolution) return 'settling';
  return 'ready';
};

export const formatEditorZoomLabel = (
  resolvedZoom: ResolvedEditorZoom,
  labels: { fill: string; fit: string },
): string => {
  if (resolvedZoom.mode.kind === 'fit') return labels.fit;
  if (resolvedZoom.mode.kind === 'fill') return labels.fill;
  return `${String(resolvedZoom.displayPercent)}%`;
};

export const isEditorPixelInspectionZoom = (resolvedZoom: ResolvedEditorZoom): boolean =>
  resolvedZoom.devicePixelsPerImagePixel >= PIXELATED_INSPECTION_DEVICE_RATIO;
