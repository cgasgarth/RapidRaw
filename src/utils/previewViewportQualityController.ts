import type { BaseRenderSize, ImageDimensions } from '../hooks/viewport/useImageRenderSize';
import {
  AdaptivePreviewQualityController,
  type PreviewBackend,
  type PreviewOperationClass,
  type PreviewQualityDecision,
  type PreviewRoi,
  type PreviewTimingSample,
} from './adaptivePreviewQuality';
import type { Adjustments } from './adjustments';
import { type EditorZoomMode, getEditorZoomDpr, getEditorZoomSourceSize, resolveEditorZoom } from './editorZoom';
import {
  fingerprintPreviewRoi,
  type PreviewViewportTransformSnapshot,
  resolvePreviewViewportRoi,
} from './previewCoordinator';

export interface PreviewViewportQualityInput {
  readonly baseRenderSize: BaseRenderSize;
  readonly crop: Adjustments['crop'];
  readonly devicePixelRatio: number;
  readonly enableZoomHifi: boolean;
  readonly highResZoomMultiplier: number;
  readonly orientationSteps: number;
  readonly originalSize: ImageDimensions;
  readonly previewResolution: number;
  readonly transform: PreviewViewportTransformSnapshot;
  readonly zoomMode: EditorZoomMode;
}

export interface PreviewViewportQualitySnapshot {
  readonly devicePixelRatio: number;
  readonly requestedTargetResolution: number;
  readonly roi: PreviewRoi | null;
  readonly roiFingerprint: string;
  readonly semanticZoom: 'fit' | 'inspection' | 'viewport';
  readonly sourceHeight: number;
  readonly sourceWidth: number;
}

export interface PreviewQualityRequest {
  readonly backend: PreviewBackend;
  readonly interacting: boolean;
  readonly operationClass: PreviewOperationClass;
  readonly requestedTargetResolution?: number;
  readonly viewport: PreviewViewportQualitySnapshot;
}

const quantizeTargetResolution = (target: number, sourceLongEdge: number): number => {
  if (target === sourceLongEdge) return Math.round(target);
  return Math.round(Math.ceil(target / 256) * 256);
};

/** Owns viewport identity inputs and adaptive quality history for one editor session. */
export class PreviewViewportQualityController {
  private readonly policy = new AdaptivePreviewQualityController();

  constructor(private readonly now: () => number = () => globalThis.performance?.now() ?? Date.now()) {}

  decide(request: PreviewQualityRequest): PreviewQualityDecision {
    if (request.interacting) this.policy.noteInput(this.now());
    const viewport = request.viewport;
    return this.policy.decide({
      backend: request.backend,
      devicePixelRatio: viewport.devicePixelRatio,
      interacting: request.interacting,
      operationClass: request.operationClass,
      requestedTargetResolution: request.requestedTargetResolution ?? viewport.requestedTargetResolution,
      semanticZoom: viewport.semanticZoom,
      sourceHeight: viewport.sourceHeight,
      sourceWidth: viewport.sourceWidth,
      visibleRoi: viewport.roi,
    });
  }

  record(sample: PreviewTimingSample): void {
    this.policy.record(sample);
  }

  reset(): void {
    this.policy.reset();
  }

  snapshot(input: PreviewViewportQualityInput): PreviewViewportQualitySnapshot {
    const devicePixelRatio = getEditorZoomDpr(input.devicePixelRatio);
    const sourceSize = getEditorZoomSourceSize({
      crop: input.crop,
      orientationSteps: input.orientationSteps,
      originalSize: input.originalSize,
    });
    const roi = resolvePreviewViewportRoi(input.baseRenderSize, input.transform);
    const semanticZoom =
      input.zoomMode.kind === 'fit'
        ? 'fit'
        : input.zoomMode.kind === 'ratio' && input.zoomMode.devicePixelsPerImagePixel >= 1
          ? 'inspection'
          : 'viewport';
    const baseTarget = Math.max(1, Math.round(input.previewResolution));
    let requestedTargetResolution = baseTarget;
    if (input.enableZoomHifi && input.baseRenderSize.width > 0) {
      const resolvedZoom = resolveEditorZoom({
        devicePixelRatio,
        mode: input.zoomMode,
        renderSize: {
          height: input.baseRenderSize.height,
          scale: input.baseRenderSize.width / Math.max(sourceSize.width, 1),
          width: input.baseRenderSize.width,
        },
        sourceSize,
        viewportSize: {
          height: input.baseRenderSize.containerHeight,
          width: input.baseRenderSize.containerWidth,
        },
      });
      requestedTargetResolution = Math.max(
        baseTarget,
        resolvedZoom.requiredPreviewResolution * 1.25 * Math.max(0, input.highResZoomMultiplier),
        512,
      );
      const sourceLongEdge = Math.max(input.originalSize.width, input.originalSize.height);
      if (input.originalSize.width > 0 && input.originalSize.height > 0) {
        requestedTargetResolution = Math.min(requestedTargetResolution, sourceLongEdge);
        if (requestedTargetResolution >= sourceLongEdge * 0.8) requestedTargetResolution = sourceLongEdge;
      }
      requestedTargetResolution = quantizeTargetResolution(requestedTargetResolution, sourceLongEdge);
    }
    return {
      devicePixelRatio,
      requestedTargetResolution: Math.max(1, Math.round(requestedTargetResolution)),
      roi: roi === null ? null : [...roi],
      roiFingerprint: fingerprintPreviewRoi(roi),
      semanticZoom,
      sourceHeight: sourceSize.height,
      sourceWidth: sourceSize.width,
    };
  }
}
