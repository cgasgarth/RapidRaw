import type { Crop, PercentCrop } from 'react-image-crop';

export type CropInteraction =
  | { kind: 'idle' }
  | {
      kind: 'dragging';
      sessionKey: string;
      percentCrop: PercentCrop;
      lastValidPercentCrop: PercentCrop;
      geometryIdentity: string;
    };

export function activeCropDraft(
  interaction: CropInteraction,
  sessionKey: string,
  geometryIdentity?: string,
): PercentCrop | null {
  return interaction.kind === 'dragging' &&
    interaction.sessionKey === sessionKey &&
    (geometryIdentity === undefined || interaction.geometryIdentity === geometryIdentity)
    ? interaction.percentCrop
    : null;
}

export function updateCropDraft(
  sessionKey: string,
  geometryIdentity: string,
  percentCrop: PercentCrop,
  lastValidPercentCrop: PercentCrop = percentCrop,
): CropInteraction {
  return { kind: 'dragging', sessionKey, geometryIdentity, percentCrop, lastValidPercentCrop };
}

export function getOrientedDimensions(
  imageWidth: number,
  imageHeight: number,
  orientationSteps: number,
): { width: number; height: number } {
  const isSwapped = orientationSteps === 1 || orientationSteps === 3;
  return {
    width: isSwapped ? imageHeight : imageWidth,
    height: isSwapped ? imageWidth : imageHeight,
  };
}

export function calculateCenteredCrop(
  imageWidth: number,
  imageHeight: number,
  orientationSteps: number,
  aspectRatio: number | null,
  rotation: number = 0,
): Crop | null {
  if (!aspectRatio || aspectRatio <= 0) return null;

  const { width: W, height: H } = getOrientedDimensions(imageWidth, imageHeight, orientationSteps);

  const angle = Math.abs(rotation);
  const rad = ((angle % 180) * Math.PI) / 180;
  const sin = Math.sin(rad);
  const cos = Math.cos(rad);

  const h_c = Math.min(H / (aspectRatio * sin + cos), W / (aspectRatio * cos + sin));
  const w_c = aspectRatio * h_c;

  return {
    x: Math.round((W - w_c) / 2),
    y: Math.round((H - h_c) / 2),
    width: Math.round(w_c),
    height: Math.round(h_c),
  };
}

export interface CropGeometryParams {
  aspectRatio: number | null;
  orientationSteps: number;
  rotation: number;
}

export interface ResolveNextCropForGeometryChangeInput {
  aspectRatio: number | null;
  currentCrop: Crop | null;
  effectiveRotation: number;
  imageHeight: number;
  imageWidth: number;
  isDraggingRotation: boolean;
  orientationSteps: number;
  previousParams: CropGeometryParams | null;
  rotation: number;
}

export interface ResolveNextCropForGeometryChangeResult {
  nextPixelCrop: Crop | null;
  orientedHeight: number;
  orientedWidth: number;
}

const CROP_VALIDITY_TOLERANCE_PX = 1;
const MAXIMIZED_CROP_TOLERANCE_PX = 2;
const SHRINK_ITERATIONS = 10;
const MIN_ACCEPTABLE_SHRINK = 0.15;

export function isCropValidAfterRotation(
  pixelCrop: Partial<Crop> | null,
  imageWidth: number,
  imageHeight: number,
  rotation: number,
): boolean {
  if (
    pixelCrop === null ||
    pixelCrop.x === undefined ||
    pixelCrop.y === undefined ||
    !pixelCrop.width ||
    !pixelCrop.height
  ) {
    return false;
  }

  const cx = imageWidth / 2;
  const cy = imageHeight / 2;
  const rad = (-rotation * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);

  const points = [
    { x: pixelCrop.x, y: pixelCrop.y },
    { x: pixelCrop.x + pixelCrop.width, y: pixelCrop.y },
    { x: pixelCrop.x, y: pixelCrop.y + pixelCrop.height },
    { x: pixelCrop.x + pixelCrop.width, y: pixelCrop.y + pixelCrop.height },
  ];

  return points.every((point) => {
    const nx = cos * (point.x - cx) - sin * (point.y - cy) + cx;
    const ny = sin * (point.x - cx) + cos * (point.y - cy) + cy;
    return (
      nx >= -CROP_VALIDITY_TOLERANCE_PX &&
      nx <= imageWidth + CROP_VALIDITY_TOLERANCE_PX &&
      ny >= -CROP_VALIDITY_TOLERANCE_PX &&
      ny <= imageHeight + CROP_VALIDITY_TOLERANCE_PX
    );
  });
}

export function percentCropFromPixelCrop(pixelCrop: Crop, imageWidth: number, imageHeight: number): PercentCrop {
  return {
    unit: '%',
    x: (pixelCrop.x / imageWidth) * 100,
    y: (pixelCrop.y / imageHeight) * 100,
    width: (pixelCrop.width / imageWidth) * 100,
    height: (pixelCrop.height / imageHeight) * 100,
  };
}

/** Convert an interaction crop back to the persisted oriented-pixel space. */
export function pixelCropFromPercentCrop(percentCrop: PercentCrop, imageWidth: number, imageHeight: number): Crop {
  return {
    unit: 'px',
    x: Math.ceil((percentCrop.x / 100) * imageWidth - 1e-9),
    y: Math.ceil((percentCrop.y / 100) * imageHeight - 1e-9),
    width: Math.floor((percentCrop.width / 100) * imageWidth),
    height: Math.floor((percentCrop.height / 100) * imageHeight),
  };
}

export function cropGeometryIdentity(
  imagePath: string,
  imageWidth: number,
  imageHeight: number,
  params: CropGeometryParams,
): string {
  return [
    imagePath,
    imageWidth,
    imageHeight,
    params.orientationSteps,
    params.aspectRatio ?? 'free',
    params.rotation,
  ].join(':');
}

export function resolveCropForGeometryTransaction(
  currentCrop: Crop | null,
  imageWidth: number,
  imageHeight: number,
  previousParams: CropGeometryParams,
  nextParams: CropGeometryParams,
): Crop | null {
  return resolveNextCropForGeometryChange({
    aspectRatio: nextParams.aspectRatio,
    currentCrop,
    effectiveRotation: nextParams.rotation,
    imageHeight,
    imageWidth,
    isDraggingRotation: false,
    orientationSteps: nextParams.orientationSteps,
    previousParams,
    rotation: nextParams.rotation,
  }).nextPixelCrop;
}

export function isCropChangeMeaningful(currentCrop: Crop | null, nextCrop: Crop | null): boolean {
  return (
    nextCrop !== null &&
    (currentCrop === null ||
      Math.abs(currentCrop.x - nextCrop.x) > CROP_VALIDITY_TOLERANCE_PX ||
      Math.abs(currentCrop.y - nextCrop.y) > CROP_VALIDITY_TOLERANCE_PX ||
      Math.abs(currentCrop.width - nextCrop.width) > CROP_VALIDITY_TOLERANCE_PX ||
      Math.abs(currentCrop.height - nextCrop.height) > CROP_VALIDITY_TOLERANCE_PX)
  );
}

export function didCropGeometryChange(
  previousParams: CropGeometryParams | null,
  nextParams: CropGeometryParams,
): boolean {
  return (
    previousParams === null ||
    previousParams.rotation !== nextParams.rotation ||
    previousParams.aspectRatio !== nextParams.aspectRatio ||
    previousParams.orientationSteps !== nextParams.orientationSteps
  );
}

export function resolveNextCropForGeometryChange({
  aspectRatio,
  currentCrop,
  effectiveRotation,
  imageHeight,
  imageWidth,
  isDraggingRotation,
  orientationSteps,
  previousParams,
  rotation,
}: ResolveNextCropForGeometryChangeInput): ResolveNextCropForGeometryChangeResult {
  const { width: orientedWidth, height: orientedHeight } = getOrientedDimensions(
    imageWidth,
    imageHeight,
    orientationSteps,
  );
  const effectiveAspectRatio = aspectRatio || orientedWidth / orientedHeight;
  const aspectChanged = previousParams?.aspectRatio !== aspectRatio;
  const orientationChanged = previousParams?.orientationSteps !== orientationSteps;
  const rotationChanged = previousParams?.rotation !== rotation || isDraggingRotation;
  let nextPixelCrop = currentCrop;

  if (!currentCrop || orientationChanged) {
    nextPixelCrop = calculateCenteredCrop(
      imageWidth,
      imageHeight,
      orientationSteps,
      effectiveAspectRatio,
      effectiveRotation,
    );
  } else if (aspectChanged) {
    nextPixelCrop =
      aspectRatio === null ? currentCrop : fitCropToAspectRatioAtCenter(currentCrop, effectiveAspectRatio);

    if (!isCropValidAfterRotation(nextPixelCrop, orientedWidth, orientedHeight, effectiveRotation)) {
      nextPixelCrop = calculateCenteredCrop(
        imageWidth,
        imageHeight,
        orientationSteps,
        effectiveAspectRatio,
        effectiveRotation,
      );
    }
  } else if (
    rotationChanged &&
    isMaximizedCrop(
      currentCrop,
      imageWidth,
      imageHeight,
      orientationSteps,
      effectiveAspectRatio,
      previousParams.rotation,
    )
  ) {
    nextPixelCrop = calculateCenteredCrop(
      imageWidth,
      imageHeight,
      orientationSteps,
      effectiveAspectRatio,
      effectiveRotation,
    );
  } else if (!isCropValidAfterRotation(currentCrop, orientedWidth, orientedHeight, effectiveRotation)) {
    nextPixelCrop =
      shrinkCropToFitRotation(currentCrop, orientedWidth, orientedHeight, effectiveRotation) ??
      calculateCenteredCrop(imageWidth, imageHeight, orientationSteps, effectiveAspectRatio, effectiveRotation);
  }

  return { nextPixelCrop, orientedWidth, orientedHeight };
}

function fitCropToAspectRatioAtCenter(currentCrop: Crop, aspectRatio: number): Crop {
  const curCx = currentCrop.x + currentCrop.width / 2;
  const curCy = currentCrop.y + currentCrop.height / 2;

  let newW = currentCrop.width;
  let newH = currentCrop.width / aspectRatio;

  if (newH > currentCrop.height) {
    newH = currentCrop.height;
    newW = currentCrop.height * aspectRatio;
  }

  return {
    unit: 'px',
    x: Math.ceil(curCx - newW / 2),
    y: Math.ceil(curCy - newH / 2),
    width: Math.floor(newW),
    height: Math.floor(newH),
  };
}

function isMaximizedCrop(
  currentCrop: Crop,
  imageWidth: number,
  imageHeight: number,
  orientationSteps: number,
  aspectRatio: number,
  referenceRotation: number,
): boolean {
  const maxCropForReference = calculateCenteredCrop(
    imageWidth,
    imageHeight,
    orientationSteps,
    aspectRatio,
    referenceRotation,
  );

  return (
    maxCropForReference !== null &&
    Math.abs(currentCrop.x - maxCropForReference.x) <= MAXIMIZED_CROP_TOLERANCE_PX &&
    Math.abs(currentCrop.y - maxCropForReference.y) <= MAXIMIZED_CROP_TOLERANCE_PX &&
    Math.abs(currentCrop.width - maxCropForReference.width) <= MAXIMIZED_CROP_TOLERANCE_PX &&
    Math.abs(currentCrop.height - maxCropForReference.height) <= MAXIMIZED_CROP_TOLERANCE_PX
  );
}

function shrinkCropToFitRotation(
  currentCrop: Crop,
  imageWidth: number,
  imageHeight: number,
  rotation: number,
): Crop | null {
  let low = 0.1;
  let high = 1.0;
  let bestCrop = currentCrop;

  for (let i = 0; i < SHRINK_ITERATIONS; i++) {
    const mid = (low + high) / 2;
    const cx = currentCrop.x + currentCrop.width / 2;
    const cy = currentCrop.y + currentCrop.height / 2;
    const nw = currentCrop.width * mid;
    const nh = currentCrop.height * mid;
    const testCrop = {
      unit: 'px' as const,
      x: cx - nw / 2,
      y: cy - nh / 2,
      width: nw,
      height: nh,
    };

    if (isCropValidAfterRotation(testCrop, imageWidth, imageHeight, rotation)) {
      bestCrop = testCrop;
      low = mid;
    } else {
      high = mid;
    }
  }

  if (low < MIN_ACCEPTABLE_SHRINK) return null;

  return {
    unit: 'px',
    x: Math.ceil(bestCrop.x),
    y: Math.ceil(bestCrop.y),
    width: Math.floor(bestCrop.width),
    height: Math.floor(bestCrop.height),
  };
}
