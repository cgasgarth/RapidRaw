import { useCallback, useRef } from 'react';
import { z } from 'zod';

import { hdrRuntimePlanSchema } from '../../schemas/computational-merge/hdrMergeUiSchemas';
import { panoramaRuntimePlanSchema } from '../../schemas/computational-merge/panoramaUiSchemas';
import {
  type DenoiseBatchRequestV1,
  type DenoiseOperationHandle,
  type DenoiseRequestV1,
  denoiseBatchRequestV1Schema,
  denoiseCancelReceiptSchema,
  denoiseOperationHandleSchema,
  denoiseRequestV1Schema,
} from '../../schemas/denoiseWorkflowSchemas';
import { emptyTauriResponseSchema } from '../../schemas/tauriResponseSchemas';
import { useHdrWorkflowStore } from '../../store/useHdrWorkflowStore';
import { useOperationLaunchStore } from '../../store/useOperationLaunchStore';
import { useUIStore } from '../../store/useUIStore';
import { Invokes } from '../../tauri/commands';
import {
  buildHdrDryRunActionState,
  buildPanoramaDryRunCommandState,
} from '../../utils/computational-merge/computationalMergeModalState';
import { invokeWithSchema } from '../../utils/tauriSchemaInvoke';
import type { OperationEvent } from '../../workflows/operationLifecycle';

type HdrLifecycleInput = {
  [Type in OperationEvent['type']]: Omit<Extract<OperationEvent, { type: Type }>, 'launchId'>;
}[OperationEvent['type']];

const savedOutputPathSchema = z.string().min(1);
const savedOutputPathListSchema = z.array(savedOutputPathSchema);

export function useProductivityActions(refreshImageList: () => Promise<void>) {
  const setUI = useUIStore((state) => state.setUI);
  const denoiseLaunchRef = useRef<Promise<DenoiseOperationHandle> | null>(null);

  const handleStartPanorama = useCallback(
    async (paths: string[], operationId: string) => {
      const { panoramaModalState } = useUIStore.getState();
      if (panoramaModalState.isProcessing) return;
      const { settings } = panoramaModalState;
      const cancellationId = crypto.randomUUID();
      const dryRunCommand = buildPanoramaDryRunCommandState(paths, settings);
      setUI((state) => ({
        panoramaModalState: {
          ...state.panoramaModalState,
          activeOperationId: operationId,
          alignmentCancellationId: cancellationId,
          isProcessing: true,
          lastApplyCommand: null,
          lastDryRunCommand: dryRunCommand,
          error: null,
          finalImageBase64: null,
          progressMessage: 'Starting panorama...',
          renderedReview: null,
          runtimePlan: null,
        },
      }));
      try {
        const runtimePlan = await invokeWithSchema(
          Invokes.PlanPanorama,
          {
            cancellationId,
            maxPreviewDimensionPx: settings.maxPreviewDimensionPx,
            paths,
          },
          panoramaRuntimePlanSchema,
        );
        setUI((state) =>
          state.panoramaModalState.alignmentCancellationId !== cancellationId ||
          state.panoramaModalState.activeOperationId !== operationId
            ? {}
            : {
                panoramaModalState: {
                  ...state.panoramaModalState,
                  activeOperationId: null,
                  alignmentCancellationId: null,
                  isProcessing: false,
                  progressMessage:
                    runtimePlan.alignment_plan?.readiness === 'global_alignment_plan_ready'
                      ? 'Global alignment plan ready for review.'
                      : 'Global alignment plan requires review.',
                  runtimePlan,
                },
              },
        );
        if (runtimePlan.preflight.status === 'blocked_plan_only') {
          setUI((state) =>
            state.panoramaModalState.runtimePlan !== runtimePlan
              ? {}
              : {
                  panoramaModalState: {
                    ...state.panoramaModalState,
                    error: runtimePlan.preflight.blocked_reasons.join('\n'),
                    isProcessing: false,
                    renderedReview: null,
                  },
                },
          );
          return;
        }
      } catch (err: unknown) {
        setUI((state) => ({
          ...(state.panoramaModalState.alignmentCancellationId !== cancellationId ||
          state.panoramaModalState.activeOperationId !== operationId
            ? {}
            : {
                panoramaModalState: {
                  ...state.panoramaModalState,
                  alignmentCancellationId: null,
                  isProcessing: false,
                  error: String(err),
                },
              }),
        }));
      }
    },
    [setUI],
  );

  const handleSavePanorama = useCallback(async (): Promise<string> => {
    const { panoramaModalState } = useUIStore.getState();
    if (panoramaModalState.stitchingSourcePaths.length === 0) {
      const err = 'Source paths for panorama not found.';
      setUI((state) => ({ panoramaModalState: { ...state.panoramaModalState, error: err } }));
      throw new Error(err);
    }
    try {
      const savedPath = await invokeWithSchema(
        Invokes.SavePanorama,
        {
          firstPathStr: panoramaModalState.stitchingSourcePaths[0],
          sourcePaths: panoramaModalState.stitchingSourcePaths,
        },
        savedOutputPathSchema,
      );
      await refreshImageList();
      return savedPath;
    } catch (err) {
      setUI((state) => ({ panoramaModalState: { ...state.panoramaModalState, error: String(err) } }));
      throw err;
    }
  }, [refreshImageList, setUI]);

  const handleStartHdr = useCallback(
    (paths: string[], operationId: string) => {
      const { hdrModalState } = useUIStore.getState();
      if (hdrModalState.isProcessing) return;
      const hdrLaunchId = useOperationLaunchStore.getState().launches.hdr?.launchId;
      const dispatchHdrLifecycle = (event: HdrLifecycleInput) => {
        if (hdrLaunchId === undefined) return;
        useHdrWorkflowStore.getState().dispatch({
          event: { ...event, launchId: hdrLaunchId } as OperationEvent,
          type: 'lifecycle',
        });
      };
      const { settings } = hdrModalState;
      const { lastDryRunCommand, selectedPaths } = buildHdrDryRunActionState(paths, settings);
      if (hdrModalState.runtimePlan?.accepted === true && hdrModalState.runtimePlan.blockCodes.length === 0) {
        dispatchHdrLifecycle({ type: 'start' });
        setUI((state) => ({
          hdrModalState: {
            ...state.hdrModalState,
            activeOperationId: operationId,
            error: null,
            isProcessing: true,
            progressMessage: 'Applying calibrated HDR artifacts...',
          },
        }));
        void invokeWithSchema(
          Invokes.MergeHdr,
          {
            acceptedDryRunPlanHash: hdrModalState.runtimePlan.acceptedDryRunPlanHash,
            acceptedDryRunPlanId: hdrModalState.runtimePlan.acceptedDryRunPlanId,
            paths: selectedPaths,
          },
          emptyTauriResponseSchema,
        ).catch((err: unknown) => {
          dispatchHdrLifecycle({ type: 'fail', error: String(err) });
          setUI((state) =>
            state.hdrModalState.activeOperationId !== operationId
              ? {}
              : { hdrModalState: { ...state.hdrModalState, error: String(err), isProcessing: false } },
          );
        });
        return;
      }
      setUI((state) => {
        const { lastApplyCommand: _lastApplyCommand, ...hdrModalState } = state.hdrModalState;
        return {
          hdrModalState: {
            ...hdrModalState,
            activeOperationId: operationId,
            isProcessing: true,
            lastDryRunCommand,
            error: null,
            finalImageBase64: null,
            progressMessage: 'Starting HDR',
            runtimePlan: null,
          },
        };
      });
      dispatchHdrLifecycle({ type: 'prepare' });
      void (async () => {
        try {
          const runtimePlan = await invokeWithSchema(Invokes.PlanHdr, { paths: selectedPaths }, hdrRuntimePlanSchema);
          dispatchHdrLifecycle({ type: 'ready' });
          setUI((state) =>
            state.hdrModalState.activeOperationId !== operationId
              ? {}
              : {
                  hdrModalState: {
                    ...state.hdrModalState,
                    activeOperationId: null,
                    isProcessing: false,
                    progressMessage:
                      runtimePlan.readiness === 'deghost_unresolved'
                        ? 'Deghost preview contains unresolved motion.'
                        : 'Native deghost review preview ready.',
                    runtimePlan,
                  },
                },
          );
          if (runtimePlan.blockCodes.length > 0 || !runtimePlan.accepted) {
            dispatchHdrLifecycle({
              type: 'fail',
              error: runtimePlan.blockCodes.join('\n') || 'HDR dry-run blocked this merge.',
            });
            setUI((state) => ({
              hdrModalState: {
                ...state.hdrModalState,
                error: runtimePlan.blockCodes.join('\n') || 'HDR dry-run blocked this merge.',
                isProcessing: false,
              },
            }));
            return;
          }
        } catch (err: unknown) {
          dispatchHdrLifecycle({ type: 'fail', error: String(err) });
          setUI((state) =>
            state.hdrModalState.activeOperationId !== operationId
              ? {}
              : { hdrModalState: { ...state.hdrModalState, isProcessing: false, error: String(err) } },
          );
        }
      })();
    },
    [setUI],
  );

  const handleSaveHdr = useCallback(async (): Promise<string> => {
    const { hdrModalState } = useUIStore.getState();
    if (hdrModalState.stitchingSourcePaths.length === 0) {
      const err = 'Source paths for HDR not found.';
      setUI((state) => ({ hdrModalState: { ...state.hdrModalState, error: err } }));
      throw new Error(err);
    }
    try {
      const savedPath = await invokeWithSchema(
        Invokes.SaveHdr,
        { firstPathStr: hdrModalState.stitchingSourcePaths[0] },
        savedOutputPathSchema,
      );
      await refreshImageList();
      return savedPath;
    } catch (err) {
      setUI((state) => ({ hdrModalState: { ...state.hdrModalState, error: String(err) } }));
      throw err;
    }
  }, [refreshImageList, setUI]);

  const handleApplyDenoise = useCallback(
    async (request: DenoiseRequestV1) => {
      const { denoiseModalState } = useUIStore.getState();
      if (denoiseModalState.targetPaths.length === 0) return;
      const currentRequest = denoiseRequestV1Schema.parse(request);
      if (currentRequest.sourceIdentity !== denoiseModalState.targetPaths[0]) {
        throw new Error('Denoise request source is no longer current.');
      }

      setUI((state) => ({
        denoiseModalState: {
          ...state.denoiseModalState,
          activeOperation: null,
          isProcessing: true,
          error: null,
          originalBase64: null,
          previewBase64: null,
          progressMessage: 'Starting engine...',
        },
      }));

      const launch = invokeWithSchema(
        Invokes.ApplyDenoising,
        { request: currentRequest },
        denoiseOperationHandleSchema,
      );
      denoiseLaunchRef.current = launch;
      try {
        const operation = await launch;
        const isCurrentLaunch = denoiseLaunchRef.current === launch;
        if (isCurrentLaunch && useUIStore.getState().denoiseModalState.isProcessing) {
          setUI((state) => ({
            denoiseModalState: { ...state.denoiseModalState, activeOperation: operation },
          }));
          await invokeWithSchema(
            Invokes.ExecuteDenoising,
            { operation, request: currentRequest },
            emptyTauriResponseSchema,
          );
        } else {
          await invokeWithSchema(Invokes.CancelDenoising, { operation }, denoiseCancelReceiptSchema);
        }
      } catch (err) {
        if (denoiseLaunchRef.current === launch) {
          setUI((state) =>
            state.denoiseModalState.isProcessing
              ? {
                  denoiseModalState: {
                    ...state.denoiseModalState,
                    activeOperation: null,
                    isProcessing: false,
                    error: String(err),
                  },
                }
              : {},
          );
        }
      } finally {
        if (denoiseLaunchRef.current === launch) denoiseLaunchRef.current = null;
      }
    },
    [setUI],
  );

  const handleCancelDenoise = useCallback(
    async (expectedOperation?: DenoiseOperationHandle) => {
      const stateBeforeCancel = useUIStore.getState().denoiseModalState;
      const pendingLaunch = denoiseLaunchRef.current;
      setUI((state) => ({
        denoiseModalState: {
          ...state.denoiseModalState,
          activeOperation: null,
          error: null,
          isProcessing: false,
          originalBase64: null,
          previewBase64: null,
          progressMessage: null,
        },
      }));
      try {
        const operation = expectedOperation ?? stateBeforeCancel.activeOperation ?? (await pendingLaunch);
        if (!operation) return;
        await invokeWithSchema(Invokes.CancelDenoising, { operation }, denoiseCancelReceiptSchema);
      } catch (error) {
        console.error('Failed to cancel Enhanced Denoise:', error);
      }
    },
    [setUI],
  );

  const handleBatchDenoise = useCallback(
    async (batch: DenoiseBatchRequestV1) => {
      try {
        const currentBatch = denoiseBatchRequestV1Schema.parse(batch);
        const savedPaths = await invokeWithSchema(
          Invokes.BatchDenoiseImages,
          { batch: currentBatch },
          savedOutputPathListSchema,
        );
        await refreshImageList();
        return savedPaths;
      } catch (err) {
        setUI((state) => ({ denoiseModalState: { ...state.denoiseModalState, error: String(err) } }));
        throw err;
      }
    },
    [refreshImageList, setUI],
  );

  const handleSaveDenoisedImage = useCallback(async (): Promise<string> => {
    const { denoiseModalState } = useUIStore.getState();
    if (denoiseModalState.targetPaths.length === 0) throw new Error('No target path');
    const savedPath = await invokeWithSchema(
      Invokes.SaveDenoisedImage,
      { originalPathStr: denoiseModalState.targetPaths[0] },
      savedOutputPathSchema,
    );
    await refreshImageList();
    return savedPath;
  }, [refreshImageList]);

  const handleSaveCollage = useCallback(
    async (base64Data: string, firstPath: string): Promise<string> => {
      try {
        const savedPath = await invokeWithSchema(
          Invokes.SaveCollage,
          { base64Data, firstPathStr: firstPath },
          savedOutputPathSchema,
        );
        await refreshImageList();
        return savedPath;
      } catch (err) {
        console.error('Failed to save collage:', err);
        throw err;
      }
    },
    [refreshImageList],
  );

  return {
    handleStartPanorama,
    handleSavePanorama,
    handleStartHdr,
    handleSaveHdr,
    handleApplyDenoise,
    handleCancelDenoise,
    handleBatchDenoise,
    handleSaveDenoisedImage,
    handleSaveCollage,
  };
}
