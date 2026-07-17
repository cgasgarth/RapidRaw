import type { CSSProperties } from 'react';
import type { EditDocumentGeometryCropV2 } from '../../packages/rawengine-schema/src/editDocumentV2';

export type DetailLoupePhase = 'current' | 'pending' | 'error';
export type DetailModifierPreview = 'sharpening' | 'noise-reduction';

export interface DetailLoupeIdentity {
  readonly imageSessionId: string;
  readonly renderRevision: number;
  readonly sourceIdentity: string;
}

export interface DetailLoupeTarget extends DetailLoupeIdentity {
  /** Normalized coordinates in the currently displayed (cropped/oriented) image. */
  readonly x: number;
  readonly y: number;
}

export interface DetailLoupeRect {
  readonly height: number;
  readonly width: number;
  readonly x: number;
  readonly y: number;
}

export interface DetailLoupeBackgroundInput {
  readonly devicePixelRatio: number;
  readonly imageRect: DetailLoupeRect;
  readonly orientationSteps: number;
  readonly sourceSize: { readonly height: number; readonly width: number };
  readonly target: Pick<DetailLoupeTarget, 'x' | 'y'>;
}

const clampUnit = (value: number): number => Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0.5));

export const clampDetailLoupeTarget = (
  target: Pick<DetailLoupeTarget, 'x' | 'y'>,
): Pick<DetailLoupeTarget, 'x' | 'y'> => ({
  x: clampUnit(target.x),
  y: clampUnit(target.y),
});

export const createDetailLoupeTarget = (
  identity: DetailLoupeIdentity,
  normalizedPoint: Pick<DetailLoupeTarget, 'x' | 'y'>,
): DetailLoupeTarget => ({ ...identity, ...clampDetailLoupeTarget(normalizedPoint) });

export const resolveDetailLoupePhase = ({
  currentIdentity,
  previewUrl,
  resolutionState,
  target,
}: {
  readonly currentIdentity: DetailLoupeIdentity | null;
  readonly previewUrl: string | null;
  readonly resolutionState: 'ready' | 'settling' | 'limited';
  readonly target: DetailLoupeTarget | null;
}): DetailLoupePhase => {
  if (currentIdentity === null || target === null || previewUrl === null) return 'pending';
  if (
    target.imageSessionId !== currentIdentity.imageSessionId ||
    target.renderRevision !== currentIdentity.renderRevision ||
    target.sourceIdentity !== currentIdentity.sourceIdentity
  ) {
    return 'pending';
  }
  return resolutionState === 'ready' ? 'current' : 'pending';
};

/**
 * Return a CSS background that samples the current rendered frame at 1:1.
 * The image itself remains the renderer's authority; this is only a transient inspection window.
 */
export const resolveDetailLoupeBackground = ({
  devicePixelRatio,
  imageRect,
  orientationSteps,
  sourceSize,
  target,
}: DetailLoupeBackgroundInput): CSSProperties => {
  const width = Math.max(1, imageRect.width);
  const height = Math.max(1, imageRect.height);
  const sourceWidth = Math.max(1, sourceSize.width);
  const sourceHeight = Math.max(1, sourceSize.height);
  const dpr = Math.max(1, Number.isFinite(devicePixelRatio) ? devicePixelRatio : 1);
  return {
    backgroundPosition: `${String(clampUnit(target.x) * 100)}% ${String(clampUnit(target.y) * 100)}%`,
    backgroundSize: `${String(sourceWidth * dpr)}px ${String(sourceHeight * dpr)}px`,
    transform: `rotate(${String((((orientationSteps % 4) + 4) % 4) * 90)}deg)`,
    transformOrigin: 'center',
    // Keep a stable ratio available to tests and responsive CSS consumers.
    ['--detail-loupe-image-ratio' as string]: `${String(sourceWidth / width)} ${String(sourceHeight / height)}`,
  };
};

export const resolveDetailModifierPreview = ({
  altKey,
  dragging,
  hovered,
}: {
  readonly altKey: boolean;
  readonly dragging: boolean;
  readonly hovered: DetailModifierPreview | null;
}): DetailModifierPreview | null => (altKey && dragging ? hovered : null);

export const isDetailLoupeCropCurrent = (
  crop: EditDocumentGeometryCropV2 | null | undefined,
  target: Pick<DetailLoupeTarget, 'x' | 'y'> | null,
): boolean => {
  if (!crop || !target) return true;
  return crop.width > 0 && crop.height > 0 && target.x >= 0 && target.x <= 1 && target.y >= 0 && target.y <= 1;
};
