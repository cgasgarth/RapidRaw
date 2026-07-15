import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Panel } from '../../components/ui/AppProperties';
import { emptyTauriResponseSchema } from '../../schemas/tauriResponseSchemas';
import { useEditorStore } from '../../store/useEditorStore';
import { useSettingsStore } from '../../store/useSettingsStore';
import { useUIStore } from '../../store/useUIStore';
import { Invokes } from '../../tauri/commands';
import type { PreviewOperationClass, PreviewRoi } from '../../utils/adaptivePreviewQuality';
import type { Adjustments } from '../../utils/adjustments';
import { resolveAutoEditRenderSnapshot } from '../../utils/autoEditTransaction';
import { resolveBasicToneSliderRenderSnapshot } from '../../utils/basicToneSliderInteraction';
import { EditedPreviewEffectRunner } from '../../utils/editedPreviewEffectRunner';
import { getEditorZoomDpr } from '../../utils/editorZoom';
import { globalImageCache } from '../../utils/ImageLRUCache';
import { PreviewAnalyticsEffectRunner } from '../../utils/previewAnalyticsEffectRunner';
import { PreviewCoordinatorRuntime } from '../../utils/previewCoordinatorRuntime';
import { PreviewFailureAdapter } from '../../utils/previewFailureAdapter';
import { PreviewInteractionSchedulingEffectRunner } from '../../utils/previewInteractionSchedulingEffectRunner';
import { PreviewInvalidationEffectRunner } from '../../utils/previewInvalidationEffectRunner';
import { PreviewMaterializationAdapter } from '../../utils/previewMaterializationAdapter';
import { PreviewOriginalCompareAdapter } from '../../utils/previewOriginalCompareAdapter';
import { PreviewPresentationAdapter, type PreviewPresentationValue } from '../../utils/previewPresentationAdapter';
import { PreviewRequestIntentAdapter } from '../../utils/previewRequestIntentAdapter';
import { PreviewRequestScopeAdapter } from '../../utils/previewRequestScopeAdapter';
import { PreviewViewportQualityController } from '../../utils/previewViewportQualityController';
import { resolveReferenceMatchRenderAdjustments } from '../../utils/referenceMatch';
import { invokeWithSchema } from '../../utils/tauriSchemaInvoke';

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
  const zoomMode = useEditorStore((state) => state.zoomMode);
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
  const previewScopeRecoveryRequestId = useEditorStore((state) => state.previewScopeRecoveryRequestId);
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
  const previewQualityControllerRef = useRef<PreviewViewportQualityController | null>(null);
  const previewQualityController =
    previewQualityControllerRef.current ?? new PreviewViewportQualityController(previewNow);
  previewQualityControllerRef.current = previewQualityController;
  const [devicePixelRatio, setDevicePixelRatio] = useState(() =>
    getEditorZoomDpr(typeof window === 'undefined' ? 1 : window.devicePixelRatio),
  );
  const [analyticsListenerReady, setAnalyticsListenerReady] = useState(false);
  const previewRuntimeRef = useRef<PreviewCoordinatorRuntime | null>(null);
  const previewRuntime =
    previewRuntimeRef.current ??
    new PreviewCoordinatorRuntime({
      isUrlProtected: (url) => globalImageCache.isProtected(url),
      publishSurface: (update) => useEditorStore.getState().setEditor(update),
    });
  previewRuntimeRef.current = previewRuntime;
  const previewRequestScopeAdapterRef = useRef<PreviewRequestScopeAdapter | null>(null);
  const previewRequestScopeAdapter =
    previewRequestScopeAdapterRef.current ??
    new PreviewRequestScopeAdapter({
      getDisplayGeneration: () => previewRuntime.snapshot().displayGeneration,
    });
  previewRequestScopeAdapterRef.current = previewRequestScopeAdapter;
  const editedPreviewRunnerRef = useRef<EditedPreviewEffectRunner<PreviewPresentationValue> | null>(null);
  const originalPreviewAdapterRef = useRef<PreviewOriginalCompareAdapter | null>(null);
  const dispatchPreviewCoordinator = previewRuntime.dispatch;
  const previewAnalyticsRunner = useMemo(
    () =>
      new PreviewAnalyticsEffectRunner({
        dispatch: dispatchPreviewCoordinator,
        getPresentationState: () => {
          const editor = useEditorStore.getState();
          return {
            exportSoftProofTransform: editor.exportSoftProofTransform,
            isExportSoftProofEnabled: editor.isExportSoftProofEnabled,
            selectedImagePath: editor.selectedImage?.path ?? null,
          };
        },
        publish: setEditor,
      }),
    [dispatchPreviewCoordinator, setEditor],
  );
  const previewInvalidationRunner = useMemo(
    () =>
      new PreviewInvalidationEffectRunner({
        dispatch: dispatchPreviewCoordinator,
        getState: () => previewRuntime.snapshot(),
      }),
    [dispatchPreviewCoordinator, previewRuntime],
  );
  const previewPresentationAdapter = useMemo(
    () =>
      new PreviewPresentationAdapter({
        getCoordinatorState: () => previewRuntime.snapshot(),
        getPresentationState: () => {
          const editor = useEditorStore.getState();
          return {
            imageSessionId: editor.imageSession?.id ?? null,
            previewScopeStatus: editor.previewScopeStatus,
          };
        },
        publish: setEditor,
        recordTiming: (sample) => previewQualityController.record(sample),
      }),
    [previewQualityController, previewRuntime, setEditor],
  );
  const previewMaterializationAdapter = useMemo(
    () =>
      new PreviewMaterializationAdapter({
        releaseUrl: (url) => previewRuntime.releaseUnpresentedUrl(url),
      }),
    [previewRuntime],
  );
  const previewFailureAdapter = useMemo(
    () =>
      new PreviewFailureAdapter({
        getCoordinatorState: () => previewRuntime.snapshot(),
        publish: setEditor,
      }),
    [previewRuntime, setEditor],
  );

  const originalPreviewAdapter =
    originalPreviewAdapterRef.current ??
    new PreviewOriginalCompareAdapter({
      dispatch: dispatchPreviewCoordinator,
      onCurrentFailure: (error) => {
        console.error('Failed to generate original preview:', error);
        useEditorStore.getState().dispatchCompare({ type: 'exit' });
      },
    });
  originalPreviewAdapterRef.current = originalPreviewAdapter;

  const editedPreviewRunner =
    editedPreviewRunnerRef.current ??
    new EditedPreviewEffectRunner<PreviewPresentationValue>({
      dispatch: dispatchPreviewCoordinator,
      getPatchResidency: () => useEditorStore.getState().patchResidency.snapshot(),
      markPatchesResident: (sessionId, patchIds) => {
        useEditorStore.getState().patchResidency.markResident(sessionId, patchIds);
      },
      materialize: (result, context) =>
        previewMaterializationAdapter.materialize(result, {
          kind: context.request.kind,
          roi: context.request.roi,
        }),
      onCurrentFailure: (error, context) => {
        previewFailureAdapter.fail(error, {
          identity: context.identity,
          interactiveIdentity: context.request.interactiveIdentity,
          quality: context.request.quality,
          scopeRecovery: context.request.scopeRecovery,
        });
      },
      onPresented: (result, context) => {
        previewPresentationAdapter.present(result, {
          createdAt: context.request.createdAt,
          identity: context.identity,
          inputToDispatchMs: context.inputToDispatchMs,
          interactiveIdentity: context.request.interactiveIdentity,
          quality: context.request.quality,
          renderMs: context.renderMs,
          scopeRecovery: context.request.scopeRecovery,
          targetResolution: context.request.targetResolution,
        });
      },
      releaseMaterialized: (result) => {
        if (result.value.kind === 'patch' || result.value.kind === 'full') {
          previewRuntime.releaseUnpresentedUrl(result.value.url);
        }
      },
    });
  editedPreviewRunnerRef.current = editedPreviewRunner;

  const previewViewportQuality = useMemo(
    () =>
      previewQualityController.snapshot({
        baseRenderSize,
        crop: adjustments.crop,
        devicePixelRatio,
        enableZoomHifi: appSettings?.enableZoomHifi ?? true,
        highResZoomMultiplier: appSettings?.highResZoomMultiplier || 1,
        orientationSteps: adjustments.orientationSteps,
        originalSize,
        previewResolution: appSettings?.editorPreviewResolution || 1920,
        transform: previewViewportTransform,
        zoomMode,
      }),
    [
      adjustments.crop,
      adjustments.orientationSteps,
      appSettings?.editorPreviewResolution,
      appSettings?.enableZoomHifi,
      appSettings?.highResZoomMultiplier,
      baseRenderSize,
      devicePixelRatio,
      originalSize,
      previewQualityController,
      previewViewportTransform,
      zoomMode,
    ],
  );

  const capturePreviewRequestScope = useCallback(
    (targetResolution: number, roi: PreviewRoi | null) => {
      const editor = useEditorStore.getState();
      const settings = useSettingsStore.getState().appSettings;
      return previewRequestScopeAdapter.capture({ ...editor, settings }, targetResolution, roi, devicePixelRatio);
    },
    [devicePixelRatio, previewRequestScopeAdapter],
  );

  const resolveQualityDecision = useCallback(
    (requestedTargetResolution: number, interacting: boolean) => {
      const editor = useEditorStore.getState();
      const settings = useSettingsStore.getState().appSettings;
      const backend = settings?.useWgpuRenderer !== false && editor.hasRenderedFirstFrame ? 'wgpu' : 'cpu';
      const operationClass: PreviewOperationClass =
        activeRightPanel === Panel.Crop
          ? 'geometry'
          : activeRightPanel === Panel.Masks || editor.adjustments.masks.length > 0
            ? 'mask'
            : 'standard';
      return previewQualityController.decide({
        backend,
        interacting,
        operationClass,
        requestedTargetResolution,
        viewport: previewViewportQuality,
      });
    },
    [activeRightPanel, previewQualityController, previewViewportQuality],
  );
  const previewRequestIntentAdapter = useMemo(
    () =>
      new PreviewRequestIntentAdapter({
        captureScope: capturePreviewRequestScope,
        decideQuality: resolveQualityDecision,
        dispatch: dispatchPreviewCoordinator,
        installSession: (scope) => {
          previewInvalidationRunner.installSession(
            scope.session,
            useEditorStore.getState().previewScopeRecoveryRequestId,
          );
        },
        publish: setEditor,
        schedule: (request, delayMs, causalGeneration) =>
          editedPreviewRunner.request(request, delayMs, causalGeneration),
      }),
    [
      capturePreviewRequestScope,
      dispatchPreviewCoordinator,
      editedPreviewRunner,
      previewInvalidationRunner,
      resolveQualityDecision,
      setEditor,
    ],
  );
  const previewInteractionSchedulingRunner = useMemo(
    () =>
      new PreviewInteractionSchedulingEffectRunner({
        schedule: (prepared, delayMs, causalGeneration) =>
          previewRequestIntentAdapter.schedulePrepared(prepared, delayMs, causalGeneration),
      }),
    [previewRequestIntentAdapter],
  );

  useEffect(() => {
    let mounted = true;
    void previewAnalyticsRunner
      .start()
      .catch((error: unknown) => {
        console.error('Failed to subscribe to preview analytics:', error);
      })
      .finally(() => {
        if (mounted) {
          previewInvalidationRunner.start();
          setAnalyticsListenerReady(true);
        }
      });
    return () => {
      mounted = false;
      previewInvalidationRunner.stop('editor-unmounted');
      previewAnalyticsRunner.stop();
      editedPreviewRunner.cancel();
      originalPreviewAdapter.dispose();
    };
  }, [editedPreviewRunner, originalPreviewAdapter, previewAnalyticsRunner, previewInvalidationRunner]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const updateDevicePixelRatio = () => setDevicePixelRatio(getEditorZoomDpr(window.devicePixelRatio));
    window.addEventListener('resize', updateDevicePixelRatio);
    return () => window.removeEventListener('resize', updateDevicePixelRatio);
  }, []);

  useEffect(() => {
    previewQualityController.reset();
  }, [previewQualityController, selectedImage?.path]);

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

  const calculatedTargetResolution = previewViewportQuality.requestedTargetResolution;
  const calculatedRoiFingerprint = previewViewportQuality.roiFingerprint;

  previewRuntime.installEffectConsumers([
    (effects) => previewAnalyticsRunner.consume(effects),
    (effects) => editedPreviewRunner.consume(effects),
    (effects) => previewInvalidationRunner.consume(effects),
    (effects) => previewInteractionSchedulingRunner.consume(effects),
    (effects) => originalPreviewAdapter.consume(effects),
  ]);

  useEffect(() => {
    if (activeRightPanel === Panel.Crop && selectedImage?.isReady) {
      generateUncroppedPreview(adjustments);
    }
  }, [adjustments, activeRightPanel, selectedImage?.isReady, generateUncroppedPreview]);

  const captureSchedulingSnapshot = useCallback(
    (scopeRecovery = false, requestedTargetResolution = calculatedTargetResolution) => {
      const ready = selectedImage?.isReady === true;
      const edited = ready
        ? previewRequestIntentAdapter.prepare({
            activeWaveformChannel,
            delayMs: 0,
            dragging: isSliderDragging,
            isWaveformVisible,
            proofRecipe: selectedProofRecipe ?? null,
            requestedTargetResolution,
            scopeRecovery,
          })
        : null;
      const original = ready
        ? originalPreviewAdapter.capture(isCompareActive, requestedTargetResolution, (targetResolution) =>
            capturePreviewRequestScope(targetResolution, null),
          )
        : null;
      return {
        compareActive: isCompareActive,
        devicePixelRatio,
        displayHeight: displaySize.height,
        displayWidth: displaySize.width,
        edited,
        enableLivePreviews: appSettings?.enableLivePreviews !== false,
        original,
        ready,
      };
    },
    [
      activeWaveformChannel,
      adjustments,
      adjustmentSnapshot.adjustmentRevision,
      adjustmentSnapshot.geometryRevision,
      appSettings?.enableLivePreviews,
      calculatedRoiFingerprint,
      calculatedTargetResolution,
      capturePreviewRequestScope,
      devicePixelRatio,
      displaySize.height,
      displaySize.width,
      imageSessionId,
      isCompareActive,
      isSliderDragging,
      isWaveformVisible,
      originalPreviewAdapter,
      previewRequestIntentAdapter,
      selectedImage?.isReady,
      selectedImage?.path,
      selectedProofRecipe,
    ],
  );

  useEffect(() => {
    if (!analyticsListenerReady) return;
    dispatchPreviewCoordinator({
      inputs: captureSchedulingSnapshot(),
      type: 'scheduling-inputs-changed',
    });
  }, [analyticsListenerReady, captureSchedulingSnapshot, dispatchPreviewCoordinator]);

  useEffect(() => {
    previewInvalidationRunner.updateSource({
      capture: captureSchedulingSnapshot,
      scopeRecoveryRequestId: previewScopeRecoveryRequestId,
      targetResolution: appSettings?.editorPreviewResolution ?? 1920,
    });
  }, [
    appSettings?.editorPreviewResolution,
    captureSchedulingSnapshot,
    previewInvalidationRunner,
    previewScopeRecoveryRequestId,
  ]);

  return undefined;
}
