import { useCallback, useRef } from 'react';

import { useEditorStore } from '../../store/useEditorStore';
import { Invokes } from '../../tauri/commands';
import {
  buildCameraInputEditTransaction,
  captureCameraInputCommitIdentity,
  isCurrentAutoWhiteBalanceRequest,
} from '../../utils/cameraInputEditTransaction';
import { technicalWhiteBalanceFromAutoAdjustments } from '../../utils/color/whiteBalance';
import {
  type ContextAutoAdjustPatch,
  contextAutoAdjustPatchSchema,
} from '../../utils/contextAutoAdjustEditTransaction';
import { invokeWithSchema } from '../../utils/tauriSchemaInvoke';

type AutoWhiteBalanceCommitStatus = 'applied' | 'stale' | 'unavailable';

export const useAutoWhiteBalanceEditCommit = (
  enabled: boolean,
  inputSemantics: 'raw_scene_linear' | 'rendered_scene_linear_approximation',
) => {
  const requestGenerationRef = useRef(0);
  const configurationRef = useRef({ enabled, inputSemantics });
  configurationRef.current = { enabled, inputSemantics };

  const invalidatePendingAutoWhiteBalance = useCallback(() => {
    requestGenerationRef.current += 1;
  }, []);

  const resolveAutoWhiteBalance = useCallback(async (): Promise<AutoWhiteBalanceCommitStatus> => {
    const requestGeneration = ++requestGenerationRef.current;
    const requestedConfiguration = configurationRef.current;
    const initialState = useEditorStore.getState();
    const identity = captureCameraInputCommitIdentity(initialState);
    if (!requestedConfiguration.enabled || !initialState.selectedImage?.isReady || identity === null)
      return 'unavailable';

    let autoAdjustments: ContextAutoAdjustPatch;
    try {
      autoAdjustments = await invokeWithSchema(Invokes.CalculateAutoAdjustments, {}, contextAutoAdjustPatchSchema);
    } catch (error) {
      if (
        !isCurrentAutoWhiteBalanceRequest(
          useEditorStore.getState(),
          identity,
          requestGeneration,
          requestGenerationRef.current,
          requestedConfiguration,
          configurationRef.current,
        )
      )
        return 'stale';
      throw error;
    }

    const currentState = useEditorStore.getState();
    if (
      !isCurrentAutoWhiteBalanceRequest(
        currentState,
        identity,
        requestGeneration,
        requestGenerationRef.current,
        requestedConfiguration,
        configurationRef.current,
      )
    )
      return 'stale';
    const technical = technicalWhiteBalanceFromAutoAdjustments(autoAdjustments, requestedConfiguration.inputSemantics);
    currentState.applyEditTransaction(
      buildCameraInputEditTransaction(
        currentState,
        identity,
        { whiteBalanceMigration: 'native_v1', whiteBalanceTechnical: technical },
        crypto.randomUUID(),
      ),
    );
    return 'applied';
  }, []);

  return { invalidatePendingAutoWhiteBalance, resolveAutoWhiteBalance };
};
