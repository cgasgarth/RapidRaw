import { listen } from '@tauri-apps/api/event';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Panel } from '../../components/ui/AppProperties';
import { displayTargetChangePayloadSchema } from '../../schemas/tauriEventSchemas';
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
import { getEditorZoomDpr, getEditorZoomSourceSize, resolveEditorZoom } from '../../utils/editorZoom';
import { globalImageCache } from '../../utils/ImageLRUCache';
import { OriginalPreviewEffectRunner } from '../../utils/originalPreviewEffectRunner';
import {
  createPreviewQualityPolicy,
  fingerprintPreviewRoi,
  PreviewCoordinator,
  type PreviewCoordinatorEffect,
  type PreviewCoordinatorEvent,
  resolvePreviewViewportRoi,
} from '../../utils/previewCoordinator';
import { PreviewFailureAdapter } from '../../utils/previewFailureAdapter';
import { PreviewInvalidationAdapter } from '../../utils/previewInvalidationAdapter';
import { PreviewMaterializationAdapter } from '../../utils/previewMaterializationAdapter';
import { PreviewPresentationAdapter, type PreviewPresentationValue } from '../../utils/previewPresentationAdapter';
import { PreviewRequestIntentAdapter } from '../../utils/previewRequestIntentAdapter';
import { PreviewRequestScopeAdapter } from '../../utils/previewRequestScopeAdapter';
import { PreviewUrlReleaseAuthority } from '../../utils/previewUrlReleaseAuthority';
import { resolveReferenceMatchRenderAdjustments } from '../../utils/referenceMatch';
import { DISPLAY_TARGET_CHANGED_EVENT } from '../../utils/tauriEventNames';
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
  const previewQualityControllerRef = useRef(createPreviewQualityPolicy());
  const [devicePixelRatio, setDevicePixelRatio] = useState(() =>
    getEditorZoomDpr(typeof window === 'undefined' ? 1 : window.devicePixelRatio),
  );
  const previewCoordinatorRef = useRef<PreviewCoordinator | null>(null);
  const previewCoordinator = previewCoordinatorRef.current ?? new PreviewCoordinator();
  previewCoordinatorRef.current = previewCoordinator;
  const previewRequestScopeAdapterRef = useRef<PreviewRequestScopeAdapter | null>(null);
  const previewRequestScopeAdapter =
    previewRequestScopeAdapterRef.current ??
    new PreviewRequestScopeAdapter({
      getDisplayGeneration: () => previewCoordinator.snapshot().displayGeneration,
    });
  previewRequestScopeAdapterRef.current = previewRequestScopeAdapter;
  const previewUrlReleaseAuthorityRef = useRef<PreviewUrlReleaseAuthority | null>(null);
  const previewUrlReleaseAuthority =
    previewUrlReleaseAuthorityRef.current ??
    new PreviewUrlReleaseAuthority({ isProtected: (url) => globalImageCache.isProtected(url) });
  previewUrlReleaseAuthorityRef.current = previewUrlReleaseAuthority;
  const editedPreviewRunnerRef = useRef<EditedPreviewEffectRunner<PreviewPresentationValue> | null>(null);
  const originalPreviewRunnerRef = useRef<OriginalPreviewEffectRunner | null>(null);
  const schedulingEffectExecutorRef = useRef<((effect: PreviewCoordinatorEffect) => void) | null>(null);

  const dispatchPreviewCoordinator = useCallback(
    (event: PreviewCoordinatorEvent) => {
      const previous = previewCoordinator.snapshot();
      const transition = previewCoordinator.dispatch(event);
      editedPreviewRunnerRef.current?.consume(transition.effects);
      originalPreviewRunnerRef.current?.consume(transition.effects);
      for (const effect of transition.effects) {
        schedulingEffectExecutorRef.current?.(effect);
        if (effect.type === 'clear-original') {
          setEditor({ transformedOriginalUrl: null });
          continue;
        }
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
  const previewInvalidationAdapter = useMemo(
    () =>
      new PreviewInvalidationAdapter({
        dispatch: dispatchPreviewCoordinator,
        getState: () => previewCoordinator.snapshot(),
      }),
    [dispatchPreviewCoordinator, previewCoordinator],
  );
  const previewPresentationAdapter = useMemo(
    () =>
      new PreviewPresentationAdapter({
        getCoordinatorState: () => previewCoordinator.snapshot(),
        getPresentationState: () => {
          const editor = useEditorStore.getState();
          return {
            imageSessionId: editor.imageSession?.id ?? null,
            previewScopeStatus: editor.previewScopeStatus,
          };
        },
        publish: setEditor,
        recordTiming: (sample) => previewQualityControllerRef.current.record(sample),
      }),
    [previewCoordinator, setEditor],
  );
  const previewMaterializationAdapter = useMemo(
    () =>
      new PreviewMaterializationAdapter({
        releaseUrl: (url) => previewUrlReleaseAuthority.release(url),
      }),
    [previewUrlReleaseAuthority],
  );
  const previewFailureAdapter = useMemo(
    () =>
      new PreviewFailureAdapter({
        getCoordinatorState: () => previewCoordinator.snapshot(),
        publish: setEditor,
      }),
    [previewCoordinator, setEditor],
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
          previewUrlReleaseAuthority.release(result.value.url);
        }
      },
    });
  editedPreviewRunnerRef.current = editedPreviewRunner;

  const calculateROI = useCallback((): PreviewRoi | null => {
    const roi = resolvePreviewViewportRoi(baseRenderSize, previewViewportTransform);
    return roi === null ? null : [...roi];
  }, [baseRenderSize, previewViewportTransform]);

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
        devicePixelRatio,
        interacting,
        operationClass,
        requestedTargetResolution,
        semanticZoom,
        sourceHeight: sourceSize.height,
        sourceWidth: sourceSize.width,
        visibleRoi: calculateROI(),
      });
    },
    [activeRightPanel, calculateROI, devicePixelRatio],
  );
  const previewRequestIntentAdapter = useMemo(
    () =>
      new PreviewRequestIntentAdapter({
        captureScope: capturePreviewRequestScope,
        decideQuality: resolveQualityDecision,
        dispatch: dispatchPreviewCoordinator,
        installSession: (scope) => {
          previewInvalidationAdapter.installSession(
            scope.session,
            useEditorStore.getState().previewScopeRecoveryRequestId,
          );
        },
        publish: setEditor,
        schedule: (request, delayMs) => editedPreviewRunner.request(request, delayMs),
      }),
    [
      capturePreviewRequestScope,
      dispatchPreviewCoordinator,
      editedPreviewRunner,
      previewInvalidationAdapter,
      resolveQualityDecision,
      setEditor,
    ],
  );

  useEffect(
    () => () => {
      previewInvalidationAdapter.cancelSession('editor-unmounted');
      editedPreviewRunner.cancel();
      originalPreviewRunner.dispose();
    },
    [editedPreviewRunner, originalPreviewRunner, previewInvalidationAdapter],
  );

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const updateDevicePixelRatio = () => setDevicePixelRatio(getEditorZoomDpr(window.devicePixelRatio));
    window.addEventListener('resize', updateDevicePixelRatio);
    return () => window.removeEventListener('resize', updateDevicePixelRatio);
  }, []);

  useEffect(() => {
    previewQualityControllerRef.current.reset();
  }, [selectedImage?.path]);

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
      devicePixelRatio,
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
    devicePixelRatio,
    originalSize,
  ]);
  const calculatedTargetResolution = calculateTargetRes();
  const calculatedRoiFingerprint = fingerprintPreviewRoi(calculateROI());

  schedulingEffectExecutorRef.current = (effect) => {
    if (effect.type === 'schedule-edited') {
      previewRequestIntentAdapter.schedulePrepared(effect.prepared, effect.delayMs);
    } else if (effect.type === 'schedule-original') {
      dispatchPreviewCoordinator({ type: 'viewport-changed', viewport: effect.prepared.viewport });
      originalPreviewRunner.request(effect.prepared.session, effect.prepared.request, effect.delayMs);
    }
  };

  useEffect(() => {
    if (activeRightPanel === Panel.Crop && selectedImage?.isReady) {
      generateUncroppedPreview(adjustments);
    }
  }, [adjustments, activeRightPanel, selectedImage?.isReady, generateUncroppedPreview]);

  const dispatchSchedulingSnapshot = useCallback(
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
      const originalScope =
        ready && isCompareActive ? capturePreviewRequestScope(requestedTargetResolution, null) : null;
      const original =
        originalScope === null
          ? null
          : {
              request: {
                expectedImagePath: originalScope.session.sourceImagePath,
                jsAdjustments: structuredClone(originalScope.renderSnapshot.value as Adjustments),
                targetResolution: originalScope.session.targetWidth,
                viewerSampleGraphRevision: originalScope.session.graphRevision,
              },
              session: originalScope.session,
              viewport: originalScope.viewport.coordinator,
            };
      dispatchPreviewCoordinator({
        inputs: {
          compareActive: isCompareActive,
          devicePixelRatio,
          displayHeight: displaySize.height,
          displayWidth: displaySize.width,
          edited,
          enableLivePreviews: appSettings?.enableLivePreviews !== false,
          original,
          ready,
        },
        type: 'scheduling-inputs-changed',
      });
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
      dispatchPreviewCoordinator,
      displaySize.height,
      displaySize.width,
      imageSessionId,
      isCompareActive,
      isSliderDragging,
      isWaveformVisible,
      previewRequestIntentAdapter,
      selectedImage?.isReady,
      selectedImage?.path,
      selectedProofRecipe,
    ],
  );

  useEffect(() => {
    dispatchSchedulingSnapshot();
  }, [dispatchSchedulingSnapshot]);

  useEffect(() => {
    const token = previewInvalidationAdapter.requestScopeRecovery(previewScopeRecoveryRequestId);
    if (token === null) return;
    previewInvalidationAdapter.consume(token, (scopeRecovery) => {
      dispatchSchedulingSnapshot(scopeRecovery, appSettings?.editorPreviewResolution ?? 1920);
    });
  }, [
    appSettings?.editorPreviewResolution,
    dispatchSchedulingSnapshot,
    previewInvalidationAdapter,
    previewScopeRecoveryRequestId,
  ]);

  useEffect(() => {
    let active = true;
    let unlisten: (() => void) | undefined;
    void listen<unknown>(DISPLAY_TARGET_CHANGED_EVENT, (event) => {
      if (!active) return;
      const parsed = displayTargetChangePayloadSchema.safeParse(event.payload);
      if (!parsed.success) return;
      const token = previewInvalidationAdapter.displayTargetChanged(parsed.data.displayResourceGeneration);
      if (token === null) return;
      previewInvalidationAdapter.consume(token, (scopeRecovery) => {
        dispatchSchedulingSnapshot(scopeRecovery, appSettings?.editorPreviewResolution ?? 1920);
      });
    }).then((stop) => {
      if (active) unlisten = stop;
      else stop();
    });
    return () => {
      active = false;
      unlisten?.();
    };
  }, [appSettings?.editorPreviewResolution, dispatchSchedulingSnapshot, previewInvalidationAdapter]);

  return undefined;
}
