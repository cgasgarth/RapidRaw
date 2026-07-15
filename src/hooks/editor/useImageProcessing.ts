import { listen } from '@tauri-apps/api/event';
import { useCallback, useEffect, useMemo, useRef } from 'react';
import { Panel } from '../../components/ui/AppProperties';
import { ExportColorProfile, ExportRenderingIntent } from '../../components/ui/ExportImportProperties';
import { displayTargetChangePayloadSchema } from '../../schemas/tauriEventSchemas';
import { emptyTauriResponseSchema } from '../../schemas/tauriResponseSchemas';
import { type ExportSoftProofTransformState, useEditorStore } from '../../store/useEditorStore';
import { useSettingsStore } from '../../store/useSettingsStore';
import { useUIStore } from '../../store/useUIStore';
import { Invokes } from '../../tauri/commands';
import {
  getPreviewReadyPhase,
  type PreviewOperationClass,
  type PreviewQualityStatus,
  type PreviewRoi,
} from '../../utils/adaptivePreviewQuality';
import type { Adjustments } from '../../utils/adjustments';
import { resolveAutoEditRenderSnapshot } from '../../utils/autoEditTransaction';
import { resolveBasicToneSliderRenderSnapshot } from '../../utils/basicToneSliderInteraction';
import {
  EditedPreviewEffectRunner,
  type EditedPreviewExecutionContext,
  type ExecutedEditedPreview,
  type MaterializedEditedPreview,
} from '../../utils/editedPreviewEffectRunner';
import { resolveEditorPreviewSource } from '../../utils/editorImagePreviewSource';
import { getEditorZoomDpr, getEditorZoomSourceSize, resolveEditorZoom } from '../../utils/editorZoom';
import { globalImageCache } from '../../utils/ImageLRUCache';
import {
  decodeInteractivePreviewUrl,
  type InteractivePreviewScope,
  parseInteractivePreviewPatchPayload,
} from '../../utils/interactivePreviewPatch';
import { OriginalPreviewEffectRunner } from '../../utils/originalPreviewEffectRunner';
import {
  createPreviewQualityPolicy,
  fingerprintPreviewGraphRevision,
  fingerprintPreviewRoi,
  PreviewCoordinator,
  type PreviewCoordinatorEvent,
  type PreviewQualitySnapshot,
  type PreviewSessionIdentity,
  resolvePreviewViewportRoi,
} from '../../utils/previewCoordinator';
import { PreviewUrlReleaseAuthority } from '../../utils/previewUrlReleaseAuthority';
import {
  type PreviewViewportAuthoritySnapshot,
  PreviewViewportSnapshotController,
} from '../../utils/previewViewportSnapshot';
import { resolveReferenceMatchRenderAdjustments } from '../../utils/referenceMatch';
import { DISPLAY_TARGET_CHANGED_EVENT } from '../../utils/tauriEventNames';
import { invokeWithSchema } from '../../utils/tauriSchemaInvoke';

interface InteractivePreviewScopeSnapshot {
  roi: [number, number, number, number] | null;
  scope: InteractivePreviewScope;
  viewport: PreviewViewportAuthoritySnapshot;
}

type ParsedInteractivePatch = ReturnType<typeof parseInteractivePreviewPatchPayload>;
type ReadyInteractivePatch = Extract<ParsedInteractivePatch, { ok: true }>;
type MaterializedEditedPreviewValue =
  | { kind: 'empty' }
  | { kind: 'wgpu' }
  | { kind: 'limited'; reason: string }
  | { kind: 'patch'; patch: ReadyInteractivePatch; url: string }
  | { kind: 'full'; transform: ExportSoftProofTransformState | null; url: string };

const previewNow = (): number => globalThis.performance?.now() ?? Date.now();

export function useImageProcessing() {
  const selectedImage = useEditorStore((state) => state.selectedImage);
  const committedAdjustments = useEditorStore((state) => state.adjustments);
  const referenceMatchPreview = useEditorStore((state) => state.referenceMatchPreview);
  const autoEditPreviewSession = useEditorStore((state) => state.autoEditPreviewSession);
  const isWaveformVisible = useEditorStore((state) => state.isWaveformVisible);
  const activeWaveformChannel = useEditorStore((state) => state.activeWaveformChannel);
  const displaySize = useEditorStore((state) => state.displaySize);
  const baseRenderSize = useEditorStore((state) => state.baseRenderSize);
  const previewViewportTransform = useEditorStore((state) => state.previewViewportTransform);
  const originalSize = useEditorStore((state) => state.originalSize);
  const adjustmentSnapshot = useEditorStore((state) => state.adjustmentSnapshot);
  const committedAdjustmentRevision = useEditorStore((state) => state.adjustmentRevision);
  const basicToneSliderInteraction = useEditorStore((state) => state.basicToneSliderInteraction);
  const editorImageSession = useEditorStore((state) => state.imageSession);
  const imageSessionId = useEditorStore((state) => state.imageSessionId);
  const basicToneRenderSnapshot = resolveBasicToneSliderRenderSnapshot(adjustmentSnapshot, basicToneSliderInteraction, {
    adjustmentRevision: committedAdjustmentRevision,
    imageSession: editorImageSession,
    imageSessionId,
    selectedImage,
  });
  const renderAdjustmentSnapshot = resolveAutoEditRenderSnapshot(basicToneRenderSnapshot, autoEditPreviewSession, {
    imageSessionId: editorImageSession?.id ?? null,
    path: selectedImage?.path ?? null,
  });
  const referenceMatchAdjustments = resolveReferenceMatchRenderAdjustments({
    adjustmentRevision: adjustmentSnapshot.adjustmentRevision,
    committed: committedAdjustments,
    preview: referenceMatchPreview,
    targetPath: selectedImage?.path ?? null,
  });
  const adjustments =
    renderAdjustmentSnapshot === adjustmentSnapshot
      ? referenceMatchAdjustments
      : (renderAdjustmentSnapshot.value as Adjustments);
  const compare = useEditorStore((state) => state.compare);
  const isSliderDragging = useEditorStore((state) => state.isSliderDragging);
  const isExportSoftProofEnabled = useEditorStore((state) => state.isExportSoftProofEnabled);
  const exportSoftProofRecipeId = useEditorStore((state) => state.exportSoftProofRecipeId);
  const transformedOriginalUrl = useEditorStore((state) => state.transformedOriginalUrl);
  const setEditor = useEditorStore((state) => state.setEditor);
  const isCompareActive = compare.mode !== 'off' || compare.isOriginalHeld;

  const activeRightPanel = useUIStore((state) => state.activeRightPanel);
  const appSettings = useSettingsStore((state) => state.appSettings);
  const selectedProofRecipe = useMemo(
    () =>
      isExportSoftProofEnabled
        ? (appSettings?.exportPresets ?? []).find((preset) => preset.id === exportSoftProofRecipeId)
        : undefined,
    [appSettings?.exportPresets, exportSoftProofRecipeId, isExportSoftProofEnabled],
  );
  const interactiveScopeRef = useRef<
    (targetRes: number, roi: PreviewRoi | null) => InteractivePreviewScopeSnapshot | null
  >(() => null);
  const previewQualityControllerRef = useRef(createPreviewQualityPolicy());
  const previewViewportControllerRef = useRef<PreviewViewportSnapshotController | null>(null);
  const previewViewportController = previewViewportControllerRef.current ?? new PreviewViewportSnapshotController();
  previewViewportControllerRef.current = previewViewportController;
  const previewCoordinatorRef = useRef<PreviewCoordinator | null>(null);
  const previewCoordinator = previewCoordinatorRef.current ?? new PreviewCoordinator();
  previewCoordinatorRef.current = previewCoordinator;
  const previewUrlReleaseAuthorityRef = useRef<PreviewUrlReleaseAuthority | null>(null);
  const previewUrlReleaseAuthority =
    previewUrlReleaseAuthorityRef.current ??
    new PreviewUrlReleaseAuthority({ isProtected: (url) => globalImageCache.isProtected(url) });
  previewUrlReleaseAuthorityRef.current = previewUrlReleaseAuthority;
  const editedPreviewRunnerRef = useRef<EditedPreviewEffectRunner<MaterializedEditedPreviewValue> | null>(null);
  const originalPreviewRunnerRef = useRef<OriginalPreviewEffectRunner | null>(null);

  const dispatchPreviewCoordinator = useCallback(
    (event: PreviewCoordinatorEvent) => {
      const previous = previewCoordinator.snapshot();
      const transition = previewCoordinator.dispatch(event);
      editedPreviewRunnerRef.current?.consume(transition.effects);
      originalPreviewRunnerRef.current?.consume(transition.effects);
      for (const effect of transition.effects) {
        if (effect.type !== 'publish') continue;
        if (effect.identity.kind === 'settled') {
          setEditor({ finalPreviewUrl: effect.artifact.url, presentedPreviewArtifact: effect.artifact });
        } else if (effect.identity.kind === 'interactive') {
          setEditor({ presentedPreviewArtifact: effect.artifact });
        } else if (effect.identity.kind === 'original') {
          setEditor({ transformedOriginalUrl: effect.artifact.url });
        }
      }
      previewUrlReleaseAuthority.consume(previous, transition);
      return transition;
    },
    [previewCoordinator, previewUrlReleaseAuthority, setEditor],
  );

  const originalPreviewRunner =
    originalPreviewRunnerRef.current ??
    new OriginalPreviewEffectRunner({
      dispatch: dispatchPreviewCoordinator,
      onCurrentFailure: (error) => {
        console.error('Failed to generate original preview:', error);
        useEditorStore.getState().dispatchCompare({ type: 'exit' });
      },
    });
  originalPreviewRunnerRef.current = originalPreviewRunner;

  const materializeEditedPreview = useCallback(
    async (
      result: ExecutedEditedPreview,
      context: EditedPreviewExecutionContext,
    ): Promise<MaterializedEditedPreview<MaterializedEditedPreviewValue>> => {
      const { buffer, transform } = result;
      if (buffer.byteLength === 0) return { value: { kind: 'empty' } };
      const prefix = new TextDecoder().decode(buffer.slice(0, 11));
      if (prefix === 'WGPU_RENDER') return { value: { kind: 'wgpu' } };

      const positioned = context.request.kind === 'interactive' || context.request.roi !== null;
      const patch = positioned ? parseInteractivePreviewPatchPayload(buffer) : null;
      if (patch !== null && !patch.ok) return { value: { kind: 'limited', reason: patch.reason } };

      const blob = new Blob([patch?.ok ? patch.imageBuffer : buffer], { type: 'image/jpeg' });
      const url = URL.createObjectURL(blob);
      const decodeStartedAt = previewNow();
      try {
        await decodeInteractivePreviewUrl(url);
      } catch (error) {
        previewUrlReleaseAuthority.release(url);
        throw error;
      }
      const decodeMs = Math.max(0, previewNow() - decodeStartedAt);
      return patch?.ok
        ? { decodeMs, value: { kind: 'patch', patch, url } }
        : { artifactUrl: url, decodeMs, value: { kind: 'full', transform, url } };
    },
    [previewUrlReleaseAuthority],
  );

  const onEditedPreviewPresented = useCallback(
    (
      result: MaterializedEditedPreview<MaterializedEditedPreviewValue>,
      context: EditedPreviewExecutionContext,
    ): void => {
      const { interactiveIdentity, quality, scopeRecovery, targetResolution } = context.request;
      const requestId = context.identity.operationId;
      const commitStartedAt = previewNow();
      const recordTiming = (): void => {
        previewQualityControllerRef.current.record({
          commitMs: Math.max(0, previewNow() - commitStartedAt),
          decodeMs: result.decodeMs ?? 0,
          displayedAgeMs: Math.max(0, previewNow() - context.request.createdAt),
          inputToDispatchMs: context.inputToDispatchMs,
          renderMs: context.renderMs,
          tier: quality.tier,
        });
      };
      const readyStatus: PreviewQualityStatus = {
        ...quality,
        generation: interactiveIdentity.generation,
        phase: getPreviewReadyPhase(quality),
        requestId,
      };
      const value = result.value;
      if (value.kind === 'empty' || value.kind === 'limited') {
        setEditor({
          previewQualityStatus: {
            ...quality,
            generation: interactiveIdentity.generation,
            limitedBy: 'backend',
            phase: 'degraded_limited',
            reason: value.kind === 'empty' ? 'empty_render_buffer' : value.reason,
            requestId,
            sufficientForSemanticZoom: false,
          },
        });
        recordTiming();
        return;
      }
      if (value.kind === 'wgpu') {
        setEditor({
          interactivePatch: null,
          previewQualityStatus: readyStatus,
          ...(context.request.kind === 'settled' ? { renderedPreviewResolution: targetResolution } : {}),
        });
        recordTiming();
        return;
      }
      if (value.kind === 'patch') {
        setEditor({
          interactivePatch: {
            basePreviewUrl: interactiveIdentity.basePreviewUrl,
            fullHeight: value.patch.fullHeight,
            fullWidth: value.patch.fullWidth,
            geometryIdentity: interactiveIdentity.geometryIdentity,
            normH: value.patch.normH,
            normW: value.patch.normW,
            normX: value.patch.normX,
            normY: value.patch.normY,
            pixelHeight: value.patch.pixelHeight,
            pixelWidth: value.patch.pixelWidth,
            sourceImagePath: interactiveIdentity.sourceImagePath,
            url: value.url,
          },
          previewQualityStatus: readyStatus,
          ...(context.request.kind === 'settled' ? { renderedPreviewResolution: targetResolution } : {}),
        });
        recordTiming();
        return;
      }

      const completedScopeStatus = useEditorStore.getState().previewScopeStatus;
      const transform = value.transform;
      setEditor({
        exportSoftProofTransform: transform,
        interactivePatch: null,
        navigatorPreviewArtifact: {
          graphIdentity: interactiveIdentity.graphIdentity,
          id: `${interactiveIdentity.graphIdentity}:${String(interactiveIdentity.generation)}:${String(requestId)}`,
          imageSessionId: useEditorStore.getState().imageSession?.id ?? String(interactiveIdentity.imageSessionId),
          url: value.url,
        },
        previewScopeStatus:
          transform &&
          completedScopeStatus?.path === interactiveIdentity.sourceImagePath &&
          completedScopeStatus.histogramReady &&
          completedScopeStatus.waveformReady
            ? {
                ...completedScopeStatus,
                displayTransformLabel: transform.colorManagedTransform ?? 'Display preview transform',
                exportProfileLabel: transform.effectiveColorProfile,
                exportRenderingIntentLabel: transform.effectiveRenderingIntent,
                renderBasis: 'export_preview',
                softProofTransformApplied: transform.transformApplied === true,
                sourceLabel: 'Export preview',
                warningCodes: [
                  transform.transformApplied ? 'export_profile_transform_applied' : 'export_profile_transform_missing',
                  'render_target_matches_export_recipe',
                ],
              }
            : completedScopeStatus,
        previewQualityStatus: readyStatus,
        renderedPreviewResolution: targetResolution,
      });
      if (scopeRecovery) setEditor({ previewScopeRecoveryError: null });
      recordTiming();
    },
    [setEditor],
  );

  const editedPreviewRunner =
    editedPreviewRunnerRef.current ??
    new EditedPreviewEffectRunner<MaterializedEditedPreviewValue>({
      dispatch: dispatchPreviewCoordinator,
      getPatchResidency: () => useEditorStore.getState().patchResidency.snapshot(),
      markPatchesResident: (sessionId, patchIds) => {
        useEditorStore.getState().patchResidency.markResident(sessionId, patchIds);
      },
      materialize: materializeEditedPreview,
      onCurrentFailure: (error, context) => {
        const expectedSupersession = String(error).includes('preview_superseded');
        if (!expectedSupersession) console.error('Failed to apply adjustments:', error);
        if (expectedSupersession) return;
        const { interactiveIdentity, quality, scopeRecovery } = context.request;
        setEditor({
          previewQualityStatus: {
            ...quality,
            generation: interactiveIdentity.generation,
            limitedBy: 'error',
            phase: 'degraded_limited',
            reason: 'render_error',
            requestId: context.identity.operationId,
            sufficientForSemanticZoom: false,
          },
          ...(scopeRecovery
            ? {
                previewScopeRecoveryError: error instanceof Error ? error.message : String(error),
                previewScopeRecoveryState: 'error' as const,
              }
            : {}),
        });
      },
      onPresented: onEditedPreviewPresented,
      releaseMaterialized: (result) => {
        if (result.value.kind === 'patch' || result.value.kind === 'full') {
          previewUrlReleaseAuthority.release(result.value.url);
        }
      },
    });
  editedPreviewRunnerRef.current = editedPreviewRunner;

  const previewSessionIdentity = useCallback(
    (scope: InteractivePreviewScope, viewport: PreviewViewportAuthoritySnapshot): PreviewSessionIdentity => {
      const positive = (value: number): number => Math.max(1, Math.round(value));
      return {
        adjustmentRevision: positive(scope.adjustmentRevision),
        backend: scope.backend,
        displayGeneration: positive(previewCoordinator.snapshot().displayGeneration),
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
      };
    },
    [previewCoordinator],
  );

  const calculateROI = useCallback((): PreviewRoi | null => {
    const roi = resolvePreviewViewportRoi(baseRenderSize, previewViewportTransform);
    return roi === null ? null : [...roi];
  }, [baseRenderSize, previewViewportTransform]);

  interactiveScopeRef.current = (targetRes, roi) => {
    const editor = useEditorStore.getState();
    const settings = useSettingsStore.getState().appSettings;
    const selectedImage = editor.selectedImage;
    if (!selectedImage) return null;
    const sourceImagePath = selectedImage.path;
    const basicToneScopeSnapshot = resolveBasicToneSliderRenderSnapshot(
      editor.adjustmentSnapshot,
      editor.basicToneSliderInteraction,
      editor,
    );
    const scopeAdjustmentSnapshot = resolveAutoEditRenderSnapshot(
      basicToneScopeSnapshot,
      editor.autoEditPreviewSession,
      { imageSessionId: editor.imageSession?.id ?? null, path: sourceImagePath },
    );
    const autoEditPreviewActive = scopeAdjustmentSnapshot !== basicToneScopeSnapshot;
    const basicTonePreviewActive = basicToneScopeSnapshot !== editor.adjustmentSnapshot;

    const dpr = getEditorZoomDpr(typeof window === 'undefined' ? 1 : window.devicePixelRatio);
    const normalizedTargetRes = Math.max(1, Math.round(targetRes));
    const viewport = previewViewportController.snapshot({
      devicePixelRatio: dpr,
      geometryRevision: scopeAdjustmentSnapshot.geometryRevision,
      layout: editor.baseRenderSize,
      qualityPolicy: {
        editorPreviewResolution: settings?.editorPreviewResolution ?? 1920,
        enableZoomHifi: settings?.enableZoomHifi ?? true,
        highResZoomMultiplier: settings?.highResZoomMultiplier ?? 1,
        useFullDpiRendering: settings?.useFullDpiRendering ?? false,
      },
      roi,
      sourceImagePath,
      sourceRevision: editor.imageSessionId,
      targetHeight: normalizedTargetRes,
      targetWidth: normalizedTargetRes,
      transform: editor.previewViewportTransform,
      zoomMode: editor.zoomMode,
    });
    const quantizedRoi = viewport.roi;
    return {
      roi: quantizedRoi === null ? null : [...quantizedRoi],
      scope: {
        backend: settings?.useWgpuRenderer !== false && editor.hasRenderedFirstFrame ? 'wgpu' : 'cpu',
        basePreviewUrl: resolveEditorPreviewSource({
          finalPreviewUrl: editor.finalPreviewUrl,
          isReady: selectedImage.isReady,
          thumbnailUrl: selectedImage.thumbnailUrl,
        }),
        devicePixelRatio: dpr,
        adjustmentRevision: scopeAdjustmentSnapshot.adjustmentRevision,
        geometryIdentity: scopeAdjustmentSnapshot.geometryRevision,
        graphIdentity: fingerprintPreviewGraphRevision({
          adjustmentRevision: scopeAdjustmentSnapshot.adjustmentRevision,
          geometryRevision: scopeAdjustmentSnapshot.geometryRevision,
          imageSessionId: editor.imageSessionId,
          maskRevision: scopeAdjustmentSnapshot.maskRevision,
          patchRevision: scopeAdjustmentSnapshot.patchRevision,
          proofRevision: editor.proofRevision,
          proposalFingerprint: basicTonePreviewActive
            ? (editor.basicToneSliderInteraction?.interactionId ?? 'basic-tone-preview')
            : autoEditPreviewActive
              ? (editor.autoEditPreviewSession?.previewIdentity ?? 'auto-edit-preview')
              : (editor.referenceMatchPreview?.proposalFingerprint ?? 'committed'),
        }),
        imageSessionId: editor.imageSessionId,
        maskRevision: scopeAdjustmentSnapshot.maskRevision,
        patchRevision: scopeAdjustmentSnapshot.patchRevision,
        proofRevision: editor.proofRevision,
        roiX: quantizedRoi?.[0] ?? null,
        roiY: quantizedRoi?.[1] ?? null,
        roiW: quantizedRoi?.[2] ?? null,
        roiH: quantizedRoi?.[3] ?? null,
        sourceImagePath,
        targetResolution: normalizedTargetRes,
        viewportIdentity: viewport.coordinator.revision,
      },
      viewport,
    };
  };

  const resolveQualityDecision = useCallback(
    (requestedTargetResolution: number, interacting: boolean) => {
      const editor = useEditorStore.getState();
      const settings = useSettingsStore.getState().appSettings;
      const sourceSize = getEditorZoomSourceSize({
        crop: editor.adjustments.crop,
        orientationSteps: editor.adjustments.orientationSteps,
        originalSize: editor.originalSize,
      });
      const backend = settings?.useWgpuRenderer !== false && editor.hasRenderedFirstFrame ? 'wgpu' : 'cpu';
      const operationClass: PreviewOperationClass =
        activeRightPanel === Panel.Crop
          ? 'geometry'
          : activeRightPanel === Panel.Masks || editor.adjustments.masks.length > 0
            ? 'mask'
            : 'standard';
      const semanticZoom =
        editor.zoomMode.kind === 'fit'
          ? 'fit'
          : editor.zoomMode.kind === 'ratio' && editor.zoomMode.devicePixelsPerImagePixel >= 1
            ? 'inspection'
            : 'viewport';
      if (interacting) previewQualityControllerRef.current.noteInput(previewNow());
      return previewQualityControllerRef.current.decide({
        backend,
        devicePixelRatio: typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1,
        interacting,
        operationClass,
        requestedTargetResolution,
        semanticZoom,
        sourceHeight: sourceSize.height,
        sourceWidth: sourceSize.width,
        visibleRoi: calculateROI(),
      });
    },
    [activeRightPanel, calculateROI],
  );

  useEffect(
    () => () => {
      dispatchPreviewCoordinator({ reason: 'editor-unmounted', type: 'cancel-session' });
      editedPreviewRunner.cancel();
      originalPreviewRunner.dispose();
    },
    [dispatchPreviewCoordinator, editedPreviewRunner, originalPreviewRunner],
  );

  useEffect(() => {
    if (!selectedImage?.isReady) {
      dispatchPreviewCoordinator({ reason: 'image-not-ready', type: 'cancel-session' });
      return;
    }
    const scopeSnapshot = interactiveScopeRef.current(appSettings?.editorPreviewResolution ?? 1920, null);
    if (scopeSnapshot === null) return;
    dispatchPreviewCoordinator({
      session: previewSessionIdentity(scopeSnapshot.scope, scopeSnapshot.viewport),
      type: 'image-session-installed',
    });
  }, [
    appSettings?.editorPreviewResolution,
    dispatchPreviewCoordinator,
    previewSessionIdentity,
    selectedImage?.path,
    selectedImage?.isReady,
    imageSessionId,
  ]);

  useEffect(() => {
    previewQualityControllerRef.current.reset();
  }, [selectedImage?.path]);

  const applyAdjustments = useCallback(
    (
      _currentAdjustments: Adjustments,
      dragging: boolean = false,
      targetRes?: number,
      scopeRecovery = false,
      delayMs = 0,
    ) => {
      if (!selectedImage?.isReady) return;

      const requestedTargetRes = Math.max(1, Math.round(targetRes ?? appSettings?.editorPreviewResolution ?? 1920));
      const quality = resolveQualityDecision(requestedTargetRes, dragging);
      const qualitySnapshot: PreviewQualitySnapshot = {
        effectiveTargetResolution: quality.effectiveTargetResolution,
        interacting: dragging,
        reason: quality.reason,
        requestedTargetResolution: quality.requestedTargetResolution,
        roiFingerprint: fingerprintPreviewRoi(quality.effectiveRoi),
        sufficientForSemanticZoom: quality.sufficientForSemanticZoom,
        tier: quality.tier,
      };
      dispatchPreviewCoordinator({ quality: qualitySnapshot, type: 'quality-decision-changed' });
      const normalizedTargetRes = quality.effectiveTargetResolution;
      const scopeSnapshot = interactiveScopeRef.current(normalizedTargetRes, quality.effectiveRoi);
      if (scopeSnapshot === null) return;
      const session = previewSessionIdentity(scopeSnapshot.scope, scopeSnapshot.viewport);
      dispatchPreviewCoordinator({ session, type: 'image-session-installed' });
      const identity = editedPreviewRunner.request(
        {
          activeWaveformChannel,
          computeWaveform: isWaveformVisible || scopeRecovery,
          createdAt: previewNow(),
          kind: dragging ? 'interactive' : 'settled',
          proof:
            !dragging && selectedProofRecipe
              ? {
                  blackPointCompensation: selectedProofRecipe.blackPointCompensation ?? false,
                  colorProfile: selectedProofRecipe.colorProfile ?? ExportColorProfile.Srgb,
                  exportSoftProofRecipeId: selectedProofRecipe.id,
                  renderingIntent: selectedProofRecipe.renderingIntent ?? ExportRenderingIntent.RelativeColorimetric,
                }
              : null,
          quality,
          roi: scopeSnapshot.roi,
          scopeRecovery,
          session,
          snapshot: renderAdjustmentSnapshot,
          targetResolution: normalizedTargetRes,
          viewerScope: scopeSnapshot.scope,
          viewportAuthority: scopeSnapshot.viewport,
        },
        delayMs,
      );
      setEditor({
        ...(!dragging ? { requestedPreviewResolution: quality.requestedTargetResolution } : {}),
        previewQualityStatus: {
          ...quality,
          generation: identity.generation,
          phase: dragging ? 'rendering_interaction' : 'refining_current_view',
          requestId: identity.operationId,
        },
      });
    },
    [
      activeWaveformChannel,
      appSettings?.editorPreviewResolution,
      dispatchPreviewCoordinator,
      editedPreviewRunner,
      isWaveformVisible,
      resolveQualityDecision,
      renderAdjustmentSnapshot,
      selectedProofRecipe,
      previewSessionIdentity,
      selectedImage?.isReady,
      setEditor,
    ],
  );
  const applyAdjustmentsRef = useRef(applyAdjustments);
  applyAdjustmentsRef.current = applyAdjustments;

  const previewScopeRecoveryRequestId = useEditorStore((state) => state.previewScopeRecoveryRequestId);
  const handledScopeRecoveryRequestIdRef = useRef(previewScopeRecoveryRequestId);
  useEffect(() => {
    if (previewScopeRecoveryRequestId === handledScopeRecoveryRequestIdRef.current) return;
    handledScopeRecoveryRequestIdRef.current = previewScopeRecoveryRequestId;
    applyAdjustments(adjustments, false, undefined, true);
  }, [adjustments, applyAdjustments, previewScopeRecoveryRequestId]);

  useEffect(() => {
    let active = true;
    let unlisten: (() => void) | undefined;
    void listen<unknown>(DISPLAY_TARGET_CHANGED_EVENT, (event) => {
      if (!active) return;
      const parsed = displayTargetChangePayloadSchema.safeParse(event.payload);
      if (!parsed.success) return;
      const transition = dispatchPreviewCoordinator({
        generation: parsed.data.displayResourceGeneration,
        type: 'display-generation-changed',
      });
      if (transition.state.lastTransition?.reason !== 'display-generation-changed') return;
      applyAdjustments(useEditorStore.getState().adjustments, false);
    }).then((stop) => {
      if (active) unlisten = stop;
      else stop();
    });
    return () => {
      active = false;
      unlisten?.();
    };
  }, [applyAdjustments, dispatchPreviewCoordinator]);

  const generateUncroppedPreview = useCallback(
    (currentAdjustments: Adjustments) => {
      if (!selectedImage?.isReady) return;
      invokeWithSchema(
        Invokes.GenerateUncroppedPreview,
        { jsAdjustments: currentAdjustments },
        emptyTauriResponseSchema,
      ).catch((err: unknown) => {
        console.error('Failed to generate uncropped preview:', err);
      });
    },
    [selectedImage?.isReady],
  );

  const calculateTargetRes = useCallback(() => {
    const baseTargetRes = appSettings?.editorPreviewResolution || 1920;
    if (!(appSettings?.enableZoomHifi ?? true) || baseRenderSize.width === 0) {
      return baseTargetRes;
    }

    const sharpnessFactor = 1.25;
    const zoomMultiplier = appSettings?.highResZoomMultiplier || 1.0;
    const sourceSize = getEditorZoomSourceSize({
      crop: adjustments.crop,
      orientationSteps: adjustments.orientationSteps,
      originalSize,
    });
    const resolvedZoom = resolveEditorZoom({
      devicePixelRatio: getEditorZoomDpr(typeof window === 'undefined' ? 1 : window.devicePixelRatio),
      mode: useEditorStore.getState().zoomMode,
      renderSize: {
        height: baseRenderSize.height,
        scale: baseRenderSize.width / Math.max(sourceSize.width, 1),
        width: baseRenderSize.width,
      },
      sourceSize,
      viewportSize: { height: baseRenderSize.containerHeight, width: baseRenderSize.containerWidth },
    });

    let targetRes = Math.max(baseTargetRes, resolvedZoom.requiredPreviewResolution * sharpnessFactor * zoomMultiplier);
    targetRes = Math.max(targetRes, 512);

    if (originalSize.width > 0 && originalSize.height > 0) {
      const origMax = Math.max(originalSize.width, originalSize.height);
      targetRes = Math.min(targetRes, origMax);
      if (targetRes >= origMax * 0.8) {
        targetRes = origMax;
      }
    }

    if (targetRes !== Math.max(originalSize.width, originalSize.height)) {
      targetRes = Math.ceil(targetRes / 256) * 256;
    }

    return Math.round(targetRes);
  }, [
    appSettings?.enableZoomHifi,
    appSettings?.editorPreviewResolution,
    appSettings?.highResZoomMultiplier,
    adjustments.crop,
    adjustments.orientationSteps,
    baseRenderSize,
    originalSize,
  ]);
  const calculatedTargetResolution = calculateTargetRes();
  const calculatedRoiFingerprint = fingerprintPreviewRoi(calculateROI());

  const requestOriginalPreview = useCallback(
    (targetRes: number, delayMs: number): void => {
      const scopeSnapshot = interactiveScopeRef.current(targetRes, null);
      if (scopeSnapshot === null) return;
      const session = previewSessionIdentity(scopeSnapshot.scope, scopeSnapshot.viewport);
      dispatchPreviewCoordinator({ type: 'viewport-changed', viewport: scopeSnapshot.viewport.coordinator });
      if (!originalPreviewRunner.needsRequest(session, targetRes)) return;
      originalPreviewRunner.request(
        session,
        {
          expectedImagePath: session.sourceImagePath,
          jsAdjustments: structuredClone(adjustments),
          targetResolution: targetRes,
          viewerSampleGraphRevision: session.graphRevision,
        },
        delayMs,
      );
    },
    [adjustments, originalPreviewRunner, previewSessionIdentity],
  );

  useEffect(() => {
    if (activeRightPanel === Panel.Crop && selectedImage?.isReady) {
      generateUncroppedPreview(adjustments);
    }
  }, [adjustments, activeRightPanel, selectedImage?.isReady, generateUncroppedPreview]);

  useEffect(() => {
    if (!selectedImage?.isReady) return;
    if (isSliderDragging) {
      if (appSettings?.enableLivePreviews !== false)
        applyAdjustmentsRef.current(adjustments, true, calculatedTargetResolution);
      return;
    }
    applyAdjustmentsRef.current(adjustments, false, calculatedTargetResolution, false, 50);
  }, [
    adjustments,
    selectedImage?.path,
    selectedImage?.isReady,
    isSliderDragging,
    calculatedTargetResolution,
    calculatedRoiFingerprint,
    appSettings?.enableLivePreviews,
  ]);

  useEffect(() => {
    originalPreviewRunner.cancel('original-identity-changed');
    setEditor({ transformedOriginalUrl: null });
  }, [adjustmentSnapshot.geometryRevision, originalPreviewRunner, selectedImage?.path, setEditor]);

  useEffect(() => {
    if (isCompareActive) return;
    originalPreviewRunner.cancel('compare-disabled');
    setEditor({ transformedOriginalUrl: null });
  }, [isCompareActive, originalPreviewRunner, setEditor]);

  useEffect(() => {
    if (isCompareActive && selectedImage?.isReady && displaySize.width > 0 && !isSliderDragging) {
      const targetRes = calculateTargetRes();
      requestOriginalPreview(targetRes, transformedOriginalUrl ? 200 : 0);
    }
  }, [
    isCompareActive,
    displaySize.width,
    displaySize.height,
    calculateTargetRes,
    selectedImage?.isReady,
    isSliderDragging,
    requestOriginalPreview,
    transformedOriginalUrl,
    originalSize,
  ]);

  return {
    applyAdjustments,
  };
}
