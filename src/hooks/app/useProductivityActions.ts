import { invoke } from '@tauri-apps/api/core';
import { useCallback } from 'react';

import { hdrRuntimePlanSchema } from '../../schemas/computational-merge/hdrMergeUiSchemas';
import { panoramaRuntimePlanSchema } from '../../schemas/computational-merge/panoramaUiSchemas';
import { useHdrWorkflowStore } from '../../store/useHdrWorkflowStore';
import { useOperationLaunchStore } from '../../store/useOperationLaunchStore';
import { useUIStore } from '../../store/useUIStore';
import { Invokes } from '../../tauri/commands';
import {
  buildHdrDryRunActionState,
  buildPanoramaDryRunCommandState,
} from '../../utils/computational-merge/computationalMergeModalState';
import type { OperationEvent } from '../../workflows/operationLifecycle';

type HdrLifecycleInput = {
  [Type in OperationEvent['type']]: Omit<Extract<OperationEvent, { type: Type }>, 'launchId'>;
}[OperationEvent['type']];

export function useProductivityActions(refreshImageList: () => Promise<void>) {
  const setUI = useUIStore((state) => state.setUI);

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
        const runtimePlan = panoramaRuntimePlanSchema.parse(
          await invoke(Invokes.PlanPanorama, {
            cancellationId,
            maxPreviewDimensionPx: settings.maxPreviewDimensionPx,
            paths,
          }),
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
      const savedPath: string = await invoke(Invokes.SavePanorama, {
        firstPathStr: panoramaModalState.stitchingSourcePaths[0],
        sourcePaths: panoramaModalState.stitchingSourcePaths,
      });
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
        void invoke(Invokes.MergeHdr, {
          acceptedDryRunPlanHash: hdrModalState.runtimePlan.acceptedDryRunPlanHash,
          acceptedDryRunPlanId: hdrModalState.runtimePlan.acceptedDryRunPlanId,
          paths: selectedPaths,
        }).catch((err: unknown) => {
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
          const runtimePlan = hdrRuntimePlanSchema.parse(await invoke(Invokes.PlanHdr, { paths: selectedPaths }));
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
      const savedPath: string = await invoke(Invokes.SaveHdr, { firstPathStr: hdrModalState.stitchingSourcePaths[0] });
      await refreshImageList();
      return savedPath;
    } catch (err) {
      setUI((state) => ({ hdrModalState: { ...state.hdrModalState, error: String(err) } }));
      throw err;
    }
  }, [refreshImageList, setUI]);

  const handleApplyDenoise = useCallback(
    async (intensity: number, method: 'ai' | 'bm3d') => {
      const { denoiseModalState } = useUIStore.getState();
      if (denoiseModalState.targetPaths.length === 0) return;

      setUI((state) => ({
        denoiseModalState: {
          ...state.denoiseModalState,
          isProcessing: true,
          error: null,
          progressMessage: 'Starting engine...',
        },
      }));

      try {
        await invoke(Invokes.ApplyDenoising, {
          path: denoiseModalState.targetPaths[0],
          intensity,
          method,
        });
      } catch (err) {
        setUI((state) => ({
          denoiseModalState: { ...state.denoiseModalState, isProcessing: false, error: String(err) },
        }));
      }
    },
    [setUI],
  );

  const handleBatchDenoise = useCallback(
    async (intensity: number, method: 'ai' | 'bm3d', paths: string[]) => {
      try {
        const savedPaths: string[] = await invoke(Invokes.BatchDenoiseImages, { paths, intensity, method });
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
    const savedPath = await invoke<string>(Invokes.SaveDenoisedImage, {
      originalPathStr: denoiseModalState.targetPaths[0],
    });
    await refreshImageList();
    return savedPath;
  }, [refreshImageList]);

  const handleSaveCollage = useCallback(
    async (base64Data: string, firstPath: string): Promise<string> => {
      try {
        const savedPath: string = await invoke(Invokes.SaveCollage, { base64Data, firstPathStr: firstPath });
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
    handleBatchDenoise,
    handleSaveDenoisedImage,
    handleSaveCollage,
  };
}
