import type { BaseRenderSize } from '../hooks/viewport/useImageRenderSize';
import type { PreviewRoi } from './adaptivePreviewQuality';
import type { AdjustmentSnapshot } from './adjustmentSnapshots';
import type { AutoEditPreviewSession } from './autoEditTransaction';
import { resolveAutoEditRenderSnapshot } from './autoEditTransaction';
import type { BasicToneSliderInteraction } from './basicToneSliderInteraction';
import { resolveBasicToneSliderRenderSnapshot } from './basicToneSliderInteraction';
import { resolveEditorPreviewSource } from './editorImagePreviewSource';
import type { EditorZoomMode } from './editorZoom';
import { getEditorZoomDpr } from './editorZoom';
import type { InteractivePreviewScope } from './interactivePreviewPatch';
import {
  fingerprintPreviewGraphRevision,
  type PreviewSessionIdentity,
  type PreviewViewportTransformSnapshot,
  previewSessionIdentitySchema,
} from './previewCoordinator';
import { type PreviewViewportAuthoritySnapshot, PreviewViewportSnapshotController } from './previewViewportSnapshot';

export interface PreviewRequestScopeInput {
  adjustmentRevision: number;
  adjustmentSnapshot: AdjustmentSnapshot;
  autoEditPreviewSession: AutoEditPreviewSession | null;
  baseRenderSize: BaseRenderSize;
  basicToneSliderInteraction: BasicToneSliderInteraction | null;
  finalPreviewUrl: string | null;
  hasRenderedFirstFrame: boolean;
  imageSession: { id: string } | null;
  imageSessionId: number;
  previewViewportTransform: PreviewViewportTransformSnapshot;
  proofRevision: number;
  referenceMatchPreview: { proposalFingerprint: string } | null;
  selectedImage: { isReady: boolean; path: string; thumbnailUrl: string } | null;
  settings: {
    editorPreviewResolution?: number;
    enableZoomHifi?: boolean;
    highResZoomMultiplier?: number;
    useFullDpiRendering?: boolean;
    useWgpuRenderer?: boolean;
  } | null;
  zoomMode: EditorZoomMode;
}

export interface PreviewRequestScopeSnapshot {
  renderSnapshot: AdjustmentSnapshot;
  roi: PreviewRoi | null;
  scope: InteractivePreviewScope;
  session: PreviewSessionIdentity;
  viewport: PreviewViewportAuthoritySnapshot;
}

/** Captures one immutable, schema-validated request scope outside React closure/ref ownership. */
export class PreviewRequestScopeAdapter {
  private readonly getDisplayGeneration: () => number;
  private readonly viewport = new PreviewViewportSnapshotController();

  constructor({ getDisplayGeneration }: { getDisplayGeneration: () => number }) {
    this.getDisplayGeneration = getDisplayGeneration;
  }

  capture(
    input: PreviewRequestScopeInput,
    targetResolution: number,
    roi: PreviewRoi | null,
    devicePixelRatio: number,
  ): PreviewRequestScopeSnapshot | null {
    const selectedImage = input.selectedImage;
    if (selectedImage === null) return null;
    const sourceImagePath = selectedImage.path;
    const basicToneSnapshot = resolveBasicToneSliderRenderSnapshot(
      input.adjustmentSnapshot,
      input.basicToneSliderInteraction,
      input,
    );
    const renderSnapshot = resolveAutoEditRenderSnapshot(basicToneSnapshot, input.autoEditPreviewSession, {
      imageSessionId: input.imageSession?.id ?? null,
      path: sourceImagePath,
    });
    const autoEditPreviewActive = renderSnapshot !== basicToneSnapshot;
    const basicTonePreviewActive = basicToneSnapshot !== input.adjustmentSnapshot;
    const dpr = getEditorZoomDpr(devicePixelRatio);
    const normalizedTargetResolution = Math.max(1, Math.round(targetResolution));
    const viewport = this.viewport.snapshot({
      devicePixelRatio: dpr,
      geometryRevision: renderSnapshot.geometryRevision,
      layout: input.baseRenderSize,
      qualityPolicy: {
        editorPreviewResolution: input.settings?.editorPreviewResolution ?? 1920,
        enableZoomHifi: input.settings?.enableZoomHifi ?? true,
        highResZoomMultiplier: input.settings?.highResZoomMultiplier ?? 1,
        useFullDpiRendering: input.settings?.useFullDpiRendering ?? false,
      },
      roi,
      sourceImagePath,
      sourceRevision: input.imageSessionId,
      targetHeight: normalizedTargetResolution,
      targetWidth: normalizedTargetResolution,
      transform: input.previewViewportTransform,
      zoomMode: input.zoomMode,
    });
    const quantizedRoi = viewport.roi;
    const scope: InteractivePreviewScope = {
      adjustmentRevision: renderSnapshot.renderRevision,
      backend: input.settings?.useWgpuRenderer !== false && input.hasRenderedFirstFrame ? 'wgpu' : 'cpu',
      basePreviewUrl: resolveEditorPreviewSource({
        finalPreviewUrl: input.finalPreviewUrl,
        isReady: selectedImage.isReady,
        thumbnailUrl: selectedImage.thumbnailUrl,
      }),
      devicePixelRatio: dpr,
      geometryIdentity: renderSnapshot.geometryRevision,
      graphIdentity: fingerprintPreviewGraphRevision({
        adjustmentRevision: renderSnapshot.renderRevision,
        geometryRevision: renderSnapshot.geometryRevision,
        imageSessionId: input.imageSessionId,
        maskRevision: renderSnapshot.maskRevision,
        patchRevision: renderSnapshot.patchRevision,
        proofRevision: input.proofRevision,
        proposalFingerprint: basicTonePreviewActive
          ? (input.basicToneSliderInteraction?.interactionId ?? 'basic-tone-preview')
          : autoEditPreviewActive
            ? (input.autoEditPreviewSession?.previewIdentity ?? 'auto-edit-preview')
            : (input.referenceMatchPreview?.proposalFingerprint ?? 'committed'),
      }),
      imageSessionId: input.imageSessionId,
      maskRevision: renderSnapshot.maskRevision,
      patchRevision: renderSnapshot.patchRevision,
      proofRevision: input.proofRevision,
      roiH: quantizedRoi?.[3] ?? null,
      roiW: quantizedRoi?.[2] ?? null,
      roiX: quantizedRoi?.[0] ?? null,
      roiY: quantizedRoi?.[1] ?? null,
      sourceImagePath,
      targetResolution: normalizedTargetResolution,
      viewportIdentity: viewport.coordinator.revision,
    };
    const positive = (value: number): number => Math.max(1, Math.round(value));
    const session = previewSessionIdentitySchema.parse({
      adjustmentRevision: positive(scope.adjustmentRevision),
      backend: scope.backend,
      displayGeneration: positive(this.getDisplayGeneration()),
      geometryRevision: viewport.input.geometryRevision,
      graphRevision: scope.graphIdentity,
      imageSessionId: positive(scope.imageSessionId),
      maskRevision: positive(scope.maskRevision),
      patchRevision: positive(scope.patchRevision),
      proofRevision: positive(scope.proofRevision),
      roiFingerprint: viewport.coordinator.roiFingerprint,
      sourceImagePath: viewport.input.sourceImagePath,
      sourceRevision: viewport.input.sourceRevision,
      targetHeight: viewport.coordinator.targetHeight,
      targetWidth: viewport.coordinator.targetWidth,
      viewportRevision: viewport.coordinator.revision,
    });
    return { renderSnapshot, roi: quantizedRoi === null ? null : [...quantizedRoi], scope, session, viewport };
  }
}
