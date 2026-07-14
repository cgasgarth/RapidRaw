import { listen } from '@tauri-apps/api/event';
import type React from 'react';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { z } from 'zod';
import { editDocumentV2Schema } from '../../../packages/rawengine-schema/src/editDocumentV2';
import { Panel } from '../../components/ui/AppProperties';
import { displayTargetChangePayloadSchema } from '../../schemas/tauriEventSchemas';
import { emptyTauriResponseSchema } from '../../schemas/tauriResponseSchemas';
import { type ExportSoftProofTransformState, useEditorStore } from '../../store/useEditorStore';
import { useLibraryStore } from '../../store/useLibraryStore';
import { useProcessStore } from '../../store/useProcessStore';
import { useSettingsStore } from '../../store/useSettingsStore';
import { useUIStore } from '../../store/useUIStore';
import { Invokes } from '../../tauri/commands';
import {
  getPreviewReadyPhase,
  type PreviewOperationClass,
  type PreviewQualityDecision,
  type PreviewQualityStatus,
  type PreviewRoi,
} from '../../utils/adaptivePreviewQuality';
import {
  decideAdjustmentPersistence,
  scheduleAdjustmentPersistenceAfterInteraction,
} from '../../utils/adjustmentPersistence';
import type { AdjustmentSnapshot } from '../../utils/adjustmentSnapshots';
import { type Adjustments, COPYABLE_ADJUSTMENT_KEYS } from '../../utils/adjustments';
import { areAdjustmentsEqual } from '../../utils/adjustmentsSnapshot';
import {
  type AppOperationContext,
  beginAppOperation,
  logAppOperationFailure,
  logAppOperationSuccess,
} from '../../utils/appEventLogger';
import { resolveAutoEditRenderSnapshot } from '../../utils/autoEditTransaction';
import { isNewDisplayResourceGeneration } from '../../utils/displayTargetChange';
import { legacyAdjustmentsToEditDocumentV2 } from '../../utils/editDocumentV2';
import { resolveEditorPreviewSource } from '../../utils/editorImagePreviewSource';
import { getEditorZoomDpr, getEditorZoomSourceSize, resolveEditorZoom } from '../../utils/editorZoom';
import { buildEditTransactionPersistenceContext } from '../../utils/editTransaction';
import { globalImageCache } from '../../utils/ImageLRUCache';
import {
  decodeInteractivePreviewUrl,
  InteractivePreviewGenerationController,
  type InteractivePreviewIdentity,
  type InteractivePreviewScope,
  LatestOnlyInteractiveScheduler,
  parseInteractivePreviewPatchPayload,
  usesPositionedPreviewPatch,
} from '../../utils/interactivePreviewPatch';
import { PreparedAdjustmentPayloadCache } from '../../utils/preparedAdjustmentPayloadCache';
import {
  createPreviewQualityPolicy,
  fingerprintPreviewGraphRevision,
  fingerprintPreviewRoi,
  PreviewCoordinator,
  type PreviewCoordinatorEvent,
  type PreviewOperationIdentity,
  type PreviewQualitySnapshot,
  type PreviewSessionIdentity,
  quantizePreviewRoi,
} from '../../utils/previewCoordinator';
import { resolveReferenceMatchRenderAdjustments } from '../../utils/referenceMatch';
import { acceptReferenceMatchAdjustmentTransfer } from '../../utils/referenceMatchTransfer';
import { DISPLAY_TARGET_CHANGED_EVENT } from '../../utils/tauriEventNames';
import { invokeWithSchema } from '../../utils/tauriSchemaInvoke';
import { debounce } from '../../utils/timing';
import { debouncedSave } from './useEditorActions';

interface PreviousAdjustments {
  adjustments: Adjustments;
  path: string;
}

interface TransformState {
  positionX: number;
  positionY: number;
  scale: number;
}

interface TransformWrapperRefValue {
  instance?: {
    transformState?: TransformState | null;
  };
}

interface InteractivePreviewRequest {
  snapshot: AdjustmentSnapshot;
  createdAt: number;
  identity: InteractivePreviewIdentity;
  quality: PreviewQualityDecision;
  roi: [number, number, number, number] | null;
  requestId: number;
  targetRes: number;
}

interface PreviewRenderRequest extends InteractivePreviewRequest {
  dragging: boolean;
  scopeRecovery: boolean;
}

interface InteractivePreviewScopeSnapshot {
  roi: [number, number, number, number] | null;
  scope: InteractivePreviewScope;
}

const previewBufferResponseSchema = z.instanceof(ArrayBuffer);
const previewDataUrlResponseSchema = z.string();
const applyAdjustmentsInvokeSchema = z
  .object({
    activeWaveformChannel: z.string().nullable().optional(),
    computeWaveform: z.boolean(),
    editDocumentV2: editDocumentV2Schema,
    expectedImagePath: z.string().trim().min(1),
    isInteractive: z.boolean(),
    roi: z.tuple([z.number(), z.number(), z.number(), z.number()]).nullable(),
    targetResolution: z.number().int().positive(),
    viewerSampleGraphRevision: z.string().nullable().optional(),
  })
  .strict();
const exportSoftProofTransformResponseSchema = z
  .object({
    blackPointCompensation: z.string().trim().min(1),
    colorManagedTransform: z.string().trim().min(1),
    effectiveColorProfile: z.string().trim().min(1),
    effectiveRenderingIntent: z.string().trim().min(1),
    policyStatus: z.string().trim().min(1),
    policyVersion: z.string().trim().min(1),
    sourcePrecisionPath: z.string().trim().min(1),
    transformApplied: z.boolean(),
    transformPolicyFingerprint: z
      .string()
      .trim()
      .regex(/^sha256:/),
  })
  .transform(
    (metadata): ExportSoftProofTransformState => ({
      blackPointCompensation: metadata.blackPointCompensation,
      colorManagedTransform: metadata.colorManagedTransform,
      effectiveColorProfile: metadata.effectiveColorProfile,
      effectiveRenderingIntent: metadata.effectiveRenderingIntent,
      policyStatus: metadata.policyStatus,
      policyVersion: metadata.policyVersion,
      sourcePrecisionPath: metadata.sourcePrecisionPath,
      transformApplied: metadata.transformApplied,
      transformPolicyFingerprint: metadata.transformPolicyFingerprint,
    }),
  );
const previewNow = (): number => globalThis.performance?.now() ?? Date.now();

export function useImageProcessing(
  transformWrapperRef: React.RefObject<TransformWrapperRefValue | null>,
  prevAdjustmentsRef: React.RefObject<PreviousAdjustments | null>,
  renderRefs: {
    currentResRef: React.RefObject<number>;
  },
) {
  const { currentResRef } = renderRefs;

  const selectedImage = useEditorStore((state) => state.selectedImage);
  const committedAdjustments = useEditorStore((state) => state.adjustments);
  const referenceMatchPreview = useEditorStore((state) => state.referenceMatchPreview);
  const autoEditPreviewSession = useEditorStore((state) => state.autoEditPreviewSession);
  const isWaveformVisible = useEditorStore((state) => state.isWaveformVisible);
  const activeWaveformChannel = useEditorStore((state) => state.activeWaveformChannel);
  const displaySize = useEditorStore((state) => state.displaySize);
  const baseRenderSize = useEditorStore((state) => state.baseRenderSize);
  const originalSize = useEditorStore((state) => state.originalSize);
  const zoomMode = useEditorStore((state) => state.zoomMode);
  const historyIndex = useEditorStore((state) => state.historyIndex);
  const adjustmentSnapshot = useEditorStore((state) => state.adjustmentSnapshot);
  const canonicalAdjustmentRevision = useEditorStore((state) => state.adjustmentRevision);
  const editorImageSession = useEditorStore((state) => state.imageSession);
  const lastEditApplicationReceipt = useEditorStore((state) => state.lastEditApplicationReceipt);
  const renderAdjustmentSnapshot = resolveAutoEditRenderSnapshot(adjustmentSnapshot, autoEditPreviewSession, {
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
  const imageSessionId = useEditorStore((state) => state.imageSessionId);
  const proofRevision = useEditorStore((state) => state.proofRevision);
  const hasRenderedFirstFrame = useEditorStore((state) => state.hasRenderedFirstFrame);
  const compare = useEditorStore((state) => state.compare);
  const isSliderDragging = useEditorStore((state) => state.isSliderDragging);
  const isExportSoftProofEnabled = useEditorStore((state) => state.isExportSoftProofEnabled);
  const exportSoftProofRecipeId = useEditorStore((state) => state.exportSoftProofRecipeId);
  const transformedOriginalUrl = useEditorStore((state) => state.transformedOriginalUrl);
  const setEditor = useEditorStore((state) => state.setEditor);
  const dispatchCompare = useEditorStore((state) => state.dispatchCompare);
  const isCompareActive = compare.mode !== 'off' || compare.isOriginalHeld;

  const activeRightPanel = useUIStore((state) => state.activeRightPanel);
  const appSettings = useSettingsStore((state) => state.appSettings);
  const multiSelectedPaths = useLibraryStore((state) => state.multiSelectedPaths);
  const selectedProofRecipe = useMemo(
    () =>
      isExportSoftProofEnabled
        ? (appSettings?.exportPresets ?? []).find((preset) => preset.id === exportSoftProofRecipeId)
        : undefined,
    [appSettings?.exportPresets, exportSoftProofRecipeId, isExportSoftProofEnabled],
  );
  const viewerSampleGraphRevision = fingerprintPreviewGraphRevision({
    adjustmentRevision: renderAdjustmentSnapshot.adjustmentRevision,
    geometryRevision: renderAdjustmentSnapshot.geometryRevision,
    imageSessionId,
    maskRevision: renderAdjustmentSnapshot.maskRevision,
    patchRevision: renderAdjustmentSnapshot.patchRevision,
    proofRevision,
    proposalFingerprint:
      renderAdjustmentSnapshot === adjustmentSnapshot
        ? (referenceMatchPreview?.proposalFingerprint ?? 'committed')
        : (autoEditPreviewSession?.previewIdentity ?? 'auto-edit-preview'),
  });

  const latestInteractiveRequestIdRef = useRef(0);
  const executeInteractiveRenderRef = useRef<(request: InteractivePreviewRequest) => Promise<void>>(async () => {});
  const interactiveSchedulerRef = useRef<LatestOnlyInteractiveScheduler<InteractivePreviewRequest> | null>(null);
  if (!interactiveSchedulerRef.current) {
    interactiveSchedulerRef.current = new LatestOnlyInteractiveScheduler((request) =>
      executeInteractiveRenderRef.current(request),
    );
  }
  const currentOriginalResRef = useRef<number>(0);
  const previewIdleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const persistIdleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activeWaveformChannelRef = useRef(activeWaveformChannel);
  activeWaveformChannelRef.current = activeWaveformChannel;
  const interactiveGenerationRef = useRef(new InteractivePreviewGenerationController());
  const preparedPayloadCacheRef = useRef(new PreparedAdjustmentPayloadCache());
  const viewportScopeRevisionRef = useRef<{ inputs: readonly unknown[]; revision: number }>({
    inputs: [],
    revision: 1,
  });
  const interactiveScopeRef = useRef<
    (targetRes: number, roi: PreviewRoi | null) => InteractivePreviewScopeSnapshot | null
  >(() => null);
  const previewQualityControllerRef = useRef(createPreviewQualityPolicy());
  const previewCoordinatorRef = useRef<PreviewCoordinator | null>(null);
  const previewCoordinator = previewCoordinatorRef.current ?? new PreviewCoordinator();
  previewCoordinatorRef.current = previewCoordinator;
  const displayResourceGenerationRef = useRef(1);

  const dispatchPreviewCoordinator = useCallback(
    (event: PreviewCoordinatorEvent) => {
      const transition = previewCoordinator.dispatch(event);
      for (const effect of transition.effects) {
        if (effect.type !== 'publish') continue;
        if (effect.identity.kind === 'settled') {
          setEditor({ finalPreviewUrl: effect.artifact.url });
        } else if (effect.identity.kind === 'original') {
          setEditor({ transformedOriginalUrl: effect.artifact.url });
        }
      }
      return transition;
    },
    [previewCoordinator, setEditor],
  );

  const previewSessionIdentity = useCallback(
    (scope: InteractivePreviewScope, targetRes: number, roi: PreviewRoi | null): PreviewSessionIdentity => {
      const positive = (value: number): number => Math.max(1, Math.round(value));
      return {
        adjustmentRevision: positive(scope.adjustmentRevision),
        backend: scope.backend,
        displayGeneration: positive(displayResourceGenerationRef.current),
        geometryRevision: positive(Number(scope.geometryIdentity)),
        graphRevision: scope.graphIdentity,
        imageSessionId: positive(scope.imageSessionId),
        maskRevision: positive(scope.maskRevision),
        patchRevision: positive(scope.patchRevision),
        proofRevision: positive(scope.proofRevision),
        roiFingerprint: fingerprintPreviewRoi(roi),
        sourceImagePath: scope.sourceImagePath,
        sourceRevision: positive(scope.imageSessionId),
        targetHeight: positive(targetRes),
        targetWidth: positive(targetRes),
        viewportRevision: positive(scope.viewportIdentity),
      };
    },
    [],
  );

  const clearInteractivePatch = useCallback(() => {
    setEditor({ interactivePatch: null });
  }, [setEditor]);

  const calculateROI = useCallback(() => {
    if (!transformWrapperRef.current) return null;
    const state = transformWrapperRef.current.instance?.transformState;
    if (!state) return null;

    const { scale, positionX, positionY } = state;
    const {
      width: baseW,
      height: baseH,
      offsetX,
      offsetY,
      containerWidth,
      containerHeight,
    } = useEditorStore.getState().baseRenderSize;

    if (!baseW || !baseH || !containerWidth || !containerHeight) return null;
    if (scale <= 1.01) return null;

    const visibleLeft = -positionX / scale;
    const visibleTop = -positionY / scale;
    const visibleRight = visibleLeft + containerWidth / scale;
    const visibleBottom = visibleTop + containerHeight / scale;

    const imgLeft = offsetX;
    const imgTop = offsetY;
    const imgRight = offsetX + baseW;
    const imgBottom = offsetY + baseH;

    const intersectLeft = Math.max(visibleLeft, imgLeft);
    const intersectTop = Math.max(visibleTop, imgTop);
    const intersectRight = Math.min(visibleRight, imgRight);
    const intersectBottom = Math.min(visibleBottom, imgBottom);

    if (intersectLeft >= intersectRight || intersectTop >= intersectBottom) {
      return null;
    }

    const roiX = (intersectLeft - imgLeft) / baseW;
    const roiY = (intersectTop - imgTop) / baseH;
    const roiW = (intersectRight - intersectLeft) / baseW;
    const roiH = (intersectBottom - intersectTop) / baseH;

    if (roiW > 0.999 && roiH > 0.999) return null;
    return [roiX, roiY, roiW, roiH] as PreviewRoi;
  }, [baseRenderSize, transformWrapperRef]);

  interactiveScopeRef.current = (targetRes, roi) => {
    const editor = useEditorStore.getState();
    const settings = useSettingsStore.getState().appSettings;
    const selectedImage = editor.selectedImage;
    if (!selectedImage) return null;
    const sourceImagePath = selectedImage.path;
    const scopeAdjustmentSnapshot = resolveAutoEditRenderSnapshot(
      editor.adjustmentSnapshot,
      editor.autoEditPreviewSession,
      { imageSessionId: editor.imageSession?.id ?? null, path: sourceImagePath },
    );
    const autoEditPreviewActive = scopeAdjustmentSnapshot !== editor.adjustmentSnapshot;

    const dpr = typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1;
    const normalizedTargetRes = Math.max(1, Math.round(targetRes));
    const viewportInputs = [
      editor.viewportRevision,
      settings?.editorPreviewResolution ?? 1920,
      settings?.enableZoomHifi ?? true,
      settings?.highResZoomMultiplier ?? 1,
      settings?.useFullDpiRendering ?? false,
    ] as const;
    if (
      viewportInputs.length !== viewportScopeRevisionRef.current.inputs.length ||
      viewportInputs.some((value, index) => value !== viewportScopeRevisionRef.current.inputs[index])
    ) {
      viewportScopeRevisionRef.current = {
        inputs: viewportInputs,
        revision: viewportScopeRevisionRef.current.revision + 1,
      };
    }
    const quantizedRoi = quantizePreviewRoi(roi, normalizedTargetRes);
    return {
      roi,
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
          proposalFingerprint: autoEditPreviewActive
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
        viewportIdentity: viewportScopeRevisionRef.current.revision,
      },
    };
  };

  const synchronizePreviewIdentity = useCallback(
    (targetRes: number, roi: PreviewRoi | null) => {
      const snapshot = interactiveScopeRef.current(targetRes, roi);
      if (!snapshot) return null;

      const synchronized = interactiveGenerationRef.current.synchronize(snapshot.scope);
      dispatchPreviewCoordinator({
        type: 'viewport-changed',
        viewport: {
          revision: snapshot.scope.viewportIdentity,
          roiFingerprint: fingerprintPreviewRoi(snapshot.roi),
          targetHeight: snapshot.scope.targetResolution,
          targetWidth: snapshot.scope.targetResolution,
        },
      });
      if (synchronized.invalidated) {
        interactiveSchedulerRef.current?.clear();
      }
      return { identity: synchronized.identity, roi: snapshot.roi, scope: snapshot.scope };
    },
    [dispatchPreviewCoordinator],
  );

  const isPreviewRequestCurrent = useCallback(
    (request: PreviewRenderRequest) => {
      const current = synchronizePreviewIdentity(request.targetRes, request.roi);
      return current !== null && interactiveGenerationRef.current.isCurrent(request.identity, current.identity);
    },
    [synchronizePreviewIdentity],
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

  const executeApplyAdjustments = useCallback(
    async (request: PreviewRenderRequest) => {
      if (!isPreviewRequestCurrent(request)) return;
      const coordinatorIdentity = previewCoordinator.operationForRequest(request.requestId);
      if (coordinatorIdentity !== undefined) {
        dispatchPreviewCoordinator({ identity: coordinatorIdentity, type: 'operation-started' });
      }
      const completeCoordinatorOperation = (url?: string): boolean => {
        if (coordinatorIdentity === undefined) return true;
        let transition: ReturnType<typeof dispatchPreviewCoordinator>;
        if (url === undefined) {
          transition = dispatchPreviewCoordinator({ identity: coordinatorIdentity, type: 'operation-completed' });
        } else {
          transition = dispatchPreviewCoordinator({
            artifact: { identity: coordinatorIdentity, url },
            identity: coordinatorIdentity,
            type: 'operation-completed',
          });
        }
        previewCoordinator.forgetRequest(request.requestId);
        return transition.state.lastTransition?.staleCompletion !== true;
      };
      const failCoordinatorOperation = (error: unknown) => {
        if (coordinatorIdentity === undefined) return;
        dispatchPreviewCoordinator({ error: String(error), identity: coordinatorIdentity, type: 'operation-failed' });
        previewCoordinator.forgetRequest(request.requestId);
      };
      const dispatchedAt = previewNow();
      const inputToDispatchMs = Math.max(0, dispatchedAt - request.createdAt);
      const publishQualityStatus = (phase: PreviewQualityStatus['phase'], quality = request.quality) => {
        setEditor({
          previewQualityStatus: {
            ...quality,
            generation: request.identity.generation,
            phase,
            requestId: request.requestId,
          },
        });
      };
      publishQualityStatus(request.dragging ? 'rendering_interaction' : 'refining_current_view');

      const { patchResidency } = useEditorStore.getState();
      const residency = patchResidency.snapshot();
      const { newlySentPatchIds, payload } = preparedPayloadCacheRef.current.prepare(request.snapshot, residency);
      const jobId = coordinatorIdentity?.operationId ?? request.requestId;
      let operation: AppOperationContext | null = null;

      try {
        if (!request.dragging) {
          setEditor({ requestedPreviewResolution: request.quality.requestedTargetResolution });
        }
        const proofRequest =
          !request.dragging && selectedProofRecipe
            ? {
                blackPointCompensation: selectedProofRecipe.blackPointCompensation ?? false,
                colorProfile: selectedProofRecipe.colorProfile ?? 'srgb',
                expectedImagePath: request.identity.sourceImagePath,
                exportSoftProofRecipeId: selectedProofRecipe.id,
                computeWaveform: isWaveformVisible || request.scopeRecovery,
                activeWaveformChannel: activeWaveformChannelRef.current,
                jsAdjustments: payload,
                renderingIntent: selectedProofRecipe.renderingIntent ?? 'relativeColorimetric',
                targetResolution: request.targetRes,
                viewerSampleGraphRevision: request.identity.graphIdentity,
              }
            : null;

        if (!request.dragging) {
          operation = beginAppOperation({
            action: proofRequest ? 'render_soft_proof_preview' : 'render_editor_preview',
            component: 'editor.preview',
            details: {
              computeWaveform: isWaveformVisible,
              generation: request.identity.generation,
              hasRoi: Boolean(request.roi),
              jobId,
              softProof: Boolean(proofRequest),
              targetResolution: request.targetRes,
              previewQualityTier: request.quality.tier,
              previewQualityReason: request.quality.reason,
              previewQualitySufficient: request.quality.sufficientForSemanticZoom,
            },
            domain: 'preview',
            operationId: `preview_${String(jobId)}`,
            traceId: proofRequest?.exportSoftProofRecipeId
              ? `preview_soft_proof_${proofRequest.exportSoftProofRecipeId}`
              : undefined,
          });
        }

        if (!isPreviewRequestCurrent(request)) return;
        const proofTransformRequest = proofRequest
          ? {
              blackPointCompensation: proofRequest.blackPointCompensation,
              colorProfile: proofRequest.colorProfile,
              jsAdjustments: proofRequest.jsAdjustments,
              renderingIntent: proofRequest.renderingIntent,
              targetResolution: proofRequest.targetResolution,
            }
          : null;
        const renderStartedAt = previewNow();
        const proofResult =
          proofRequest && proofTransformRequest
            ? await Promise.all([
                invokeWithSchema(
                  Invokes.GenerateExportSoftProofPreview,
                  { request: proofRequest },
                  previewBufferResponseSchema,
                ),
                invokeWithSchema(
                  Invokes.ResolveExportSoftProofTransformMetadata,
                  proofTransformRequest,
                  exportSoftProofTransformResponseSchema,
                ),
              ]).then(([buffer, transform]) => ({ buffer, transform }))
            : {
                buffer: await invokeWithSchema(
                  Invokes.ApplyAdjustments,
                  {
                    request: applyAdjustmentsInvokeSchema.parse({
                      activeWaveformChannel: activeWaveformChannelRef.current,
                      computeWaveform: isWaveformVisible || request.scopeRecovery,
                      editDocumentV2: legacyAdjustmentsToEditDocumentV2(payload),
                      expectedImagePath: request.identity.sourceImagePath,
                      isInteractive: request.dragging,
                      roi: request.roi,
                      targetResolution: request.targetRes,
                      viewerSampleGraphRevision: request.identity.graphIdentity,
                    }),
                  },
                  previewBufferResponseSchema,
                ),
                transform: null,
              };
        const { buffer, transform } = proofResult;
        const renderMs = Math.max(0, previewNow() - renderStartedAt);

        if (!isPreviewRequestCurrent(request)) {
          if (operation)
            logAppOperationSuccess(operation, {
              byteLength: buffer.byteLength,
              droppedReason: 'stale_identity',
              jobId,
            });
          return;
        }
        if (newlySentPatchIds.size > 0) {
          patchResidency.markResident(request.identity.imageSessionId, newlySentPatchIds);
        }

        if (buffer.byteLength === 0) {
          completeCoordinatorOperation();
          if (operation) logAppOperationSuccess(operation, { byteLength: 0, droppedReason: 'empty_buffer', jobId });
          publishQualityStatus('degraded_limited', {
            ...request.quality,
            limitedBy: 'backend',
            reason: 'empty_render_buffer',
            sufficientForSemanticZoom: false,
          });
          return;
        }

        const prefix = new TextDecoder().decode(buffer.slice(0, 11));
        if (prefix === 'WGPU_RENDER') {
          if (request.dragging) {
            const current = synchronizePreviewIdentity(request.targetRes, request.roi);
            if (
              current === null ||
              !interactiveGenerationRef.current.canCommit(request.identity, request.requestId, current.identity)
            ) {
              return;
            }
          }
          if (!completeCoordinatorOperation()) return;
          if (!request.dragging) {
            setEditor({ renderedPreviewResolution: request.targetRes });
          }
          clearInteractivePatch();
          publishQualityStatus(getPreviewReadyPhase(request.quality));
          previewQualityControllerRef.current.record({
            commitMs: 0,
            decodeMs: 0,
            displayedAgeMs: Math.max(0, previewNow() - request.createdAt),
            inputToDispatchMs,
            renderMs,
            tier: request.quality.tier,
          });
          if (operation) logAppOperationSuccess(operation, { backend: 'wgpu', byteLength: buffer.byteLength, jobId });
          return;
        }

        const patch = usesPositionedPreviewPatch(request) ? parseInteractivePreviewPatchPayload(buffer) : null;
        if (patch && !patch.ok) {
          completeCoordinatorOperation();
          publishQualityStatus('degraded_limited', {
            ...request.quality,
            limitedBy: 'backend',
            reason: patch.reason,
            sufficientForSemanticZoom: false,
          });
          if (operation)
            logAppOperationSuccess(operation, { byteLength: buffer.byteLength, droppedReason: patch.reason, jobId });
          return;
        }

        const blob = new Blob([patch?.ok ? patch.imageBuffer : buffer], { type: 'image/jpeg' });
        const url = URL.createObjectURL(blob);
        const decodeStartedAt = previewNow();
        try {
          await decodeInteractivePreviewUrl(url);
        } catch {
          URL.revokeObjectURL(url);
          if (operation && !request.dragging)
            logAppOperationFailure(operation, new Error('final_preview_decode_failed'));
          if (isPreviewRequestCurrent(request)) {
            publishQualityStatus('degraded_limited', {
              ...request.quality,
              limitedBy: 'error',
              reason: 'preview_decode_failed',
              sufficientForSemanticZoom: false,
            });
          }
          return;
        }
        const decodeMs = Math.max(0, previewNow() - decodeStartedAt);

        if (!isPreviewRequestCurrent(request)) {
          URL.revokeObjectURL(url);
          if (operation)
            logAppOperationSuccess(operation, {
              byteLength: buffer.byteLength,
              droppedReason: 'stale_after_decode',
              jobId,
            });
          return;
        }

        if (patch?.ok) {
          const current = synchronizePreviewIdentity(request.targetRes, request.roi);
          if (
            current === null ||
            !interactiveGenerationRef.current.canCommit(request.identity, request.requestId, current.identity)
          ) {
            URL.revokeObjectURL(url);
            return;
          }
          if (!completeCoordinatorOperation()) {
            URL.revokeObjectURL(url);
            return;
          }
          const commitStartedAt = previewNow();
          setEditor({
            interactivePatch: {
              basePreviewUrl: request.identity.basePreviewUrl,
              fullHeight: patch.fullHeight,
              fullWidth: patch.fullWidth,
              geometryIdentity: request.identity.geometryIdentity,
              normH: patch.normH,
              normW: patch.normW,
              normX: patch.normX,
              normY: patch.normY,
              pixelHeight: patch.pixelHeight,
              pixelWidth: patch.pixelWidth,
              sourceImagePath: request.identity.sourceImagePath,
              url,
            },
            previewQualityStatus: {
              ...request.quality,
              generation: request.identity.generation,
              phase: getPreviewReadyPhase(request.quality),
              requestId: request.requestId,
            },
            ...(!request.dragging ? { renderedPreviewResolution: request.targetRes } : {}),
          });
          previewQualityControllerRef.current.record({
            commitMs: Math.max(0, previewNow() - commitStartedAt),
            decodeMs,
            displayedAgeMs: Math.max(0, previewNow() - request.createdAt),
            inputToDispatchMs,
            renderMs,
            tier: request.quality.tier,
          });
          return;
        }

        if (!isPreviewRequestCurrent(request)) {
          URL.revokeObjectURL(url);
          return;
        }
        if (!completeCoordinatorOperation(url)) {
          URL.revokeObjectURL(url);
          return;
        }
        const commitStartedAt = previewNow();
        const completedScopeStatus = useEditorStore.getState().previewScopeStatus;
        setEditor({
          exportSoftProofTransform: transform,
          navigatorPreviewArtifact: {
            graphIdentity: request.identity.graphIdentity,
            id: `${request.identity.graphIdentity}:${String(request.identity.generation)}:${String(request.requestId)}`,
            imageSessionId: useEditorStore.getState().imageSession?.id ?? String(request.identity.imageSessionId),
            url,
          },
          previewScopeStatus:
            transform &&
            completedScopeStatus?.path === request.identity.sourceImagePath &&
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
                    transform.transformApplied
                      ? 'export_profile_transform_applied'
                      : 'export_profile_transform_missing',
                    'render_target_matches_export_recipe',
                  ],
                }
              : completedScopeStatus,
          previewQualityStatus: {
            ...request.quality,
            generation: request.identity.generation,
            phase: getPreviewReadyPhase(request.quality),
            requestId: request.requestId,
          },
          renderedPreviewResolution: request.targetRes,
        });
        previewQualityControllerRef.current.record({
          commitMs: Math.max(0, previewNow() - commitStartedAt),
          decodeMs,
          displayedAgeMs: Math.max(0, previewNow() - request.createdAt),
          inputToDispatchMs,
          renderMs,
          tier: request.quality.tier,
        });
        clearInteractivePatch();
        if (operation) {
          logAppOperationSuccess(operation, {
            byteLength: buffer.byteLength,
            jobId,
            softProofTransformApplied: transform?.transformApplied ?? false,
          });
        }
        if (request.scopeRecovery) setEditor({ previewScopeRecoveryError: null });
      } catch (err) {
        const expectedSupersession = String(err).includes('preview_superseded');
        if (!expectedSupersession) {
          console.error('Failed to apply adjustments:', err);
          if (operation) logAppOperationFailure(operation, err);
        } else if (operation) {
          logAppOperationSuccess(operation, { droppedReason: 'superseded', jobId });
        }
        if (!expectedSupersession && isPreviewRequestCurrent(request)) {
          failCoordinatorOperation(err);
          publishQualityStatus('degraded_limited', {
            ...request.quality,
            limitedBy: 'error',
            reason: 'render_error',
            sufficientForSemanticZoom: false,
          });
          if (request.scopeRecovery) {
            setEditor({
              previewScopeRecoveryError: err instanceof Error ? err.message : String(err),
              previewScopeRecoveryState: 'error',
            });
          }
        }
      }
    },
    [
      clearInteractivePatch,
      isPreviewRequestCurrent,
      isWaveformVisible,
      previewCoordinator,
      selectedProofRecipe,
      setEditor,
      synchronizePreviewIdentity,
    ],
  );

  executeInteractiveRenderRef.current = (request) =>
    executeApplyAdjustments({ ...request, dragging: true, scopeRecovery: false });

  useEffect(
    () => () => {
      interactiveSchedulerRef.current?.dispose();
      dispatchPreviewCoordinator({ reason: 'editor-unmounted', type: 'cancel-session' });
    },
    [dispatchPreviewCoordinator],
  );

  useEffect(() => {
    if (!selectedImage?.isReady) {
      dispatchPreviewCoordinator({ reason: 'image-not-ready', type: 'cancel-session' });
      return;
    }
    const scopeSnapshot = interactiveScopeRef.current(appSettings?.editorPreviewResolution ?? 1920, null);
    if (scopeSnapshot === null) return;
    dispatchPreviewCoordinator({
      session: previewSessionIdentity(scopeSnapshot.scope, scopeSnapshot.scope.targetResolution, scopeSnapshot.roi),
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
    (_currentAdjustments: Adjustments, dragging: boolean = false, targetRes?: number, scopeRecovery = false) => {
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
      const synchronized = synchronizePreviewIdentity(normalizedTargetRes, quality.effectiveRoi);
      if (!synchronized) return;
      const createdAt = previewNow();
      const coordinatorSession = previewSessionIdentity(synchronized.scope, normalizedTargetRes, synchronized.roi);

      if (dragging) {
        const requestId = ++latestInteractiveRequestIdRef.current;
        const transition = dispatchPreviewCoordinator({
          identity: coordinatorSession,
          kind: 'interactive',
          reason: 'interactive-inputs-changed',
          type: 'render-inputs-changed',
        });
        const coordinatorIdentity = transition.state.interactive.identity;
        if (coordinatorIdentity === undefined || !previewCoordinator.bindRequest(requestId, coordinatorIdentity))
          return;
        interactiveSchedulerRef.current?.schedule({
          snapshot: renderAdjustmentSnapshot,
          createdAt,
          identity: synchronized.identity,
          quality,
          roi: synchronized.roi,
          requestId,
          targetRes: normalizedTargetRes,
        });
      } else {
        const requestId = ++latestInteractiveRequestIdRef.current;
        const transition = dispatchPreviewCoordinator({
          identity: coordinatorSession,
          kind: 'settled',
          reason: scopeRecovery ? 'scope-recovery' : 'settled-inputs-changed',
          type: 'render-inputs-changed',
        });
        const coordinatorIdentity = transition.state.settled.identity;
        if (coordinatorIdentity === undefined || !previewCoordinator.bindRequest(requestId, coordinatorIdentity))
          return;
        interactiveSchedulerRef.current?.clear();
        void executeApplyAdjustments({
          snapshot: renderAdjustmentSnapshot,
          createdAt,
          dragging: false,
          identity: interactiveGenerationRef.current.supersede(synchronized.scope),
          quality,
          roi: synchronized.roi,
          requestId,
          scopeRecovery,
          targetRes: normalizedTargetRes,
        });
      }
    },
    [
      appSettings?.editorPreviewResolution,
      clearInteractivePatch,
      executeApplyAdjustments,
      dispatchPreviewCoordinator,
      previewCoordinator,
      resolveQualityDecision,
      renderAdjustmentSnapshot,
      previewSessionIdentity,
      selectedImage?.isReady,
      synchronizePreviewIdentity,
    ],
  );

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
      if (
        !parsed.success ||
        !isNewDisplayResourceGeneration(displayResourceGenerationRef.current, parsed.data.displayResourceGeneration)
      )
        return;
      displayResourceGenerationRef.current = parsed.data.displayResourceGeneration;
      dispatchPreviewCoordinator({
        generation: parsed.data.displayResourceGeneration,
        type: 'display-generation-changed',
      });
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
      mode: zoomMode,
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
    zoomMode,
  ]);

  useLayoutEffect(() => {
    if (!selectedImage?.isReady) return;
    const quality = resolveQualityDecision(calculateTargetRes(), false);
    synchronizePreviewIdentity(quality.effectiveTargetResolution, quality.effectiveRoi);
  }, [
    baseRenderSize,
    calculateTargetRes,
    renderAdjustmentSnapshot.geometryRevision,
    hasRenderedFirstFrame,
    historyIndex,
    isExportSoftProofEnabled,
    exportSoftProofRecipeId,
    selectedImage?.isReady,
    selectedImage?.path,
    resolveQualityDecision,
    synchronizePreviewIdentity,
  ]);

  const requestHiFiZoom = useMemo(
    () =>
      debounce((currentAdjustments: Adjustments, targetRes: number) => {
        if (targetRes > currentResRef.current) {
          currentResRef.current = targetRes;
          applyAdjustments(currentAdjustments, false, targetRes);
        }
      }, 50),
    [applyAdjustments, currentResRef],
  );

  const startOriginalPreviewOperation = useCallback(
    (targetRes: number): PreviewOperationIdentity | null => {
      const scopeSnapshot = interactiveScopeRef.current(targetRes, null);
      if (scopeSnapshot === null) return null;
      const session = previewSessionIdentity(scopeSnapshot.scope, targetRes, null);
      const transition = dispatchPreviewCoordinator({
        identity: session,
        kind: 'original',
        reason: 'original-preview-requested',
        type: 'render-inputs-changed',
      });
      const identity = transition.state.original.identity;
      if (identity !== undefined) {
        dispatchPreviewCoordinator({ identity, type: 'operation-started' });
      }
      return identity ?? null;
    },
    [dispatchPreviewCoordinator, previewSessionIdentity],
  );

  const completeOriginalPreviewOperation = useCallback(
    (identity: PreviewOperationIdentity, base64Data: string): boolean => {
      const transition = dispatchPreviewCoordinator({
        artifact: { identity, url: base64Data },
        identity,
        type: 'operation-completed',
      });
      return transition.state.lastTransition?.staleCompletion !== true;
    },
    [dispatchPreviewCoordinator],
  );

  const requestHiFiOriginalZoom = useMemo(
    () =>
      debounce(async (currentAdjustments: Adjustments, targetRes: number) => {
        if (targetRes > currentOriginalResRef.current) {
          const operationIdentity = startOriginalPreviewOperation(targetRes);
          if (operationIdentity === null) return;
          try {
            const base64Data = await invokeWithSchema(
              Invokes.GenerateOriginalTransformedPreview,
              {
                jsAdjustments: currentAdjustments,
                targetResolution: targetRes,
                viewerSampleGraphRevision,
              },
              previewDataUrlResponseSchema,
            );
            if (completeOriginalPreviewOperation(operationIdentity, base64Data)) {
              currentOriginalResRef.current = targetRes;
            } else if (base64Data.startsWith('blob:')) {
              URL.revokeObjectURL(base64Data);
            }
          } catch (e) {
            dispatchPreviewCoordinator({ error: String(e), identity: operationIdentity, type: 'operation-failed' });
            console.error('Failed to generate hi-fi original preview:', e);
          }
        }
      }, 200),
    [
      completeOriginalPreviewOperation,
      dispatchPreviewCoordinator,
      setEditor,
      startOriginalPreviewOperation,
      viewerSampleGraphRevision,
    ],
  );

  useEffect(() => {
    if (activeRightPanel === Panel.Crop && selectedImage?.isReady) {
      generateUncroppedPreview(adjustments);
    }
  }, [adjustments, activeRightPanel, selectedImage?.isReady, generateUncroppedPreview]);

  useEffect(() => {
    if (selectedImage?.isReady && displaySize.width > 0 && !isSliderDragging) {
      let baseRes = calculateTargetRes();
      if (originalSize.width > 0 && originalSize.height > 0) {
        const maxRes = Math.max(originalSize.width, originalSize.height);
        if (baseRes > maxRes) baseRes = maxRes;
      }
      const finalRes = Math.round(baseRes);

      if (finalRes > currentResRef.current) {
        requestHiFiZoom(adjustments, finalRes);
      }
    }
    return () => {
      requestHiFiZoom.cancel();
    };
  }, [
    adjustments,
    displaySize.width,
    displaySize.height,
    calculateTargetRes,
    currentResRef,
    selectedImage?.isReady,
    isSliderDragging,
    requestHiFiZoom,
    originalSize,
  ]);

  useEffect(() => {
    if (!selectedImage?.isReady) return;

    if (previewIdleTimer.current) clearTimeout(previewIdleTimer.current);

    const targetRes = calculateTargetRes();

    if (isSliderDragging) {
      if (appSettings?.enableLivePreviews !== false) {
        applyAdjustments(adjustments, true, targetRes);
      }
      return () => {
        if (previewIdleTimer.current) clearTimeout(previewIdleTimer.current);
      };
    }

    previewIdleTimer.current = setTimeout(() => {
      currentResRef.current = targetRes;
      applyAdjustments(adjustments, false, targetRes);
    }, 50);

    return () => {
      if (previewIdleTimer.current) clearTimeout(previewIdleTimer.current);
    };
  }, [
    adjustments,
    selectedImage?.path,
    selectedImage?.isReady,
    isSliderDragging,
    applyAdjustments,
    calculateTargetRes,
    currentResRef,
    appSettings?.enableLivePreviews,
  ]);

  useEffect(() => {
    if (!selectedImage?.isReady) return;
    const previous = prevAdjustmentsRef.current;
    const persistence = decideAdjustmentPersistence(
      previous,
      selectedImage.path,
      committedAdjustments,
      areAdjustmentsEqual,
    );
    if (persistence.action === 'prime') {
      // A newly selected image can become preview-ready before its metadata phase
      // hydrates the editor store. Prime the comparison snapshot without writing so
      // INITIAL_ADJUSTMENTS cannot race and replace the image's persisted edits.
      prevAdjustmentsRef.current = persistence.snapshot;
      return;
    }
    if (persistence.action === 'unchanged') return;

    persistIdleTimer.current = scheduleAdjustmentPersistenceAfterInteraction(
      persistIdleTimer.current,
      isSliderDragging,
      () => {
        if (useEditorStore.getState().imageSessionId !== imageSessionId) return;
        const transaction =
          lastEditApplicationReceipt &&
          lastEditApplicationReceipt.imageSessionId ===
            (useEditorStore.getState().imageSession?.id ?? `editor-image-session:${String(imageSessionId)}`) &&
          lastEditApplicationReceipt.adjustmentRevision === canonicalAdjustmentRevision
            ? buildEditTransactionPersistenceContext(lastEditApplicationReceipt, lastEditApplicationReceipt)
            : undefined;
        debouncedSave(selectedImage.path, committedAdjustments, transaction);
        useProcessStore.getState().invalidateThumbnails([selectedImage.path]);

        const otherPaths = multiSelectedPaths.filter((p) => p !== selectedImage.path);
        if (otherPaths.length > 0) {
          const prev = prevAdjustmentsRef.current;
          if (prev && prev.path === selectedImage.path) {
            const delta: Record<string, unknown> = {};
            const includedKeys = appSettings?.copyPasteSettings?.includedAdjustments || COPYABLE_ADJUSTMENT_KEYS;
            for (const key of Object.keys(committedAdjustments) as Array<keyof Adjustments>) {
              if (includedKeys.includes(key as string)) {
                const adjustmentValue: unknown = committedAdjustments[key];
                const previousAdjustmentValue: unknown = prev.adjustments[key];
                if (JSON.stringify(adjustmentValue) !== JSON.stringify(previousAdjustmentValue)) {
                  delta[key] = adjustmentValue;
                }
              }
            }
            if (Object.keys(delta).length > 0) {
              const acceptedDelta = acceptReferenceMatchAdjustmentTransfer({
                adjustments: delta,
                transferMode: 'batch-sync',
              }).adjustments;
              otherPaths.forEach((p) => {
                globalImageCache.delete(p);
              });
              useProcessStore.getState().invalidateThumbnails(otherPaths);
              invokeWithSchema(
                Invokes.ApplyAdjustmentsToPaths,
                { paths: otherPaths, adjustments: acceptedDelta },
                emptyTauriResponseSchema,
              ).catch((err: unknown) => {
                console.error('Failed to apply adjustments to multi-selection:', err);
              });
            }
          }
        }
        prevAdjustmentsRef.current = { path: selectedImage.path, adjustments: committedAdjustments };
      },
    );

    return () => {
      if (persistIdleTimer.current) clearTimeout(persistIdleTimer.current);
    };
  }, [
    committedAdjustments,
    selectedImage?.path,
    selectedImage?.isReady,
    isSliderDragging,
    multiSelectedPaths,
    prevAdjustmentsRef,
    appSettings?.copyPasteSettings?.includedAdjustments,
    imageSessionId,
    canonicalAdjustmentRevision,
    lastEditApplicationReceipt,
  ]);

  useEffect(() => {
    setEditor({ transformedOriginalUrl: null });
    currentOriginalResRef.current = 0;
  }, [adjustmentSnapshot.geometryRevision, selectedImage?.path, setEditor]);

  useEffect(() => {
    if (isCompareActive && selectedImage?.isReady && displaySize.width > 0 && !isSliderDragging) {
      const targetRes = calculateTargetRes();
      if (targetRes > currentOriginalResRef.current) {
        requestHiFiOriginalZoom(adjustments, targetRes);
      }
    }
    return () => {
      requestHiFiOriginalZoom.cancel();
    };
  }, [
    isCompareActive,
    displaySize.width,
    displaySize.height,
    calculateTargetRes,
    adjustments,
    selectedImage?.isReady,
    isSliderDragging,
    requestHiFiOriginalZoom,
    originalSize,
  ]);

  useEffect(() => {
    let isEffectActive = true;
    const requestImageSessionId = imageSessionId;
    const generate = async () => {
      if (isCompareActive && selectedImage?.path && !transformedOriginalUrl) {
        let operationIdentity: PreviewOperationIdentity | null = null;
        try {
          const targetRes = calculateTargetRes();
          operationIdentity = startOriginalPreviewOperation(targetRes);
          if (operationIdentity === null) return;
          const base64Data = await invokeWithSchema(
            Invokes.GenerateOriginalTransformedPreview,
            {
              jsAdjustments: adjustments,
              targetResolution: targetRes,
              viewerSampleGraphRevision,
            },
            previewDataUrlResponseSchema,
          );
          if (
            isEffectActive &&
            useEditorStore.getState().imageSessionId === requestImageSessionId &&
            completeOriginalPreviewOperation(operationIdentity, base64Data)
          ) {
            currentOriginalResRef.current = targetRes;
          } else if (base64Data.startsWith('blob:')) {
            URL.revokeObjectURL(base64Data);
          }
        } catch (e) {
          if (operationIdentity !== null) {
            dispatchPreviewCoordinator({ error: String(e), identity: operationIdentity, type: 'operation-failed' });
          }
          if (isEffectActive && useEditorStore.getState().imageSessionId === requestImageSessionId) {
            console.error('Failed to generate original preview:', e);
            dispatchCompare({ type: 'exit' });
          }
        }
      }
    };
    void generate();
    return () => {
      isEffectActive = false;
    };
  }, [
    isCompareActive,
    selectedImage?.path,
    adjustments,
    transformedOriginalUrl,
    calculateTargetRes,
    dispatchCompare,
    dispatchPreviewCoordinator,
    completeOriginalPreviewOperation,
    setEditor,
    startOriginalPreviewOperation,
    viewerSampleGraphRevision,
    imageSessionId,
  ]);

  return {
    applyAdjustments,
    executeApplyAdjustments,
  };
}
