import type React from 'react';
import { useCallback, useEffect, useMemo, useRef } from 'react';
import { z } from 'zod';
import { Panel } from '../../components/ui/AppProperties';
import { prepareAdjustmentPayloadForBackend } from '../../schemas/adjustmentPayloadSchemas';
import { emptyTauriResponseSchema } from '../../schemas/tauriResponseSchemas';
import { type ExportSoftProofTransformState, useEditorStore } from '../../store/useEditorStore';
import { useLibraryStore } from '../../store/useLibraryStore';
import { useProcessStore } from '../../store/useProcessStore';
import { useSettingsStore } from '../../store/useSettingsStore';
import { useUIStore } from '../../store/useUIStore';
import { Invokes } from '../../tauri/commands';
import { type Adjustments, COPYABLE_ADJUSTMENT_KEYS } from '../../utils/adjustments';
import { areAdjustmentsEqual } from '../../utils/adjustmentsSnapshot';
import {
  type AppOperationContext,
  beginAppOperation,
  logAppOperationFailure,
  logAppOperationSuccess,
} from '../../utils/appEventLogger';
import { resolveEditorPreviewSource } from '../../utils/editorImagePreviewSource';
import { globalImageCache } from '../../utils/ImageLRUCache';
import {
  buildInteractivePreviewGeometryIdentity,
  decodeInteractivePreviewUrl,
  isCurrentInteractivePreviewRequest,
  LatestOnlyInteractiveScheduler,
  parseInteractivePreviewPatchPayload,
} from '../../utils/interactivePreviewPatch';
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
  adjustments: Adjustments;
  requestId: number;
  targetRes?: number | undefined;
}

const previewBufferResponseSchema = z.instanceof(ArrayBuffer);
const previewDataUrlResponseSchema = z.string();
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

export function useImageProcessing(
  transformWrapperRef: React.RefObject<TransformWrapperRefValue | null>,
  prevAdjustmentsRef: React.RefObject<PreviousAdjustments | null>,
  renderRefs: {
    previewJobIdRef: React.RefObject<number>;
    latestRenderedJobIdRef: React.RefObject<number>;
    currentResRef: React.RefObject<number>;
  },
) {
  const { previewJobIdRef, latestRenderedJobIdRef, currentResRef } = renderRefs;

  const selectedImage = useEditorStore((state) => state.selectedImage);
  const adjustments = useEditorStore((state) => state.adjustments);
  const isWaveformVisible = useEditorStore((state) => state.isWaveformVisible);
  const activeWaveformChannel = useEditorStore((state) => state.activeWaveformChannel);
  const displaySize = useEditorStore((state) => state.displaySize);
  const baseRenderSize = useEditorStore((state) => state.baseRenderSize);
  const originalSize = useEditorStore((state) => state.originalSize);
  const compareMode = useEditorStore((state) => state.compareMode);
  const showOriginal = useEditorStore((state) => state.showOriginal);
  const isSliderDragging = useEditorStore((state) => state.isSliderDragging);
  const isExportSoftProofEnabled = useEditorStore((state) => state.isExportSoftProofEnabled);
  const exportSoftProofRecipeId = useEditorStore((state) => state.exportSoftProofRecipeId);
  const transformedOriginalUrl = useEditorStore((state) => state.transformedOriginalUrl);
  const setEditor = useEditorStore((state) => state.setEditor);

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

  const selectedImagePathRef = useRef<string | null>(null);
  useEffect(() => {
    selectedImagePathRef.current = selectedImage?.path ?? null;
  }, [selectedImage?.path]);

  const geometricAdjustmentsKey = useMemo(() => buildInteractivePreviewGeometryIdentity(adjustments), [adjustments]);

  const clearInteractivePatch = useCallback(() => {
    setEditor({ interactivePatch: null });
  }, [setEditor]);

  const calculateROI = useCallback(() => {
    if (!transformWrapperRef.current) return null;
    const state = transformWrapperRef.current.instance?.transformState;
    if (!state) return null;

    const { scale, positionX, positionY } = state;
    const { width: baseW, height: baseH, offsetX, offsetY, containerWidth, containerHeight } = baseRenderSize;

    if (!baseW || !baseH || !containerWidth || !containerHeight) return null;
    if (scale <= 1.01) return null;

    const paddingPixels = 2.0;
    const paddingX = paddingPixels / baseW;
    const paddingY = paddingPixels / baseH;

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

    const newRoiX = roiX - paddingX;
    const newRoiY = roiY - paddingY;
    const newRoiW = roiW + paddingX * 2;
    const newRoiH = roiH + paddingY * 2;

    const clampedX = Math.max(0, newRoiX);
    const clampedY = Math.max(0, newRoiY);
    const clampedW = Math.min(1 - clampedX, newRoiW);
    const clampedH = Math.min(1 - clampedY, newRoiH);

    if (clampedW > 0.999 && clampedH > 0.999) return null;

    return [clampedX, clampedY, clampedW, clampedH] as [number, number, number, number];
  }, [baseRenderSize, transformWrapperRef]);

  const executeApplyAdjustments = useCallback(
    async (
      currentAdjustments: Adjustments,
      dragging: boolean = false,
      targetRes?: number,
      interactiveRequestId?: number,
    ) => {
      const currentPath = selectedImage?.path;
      if (!currentPath) return;

      const { patchesSentToBackend } = useEditorStore.getState();
      const { newlySentPatchIds, payload } = prepareAdjustmentPayloadForBackend(
        structuredClone(currentAdjustments),
        patchesSentToBackend,
      );

      const jobId = ++previewJobIdRef.current;
      const roi = calculateROI();
      let operation: AppOperationContext | null = null;

      try {
        const proofRequest = selectedProofRecipe
          ? {
              blackPointCompensation: selectedProofRecipe.blackPointCompensation ?? false,
              colorProfile: selectedProofRecipe.colorProfile ?? 'srgb',
              exportSoftProofRecipeId: selectedProofRecipe.id,
              jsAdjustments: payload,
              renderingIntent: selectedProofRecipe.renderingIntent ?? 'relativeColorimetric',
              targetResolution: targetRes || null,
            }
          : null;

        if (!dragging) {
          operation = beginAppOperation({
            action: proofRequest ? 'render_soft_proof_preview' : 'render_editor_preview',
            component: 'editor.preview',
            details: {
              computeWaveform: isWaveformVisible,
              hasRoi: Boolean(roi),
              jobId,
              softProof: Boolean(proofRequest),
              targetResolution: targetRes ?? null,
            },
            domain: 'preview',
            operationId: `preview_${String(jobId)}`,
            traceId: proofRequest?.exportSoftProofRecipeId
              ? `preview_soft_proof_${proofRequest.exportSoftProofRecipeId}`
              : undefined,
          });
        }

        const proofResult =
          !dragging && proofRequest
            ? await Promise.all([
                invokeWithSchema(
                  Invokes.GenerateExportSoftProofPreview,
                  { request: proofRequest },
                  previewBufferResponseSchema,
                ),
                invokeWithSchema(
                  Invokes.ResolveExportSoftProofTransformMetadata,
                  proofRequest,
                  exportSoftProofTransformResponseSchema,
                ),
              ]).then(([buffer, transform]) => ({ buffer, transform }))
            : {
                buffer: await invokeWithSchema(
                  Invokes.ApplyAdjustments,
                  {
                    jsAdjustments: payload,
                    isInteractive: dragging,
                    targetResolution: targetRes || null,
                    roi: roi || null,
                    computeWaveform: isWaveformVisible,
                    activeWaveformChannel: activeWaveformChannelRef.current,
                  },
                  previewBufferResponseSchema,
                ),
                transform: null,
              };
        const { buffer, transform } = proofResult;

        if (newlySentPatchIds.size > 0) {
          newlySentPatchIds.forEach((id) => patchesSentToBackend.add(id));
        }

        const isCurrentInteractiveRequest = isCurrentInteractivePreviewRequest({
          currentJobId: previewJobIdRef.current,
          jobId,
          latestRequestId: latestInteractiveRequestIdRef.current,
          requestId: interactiveRequestId,
        });
        const droppedReason =
          currentPath !== selectedImagePathRef.current
            ? 'image_selection_changed'
            : jobId !== previewJobIdRef.current
              ? 'stale_job'
              : dragging && !isCurrentInteractiveRequest
                ? 'stale_interactive_request'
                : null;
        if (droppedReason) {
          if (operation) {
            logAppOperationSuccess(operation, {
              byteLength: buffer.byteLength,
              droppedReason,
              jobId,
            });
          }
          return;
        }

        if (buffer.byteLength > 0) {
          latestRenderedJobIdRef.current = jobId;

          const textDecoder = new TextDecoder();
          const prefix = textDecoder.decode(buffer.slice(0, 11));
          if (prefix === 'WGPU_RENDER') {
            clearInteractivePatch();
            if (operation) {
              logAppOperationSuccess(operation, {
                backend: 'wgpu',
                byteLength: buffer.byteLength,
                jobId,
              });
            }
            return;
          }

          if (dragging) {
            const patch = parseInteractivePreviewPatchPayload(buffer);
            if (!patch.ok) {
              clearInteractivePatch();
              if (operation) {
                logAppOperationSuccess(operation, {
                  byteLength: buffer.byteLength,
                  droppedReason: patch.reason,
                  jobId,
                });
              }
              return;
            }

            const blob = new Blob([patch.imageBuffer], { type: 'image/jpeg' });
            const url = URL.createObjectURL(blob);

            try {
              await decodeInteractivePreviewUrl(url);
            } catch {
              URL.revokeObjectURL(url);
              return;
            }

            const isCurrentDecodedInteractiveRequest = isCurrentInteractivePreviewRequest({
              currentJobId: previewJobIdRef.current,
              jobId,
              latestRequestId: latestInteractiveRequestIdRef.current,
              requestId: interactiveRequestId,
            });
            const decodeDroppedReason =
              currentPath !== selectedImagePathRef.current
                ? 'image_selection_changed'
                : jobId !== previewJobIdRef.current
                  ? 'stale_job'
                  : !isCurrentDecodedInteractiveRequest
                    ? 'stale_interactive_request'
                    : null;
            if (decodeDroppedReason) {
              URL.revokeObjectURL(url);
              if (operation) {
                logAppOperationSuccess(operation, {
                  byteLength: buffer.byteLength,
                  droppedReason: decodeDroppedReason,
                  jobId,
                });
              }
              return;
            }

            setEditor((state) => {
              const patchSelectedImage = state.selectedImage;
              return {
                interactivePatch: {
                  basePreviewUrl: patchSelectedImage
                    ? resolveEditorPreviewSource({
                        finalPreviewUrl: state.finalPreviewUrl,
                        isReady: patchSelectedImage.isReady,
                        thumbnailUrl: patchSelectedImage.thumbnailUrl,
                      })
                    : null,
                  fullHeight: patch.fullHeight,
                  fullWidth: patch.fullWidth,
                  geometryIdentity: geometricAdjustmentsKey,
                  url,
                  normX: patch.normX,
                  normY: patch.normY,
                  normW: patch.normW,
                  normH: patch.normH,
                  pixelHeight: patch.pixelHeight,
                  pixelWidth: patch.pixelWidth,
                  sourceImagePath: currentPath,
                },
              };
            });
          } else {
            const blob = new Blob([buffer], { type: 'image/jpeg' });
            const url = URL.createObjectURL(blob);

            try {
              await decodeInteractivePreviewUrl(url);
            } catch {
              URL.revokeObjectURL(url);
              if (operation) {
                logAppOperationFailure(operation, new Error('final_preview_decode_failed'));
              }
              return;
            }

            if (currentPath !== selectedImagePathRef.current || jobId !== previewJobIdRef.current) {
              URL.revokeObjectURL(url);
              if (operation) {
                logAppOperationSuccess(operation, {
                  byteLength: buffer.byteLength,
                  droppedReason: currentPath !== selectedImagePathRef.current ? 'image_selection_changed' : 'stale_job',
                  jobId,
                });
              }
              return;
            }

            setEditor({ exportSoftProofTransform: transform, finalPreviewUrl: url });

            clearInteractivePatch();
            if (operation) {
              logAppOperationSuccess(operation, {
                byteLength: buffer.byteLength,
                jobId,
                softProofTransformApplied: transform?.transformApplied ?? false,
              });
            }
          }
        } else if (operation) {
          logAppOperationSuccess(operation, {
            byteLength: buffer.byteLength,
            droppedReason: buffer.byteLength === 0 ? 'empty_buffer' : 'stale_job',
            jobId,
          });
        }
      } catch (err) {
        if (err !== 'Superseded or worker failed') {
          console.error('Failed to apply adjustments:', err);
          if (operation) {
            logAppOperationFailure(operation, err);
          }
        } else if (operation) {
          logAppOperationSuccess(operation, {
            droppedReason: 'superseded',
            jobId,
          });
        }
        if (jobId === previewJobIdRef.current) {
          clearInteractivePatch();
        }
      }
    },
    [
      selectedImage?.path,
      calculateROI,
      isWaveformVisible,
      selectedProofRecipe,
      clearInteractivePatch,
      geometricAdjustmentsKey,
      setEditor,
      previewJobIdRef,
      latestRenderedJobIdRef,
    ],
  );

  executeInteractiveRenderRef.current = ({ adjustments: currentAdjustments, requestId, targetRes }) =>
    executeApplyAdjustments(currentAdjustments, true, targetRes, requestId);

  useEffect(
    () => () => {
      interactiveSchedulerRef.current?.dispose();
    },
    [],
  );

  const applyAdjustments = useCallback(
    (currentAdjustments: Adjustments, dragging: boolean = false, targetRes?: number) => {
      if (!selectedImage?.isReady) return;

      if (dragging) {
        const requestId = ++latestInteractiveRequestIdRef.current;
        interactiveSchedulerRef.current?.schedule({ adjustments: currentAdjustments, requestId, targetRes });
      } else {
        latestInteractiveRequestIdRef.current += 1;
        interactiveSchedulerRef.current?.clear();
        void executeApplyAdjustments(currentAdjustments, false, targetRes);
      }
    },
    [selectedImage?.isReady, executeApplyAdjustments],
  );

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
    if (!(appSettings?.enableZoomHifi ?? true) || displaySize.width === 0) {
      return baseTargetRes;
    }

    const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
    const sharpnessFactor = 1.25;
    const zoomMultiplier = appSettings?.highResZoomMultiplier || 1.0;
    const effectiveDpr = appSettings?.useFullDpiRendering ? dpr : 1;

    let targetRes = Math.max(displaySize.width, displaySize.height) * effectiveDpr * sharpnessFactor * zoomMultiplier;
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
    appSettings?.useFullDpiRendering,
    displaySize.width,
    displaySize.height,
    originalSize,
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

  const requestHiFiOriginalZoom = useMemo(
    () =>
      debounce(async (currentAdjustments: Adjustments, targetRes: number) => {
        if (targetRes > currentOriginalResRef.current) {
          try {
            const base64Data = await invokeWithSchema(
              Invokes.GenerateOriginalTransformedPreview,
              {
                jsAdjustments: currentAdjustments,
                targetResolution: targetRes,
              },
              previewDataUrlResponseSchema,
            );
            currentOriginalResRef.current = targetRes;
            setEditor({ transformedOriginalUrl: base64Data });
          } catch (e) {
            console.error('Failed to generate hi-fi original preview:', e);
          }
        }
      }, 200),
    [setEditor],
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
    if (previous?.path === selectedImage.path && areAdjustmentsEqual(previous.adjustments, adjustments)) {
      return;
    }

    if (persistIdleTimer.current) clearTimeout(persistIdleTimer.current);

    if (isSliderDragging) {
      return;
    }

    persistIdleTimer.current = setTimeout(() => {
      debouncedSave(selectedImage.path, adjustments);
      useProcessStore.getState().invalidateThumbnails([selectedImage.path]);

      const otherPaths = multiSelectedPaths.filter((p) => p !== selectedImage.path);
      if (otherPaths.length > 0) {
        const prev = prevAdjustmentsRef.current;
        if (prev && prev.path === selectedImage.path) {
          const delta: Record<string, unknown> = {};
          const includedKeys = appSettings?.copyPasteSettings?.includedAdjustments || COPYABLE_ADJUSTMENT_KEYS;
          for (const key of Object.keys(adjustments) as Array<keyof Adjustments>) {
            if (includedKeys.includes(key as string)) {
              const adjustmentValue: unknown = adjustments[key];
              const previousAdjustmentValue: unknown = prev.adjustments[key];
              if (JSON.stringify(adjustmentValue) !== JSON.stringify(previousAdjustmentValue)) {
                delta[key] = adjustmentValue;
              }
            }
          }
          if (Object.keys(delta).length > 0) {
            otherPaths.forEach((p) => {
              globalImageCache.delete(p);
            });
            useProcessStore.getState().invalidateThumbnails(otherPaths);
            invokeWithSchema(
              Invokes.ApplyAdjustmentsToPaths,
              { paths: otherPaths, adjustments: delta },
              emptyTauriResponseSchema,
            ).catch((err: unknown) => {
              console.error('Failed to apply adjustments to multi-selection:', err);
            });
          }
        }
      }
      prevAdjustmentsRef.current = { path: selectedImage.path, adjustments };
    }, 50);

    return () => {
      if (persistIdleTimer.current) clearTimeout(persistIdleTimer.current);
    };
  }, [
    adjustments,
    selectedImage?.path,
    selectedImage?.isReady,
    isSliderDragging,
    multiSelectedPaths,
    prevAdjustmentsRef,
    appSettings?.copyPasteSettings?.includedAdjustments,
  ]);

  useEffect(() => {
    setEditor({ transformedOriginalUrl: null });
    currentOriginalResRef.current = 0;
  }, [geometricAdjustmentsKey, selectedImage?.path, setEditor]);

  useEffect(() => {
    if (
      (compareMode !== 'off' || showOriginal) &&
      selectedImage?.isReady &&
      displaySize.width > 0 &&
      !isSliderDragging
    ) {
      const targetRes = calculateTargetRes();
      if (targetRes > currentOriginalResRef.current) {
        requestHiFiOriginalZoom(adjustments, targetRes);
      }
    }
    return () => {
      requestHiFiOriginalZoom.cancel();
    };
  }, [
    compareMode,
    showOriginal,
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
    const generate = async () => {
      if ((compareMode !== 'off' || showOriginal) && selectedImage?.path && !transformedOriginalUrl) {
        try {
          const targetRes = calculateTargetRes();
          const base64Data = await invokeWithSchema(
            Invokes.GenerateOriginalTransformedPreview,
            {
              jsAdjustments: adjustments,
              targetResolution: targetRes,
            },
            previewDataUrlResponseSchema,
          );
          if (isEffectActive) {
            currentOriginalResRef.current = targetRes;
            setEditor({ transformedOriginalUrl: base64Data });
          }
        } catch (e) {
          if (isEffectActive) {
            console.error('Failed to generate original preview:', e);
            setEditor({ compareMode: 'off' });
          }
        }
      }
    };
    void generate();
    return () => {
      isEffectActive = false;
    };
  }, [
    compareMode,
    showOriginal,
    selectedImage?.path,
    adjustments,
    transformedOriginalUrl,
    calculateTargetRes,
    setEditor,
  ]);

  return {
    applyAdjustments,
    executeApplyAdjustments,
  };
}
