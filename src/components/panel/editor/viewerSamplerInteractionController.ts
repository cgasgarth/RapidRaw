import {
  createViewerSampleRequest,
  mapViewerPointToImage,
  resolveViewerSampleTarget,
  type ViewerSampleRequest,
  type ViewerSampleTarget,
} from '../../../utils/viewerSampler';

export interface ViewerSamplerInteractionPointer {
  readonly altKey: boolean;
  readonly clientX: number;
  readonly clientY: number;
}

export interface ViewerSamplerInteractionRect {
  readonly height: number;
  readonly width: number;
  readonly x: number;
  readonly y: number;
}

export interface ViewerSamplerInteractionRenderSize {
  readonly height: number;
  readonly offsetX: number;
  readonly offsetY: number;
  readonly width: number;
}

export interface ViewerSamplerInteractionContext {
  readonly compareDividerPosition: number;
  readonly compareMode: 'off' | 'hold-original' | 'split-wipe' | 'side-by-side';
  readonly compareOrientation: 'horizontal' | 'vertical';
  readonly displayedImageRect: ViewerSamplerInteractionRect;
  readonly editedRenderSize: ViewerSamplerInteractionRenderSize;
  readonly geometryEpoch: number;
  readonly graphRevision: string;
  readonly imageIdentity: string;
  readonly originalRenderSize: ViewerSamplerInteractionRenderSize;
  readonly proofEnabled: boolean;
  readonly sourceImageSize: { readonly height: number; readonly width: number };
}

export interface ViewerSamplerInteractionResult {
  readonly request: ViewerSampleRequest;
  readonly target: ViewerSampleTarget;
}

/** Converts one surface pointer into the canonical sampler request and target. */
export const resolveViewerSamplerInteraction = (
  context: ViewerSamplerInteractionContext,
  pointer: ViewerSamplerInteractionPointer,
  surfaceRect: ViewerSamplerInteractionRect & { readonly layoutHeight: number; readonly layoutWidth: number },
): ViewerSamplerInteractionResult | null => {
  if (
    surfaceRect.width <= 0 ||
    surfaceRect.height <= 0 ||
    surfaceRect.layoutWidth <= 0 ||
    surfaceRect.layoutHeight <= 0
  ) {
    return null;
  }
  const normalizedViewerX = (pointer.clientX - surfaceRect.x) / surfaceRect.width;
  const normalizedViewerY = (pointer.clientY - surfaceRect.y) / surfaceRect.height;
  const target = resolveViewerSampleTarget({
    compareMode: context.compareMode,
    compareDividerPosition: context.compareDividerPosition,
    compareOrientation: context.compareOrientation,
    normalizedViewerX,
    normalizedViewerY,
    softProofEnabled: context.proofEnabled,
  });
  const sideBySideRenderSize =
    context.compareMode === 'side-by-side'
      ? target === 'original'
        ? context.originalRenderSize
        : context.editedRenderSize
      : null;
  const mapped = mapViewerPointToImage({
    clientPoint: { x: pointer.clientX, y: pointer.clientY },
    displayedImageRect: sideBySideRenderSize
      ? {
          x: sideBySideRenderSize.offsetX,
          y: sideBySideRenderSize.offsetY,
          width: sideBySideRenderSize.width,
          height: sideBySideRenderSize.height,
        }
      : context.displayedImageRect,
    surfaceRect,
  });
  if (mapped === null) return null;
  return {
    request: createViewerSampleRequest({
      imageIdentity: context.imageIdentity,
      graphRevision: context.graphRevision,
      geometryEpoch: context.geometryEpoch,
      normalizedImagePoint: mapped.normalizedImagePoint,
      sourceImageSize: context.sourceImageSize,
      target,
      sampleRadiusImagePx: pointer.altKey ? 4 : 0,
      requestedSpace: 'displayEncoded',
    }),
    target,
  };
};
