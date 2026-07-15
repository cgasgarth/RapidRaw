import { useAuth } from '@clerk/react';
import { invoke } from '@tauri-apps/api/core';
import { useCallback, useEffect } from 'react';
import { toast } from 'react-toastify';
import { Mask, type SubMask } from '../../components/panel/right/layers/Masks';
import { AiProviderId, normalizeAiProviderId } from '../../schemas/ai/aiProviderSchemas';
import { type AiPeopleMaskPart, parseAiPatchDataJson } from '../../schemas/masks/aiMaskingSchemas';
import { useEditorStore } from '../../store/useEditorStore';
import { useSettingsStore } from '../../store/useSettingsStore';
import { Invokes } from '../../tauri/commands';
import type { Adjustments, AiPatch, Coord, MaskContainer } from '../../utils/adjustments';
import { getAiPeopleMaskPartCapability } from '../../utils/ai/aiPeopleMaskContracts';
import type { AiMaskBoxAsyncRequest } from '../../utils/ai/aiMaskBoxAsyncOperations';
import { selectionAfterPatchDeletion } from '../../utils/aiEditSelection';
import { formatUnknownError } from '../../utils/errorFormatting';
import { mergeMaskParameters } from '../../utils/mask/maskParameterAccess';
import { useEditorActions } from '../editor/useEditorActions';

type SubMaskParameters = Record<string, unknown>;

const aiMaskBoxAsyncOperationsModule = import('../../utils/ai/aiMaskBoxAsyncOperations.js');

interface AiDepthMaskParameters {
  feather?: number;
  maxDepth?: number;
  maxFade?: number;
  minDepth?: number;
  minFade?: number;
}

const getTransformAdjustments = (adj: Adjustments) => ({
  transformDistortion: adj.transformDistortion,
  transformVertical: adj.transformVertical,
  transformHorizontal: adj.transformHorizontal,
  transformRotate: adj.transformRotate,
  transformAspect: adj.transformAspect,
  transformScale: adj.transformScale,
  transformXOffset: adj.transformXOffset,
  transformYOffset: adj.transformYOffset,
  lensDistortionAmount: adj.lensDistortionAmount,
  lensVignetteAmount: adj.lensVignetteAmount,
  lensTcaAmount: adj.lensTcaAmount,
  lensDistortionParams: adj.lensDistortionParams,
  lensMaker: adj.lensMaker,
  lensModel: adj.lensModel,
  lensDistortionEnabled: adj.lensDistortionEnabled,
  lensTcaEnabled: adj.lensTcaEnabled,
  lensVignetteEnabled: adj.lensVignetteEnabled,
});

export function useAiMasking() {
  const { setAdjustments } = useEditorActions();
  const setEditor = useEditorStore((state) => state.setEditor);
  const applyAiEditCommand = useEditorStore((state) => state.applyAiEditCommand);
  const activeMaskId = useEditorStore((state) => state.activeMaskId);
  const activeAiSubMaskId = useEditorStore((state) => state.activeAiSubMaskId);
  const selectedImagePath = useEditorStore((state) => state.selectedImage?.path);
  const aiProvider = useSettingsStore((state) => normalizeAiProviderId(state.appSettings?.aiProvider));
  const { getToken } = useAuth();

  const updateSubMask = useCallback(
    (subMaskId: string, updatedData: Partial<SubMask>) => {
      setAdjustments((prev: Adjustments) => ({
        ...prev,
        masks: prev.masks.map((c: MaskContainer) => ({
          ...c,
          subMasks: c.subMasks.map((sm: SubMask) => (sm.id === subMaskId ? { ...sm, ...updatedData } : sm)),
        })),
        aiPatches: prev.aiPatches.map((p: AiPatch) => ({
          ...p,
          subMasks: p.subMasks.map((sm: SubMask) => (sm.id === subMaskId ? { ...sm, ...updatedData } : sm)),
        })),
      }));
    },
    [setAdjustments],
  );

  const handleGenerativeReplace = useCallback(
    async (patchId: string, prompt: string, useFastInpaint: boolean) => {
      const { selectedImage, adjustments, isGeneratingAi, patchResidency } = useEditorStore.getState();
      if (!selectedImage?.path || isGeneratingAi) return;

      const patch: AiPatch | undefined = adjustments.aiPatches.find((p: AiPatch) => p.id === patchId);
      if (!patch) return;

      const patchDefinition = { ...patch, prompt };
      const token = await getToken();

      setAdjustments((prev: Adjustments) => ({
        ...prev,
        aiPatches: prev.aiPatches.map((p: AiPatch) => (p.id === patchId ? { ...p, isLoading: true, prompt } : p)),
      }));

      setEditor({ isGeneratingAi: true });

      try {
        const newPatchDataJson = await invoke<string>(Invokes.InvokeGenerativeReplaceWithMaskDef, {
          currentAdjustments: adjustments,
          patchDefinition: patchDefinition,
          path: selectedImage.path,
          useFastInpaint: useFastInpaint,
          token: token || null,
        });

        const newPatchData = parseAiPatchDataJson(newPatchDataJson);
        patchResidency.remove(patchId);

        applyAiEditCommand(({ aiPatches }) => {
          if (!aiPatches.some((candidate) => candidate.id === patchId)) return null;
          return {
            aiPatches: aiPatches.map((p: AiPatch) =>
              p.id === patchId
                ? {
                    ...p,
                    patchData: newPatchData,
                    isLoading: false,
                    name: useFastInpaint ? 'Inpaint' : prompt?.trim() ? prompt.trim() : p.name,
                  }
                : p,
            ),
            selection: { containerId: null, subMaskId: null },
          };
        });
      } catch (err) {
        toast.error(`AI Replace Failed: ${formatUnknownError(err)}`);
        setAdjustments((prev: Adjustments) => ({
          ...prev,
          aiPatches: prev.aiPatches.map((p: AiPatch) => (p.id === patchId ? { ...p, isLoading: false } : p)),
        }));
      } finally {
        setEditor({ isGeneratingAi: false });
      }
    },
    [applyAiEditCommand, getToken, setAdjustments, setEditor],
  );

  const handleQuickErase = useCallback(
    async (request: AiMaskBoxAsyncRequest) => {
      const { runQuickEraseBoxOperation } = await aiMaskBoxAsyncOperationsModule;
      if (request.isCurrent()) await runQuickEraseBoxOperation(request, getToken);
    },
    [getToken],
  );

  const handleDeleteMaskContainer = useCallback(
    (containerId: string) => {
      const { activeMaskContainerId } = useEditorStore.getState();
      setAdjustments((prev: Adjustments) => ({
        ...prev,
        masks: prev.masks.filter((c) => c.id !== containerId),
      }));
      if (activeMaskContainerId === containerId) {
        setEditor({ activeMaskContainerId: null, activeMaskId: null });
      }
    },
    [setAdjustments, setEditor],
  );

  const handleDeleteAiPatch = useCallback(
    (patchId: string) => {
      applyAiEditCommand(({ aiPatches, selection }) => {
        if (!aiPatches.some((patch) => patch.id === patchId)) return null;
        return {
          aiPatches: aiPatches.filter((patch) => patch.id !== patchId),
          selection: selectionAfterPatchDeletion(aiPatches, selection, patchId),
        };
      });
    },
    [applyAiEditCommand],
  );

  const handleToggleAiPatchVisibility = useCallback(
    (patchId: string) => {
      applyAiEditCommand(({ aiPatches, selection }) => {
        if (!aiPatches.some((patch) => patch.id === patchId)) return null;
        return {
          aiPatches: aiPatches.map((patch) => (patch.id === patchId ? { ...patch, visible: !patch.visible } : patch)),
          selection,
        };
      });
    },
    [applyAiEditCommand],
  );

  const handleGenerateAiMask = async (request: AiMaskBoxAsyncRequest) => {
    const { runAiSubjectBoxOperation } = await aiMaskBoxAsyncOperationsModule;
    if (request.isCurrent()) await runAiSubjectBoxOperation(request, aiProvider);
  };

  const handleGenerateAiDepthMask = async (subMaskId: string, parameters: AiDepthMaskParameters) => {
    const { selectedImage, adjustments, patchResidency } = useEditorStore.getState();
    if (!selectedImage?.path) return;
    setEditor({ isGeneratingAiMask: true });

    try {
      const transformAdjustments = getTransformAdjustments(adjustments);
      const newParameters = await invoke<Record<string, unknown>>(Invokes.GenerateAiDepthMask, {
        jsAdjustments: transformAdjustments,
        path: selectedImage.path,
        minDepth: parameters.minDepth ?? 20,
        maxDepth: parameters.maxDepth ?? 100,
        minFade: parameters.minFade ?? 15,
        maxFade: parameters.maxFade ?? 15,
        feather: parameters.feather ?? 10,
        flipHorizontal: adjustments.flipHorizontal,
        flipVertical: adjustments.flipVertical,
        orientationSteps: adjustments.orientationSteps,
        rotation: adjustments.rotation,
      });

      const subMask = adjustments.aiPatches
        .flatMap((p: AiPatch) => p.subMasks)
        .find((sm: SubMask) => sm.id === subMaskId);
      const mergedParameters = mergeMaskParameters(subMask?.parameters, newParameters);
      patchResidency.remove(subMaskId);
      updateSubMask(subMaskId, { parameters: mergedParameters });
    } catch (error) {
      toast.error(`AI Depth Mask Failed: ${formatUnknownError(error)}`);
    } finally {
      setEditor({ isGeneratingAiMask: false });
    }
  };

  const handleGenerateAiForegroundMask = async (subMaskId: string) => {
    const { selectedImage, adjustments, patchResidency } = useEditorStore.getState();
    if (!selectedImage?.path) return;
    setEditor({ isGeneratingAiMask: true });

    try {
      const transformAdjustments = getTransformAdjustments(adjustments);
      const newParameters = await invoke<Record<string, unknown>>(Invokes.GenerateAiForegroundMask, {
        jsAdjustments: transformAdjustments,
        flipHorizontal: adjustments.flipHorizontal,
        flipVertical: adjustments.flipVertical,
        orientationSteps: adjustments.orientationSteps,
        rotation: adjustments.rotation,
      });

      const subMask = adjustments.aiPatches
        .flatMap((p: AiPatch) => p.subMasks)
        .find((sm: SubMask) => sm.id === subMaskId);
      const mergedParameters = mergeMaskParameters(subMask?.parameters, newParameters);
      patchResidency.remove(subMaskId);
      updateSubMask(subMaskId, { parameters: mergedParameters });
    } catch (error) {
      toast.error(`AI Mask Failed: ${formatUnknownError(error)}`);
    } finally {
      setEditor({ isGeneratingAiMask: false });
    }
  };

  const handleGenerateAiWholePersonMask = async (subMaskId: string) => {
    const { selectedImage, adjustments, patchResidency } = useEditorStore.getState();
    if (!selectedImage?.path) return;
    setEditor({ isGeneratingAiMask: true });

    try {
      const transformAdjustments = getTransformAdjustments(adjustments);
      const newParameters = await invoke<Record<string, unknown>>(Invokes.GenerateAiWholePersonMask, {
        jsAdjustments: transformAdjustments,
        flipHorizontal: adjustments.flipHorizontal,
        flipVertical: adjustments.flipVertical,
        orientationSteps: adjustments.orientationSteps,
        rotation: adjustments.rotation,
      });

      const subMask = adjustments.aiPatches
        .flatMap((p: AiPatch) => p.subMasks)
        .find((sm: SubMask) => sm.id === subMaskId);
      const mergedParameters = mergeMaskParameters(subMask?.parameters, {
        ...newParameters,
        providerTier: 'macos_vision',
        target: { part: 'full_person', personId: null },
      });
      patchResidency.remove(subMaskId);
      updateSubMask(subMaskId, { parameters: mergedParameters });
    } catch (error) {
      toast.error(`AI Person Mask Failed: ${formatUnknownError(error)}`);
    } finally {
      setEditor({ isGeneratingAiMask: false });
    }
  };

  const handleGenerateAiPersonPartMask = async (subMaskId: string, part: AiPeopleMaskPart) => {
    const { selectedImage, adjustments, patchResidency } = useEditorStore.getState();
    if (!selectedImage?.path) return;

    const capability = getAiPeopleMaskPartCapability(part);
    const isCommandSupported = part === 'face' || part === 'full_person' || part === 'clothing' || part === 'hair';
    if (capability.validationMode !== 'runtime_apply' || !isCommandSupported) {
      toast.error(`AI ${part} Mask unavailable: ${capability.notes}`);
      return;
    }

    setEditor({ isGeneratingAiMask: true });

    try {
      const transformAdjustments = getTransformAdjustments(adjustments);
      const newParameters = await invoke<Record<string, unknown>>(Invokes.GenerateAiPersonPartMask, {
        jsAdjustments: transformAdjustments,
        part,
        flipHorizontal: adjustments.flipHorizontal,
        flipVertical: adjustments.flipVertical,
        orientationSteps: adjustments.orientationSteps,
        rotation: adjustments.rotation,
      });

      const subMask = adjustments.aiPatches
        .flatMap((p: AiPatch) => p.subMasks)
        .find((sm: SubMask) => sm.id === subMaskId);
      const mergedParameters = mergeMaskParameters(subMask?.parameters, {
        ...newParameters,
        providerTier:
          part === 'face' ? 'macos_face' : part === 'clothing' || part === 'hair' ? 'person_parser' : 'macos_vision',
        target: { part, personId: null },
      });
      patchResidency.remove(subMaskId);
      updateSubMask(subMaskId, { parameters: mergedParameters });
    } catch (error) {
      toast.error(`AI Person Mask Failed: ${formatUnknownError(error)}`);
    } finally {
      setEditor({ isGeneratingAiMask: false });
    }
  };

  const handleGenerateAiSkyMask = async (subMaskId: string) => {
    const { selectedImage, adjustments, patchResidency } = useEditorStore.getState();
    if (!selectedImage?.path) return;
    setEditor({ isGeneratingAiMask: true });

    try {
      const transformAdjustments = getTransformAdjustments(adjustments);
      const newParameters = await invoke<Record<string, unknown>>(Invokes.GenerateAiSkyMask, {
        jsAdjustments: transformAdjustments,
        flipHorizontal: adjustments.flipHorizontal,
        flipVertical: adjustments.flipVertical,
        orientationSteps: adjustments.orientationSteps,
        rotation: adjustments.rotation,
      });

      const subMask = adjustments.aiPatches
        .flatMap((p: AiPatch) => p.subMasks)
        .find((sm: SubMask) => sm.id === subMaskId);
      const mergedParameters = mergeMaskParameters(subMask?.parameters, newParameters);
      patchResidency.remove(subMaskId);
      updateSubMask(subMaskId, { parameters: mergedParameters });
    } catch (error) {
      toast.error(`AI Mask Failed: ${formatUnknownError(error)}`);
    } finally {
      setEditor({ isGeneratingAiMask: false });
    }
  };

  useEffect(() => {
    const { adjustments } = useEditorStore.getState();
    const activeSubMask =
      adjustments.masks.flatMap((m: MaskContainer) => m.subMasks).find((sm: SubMask) => sm.id === activeMaskId) ||
      adjustments.aiPatches.flatMap((p: AiPatch) => p.subMasks).find((sm: SubMask) => sm.id === activeAiSubMaskId);

    if (activeSubMask?.type === Mask.AiSubject && selectedImagePath) {
      const transformAdjustments = getTransformAdjustments(adjustments);
      invoke(Invokes.PrecomputeAiSubjectMask, {
        jsAdjustments: transformAdjustments,
        path: selectedImagePath,
      }).catch((err: unknown) => {
        console.error('Failed to precompute AI subject mask:', err);
      });
    }
  }, [activeMaskId, activeAiSubMaskId, selectedImagePath]);

  return {
    updateSubMask,
    handleGenerativeReplace,
    handleQuickErase,
    handleDeleteMaskContainer,
    handleDeleteAiPatch,
    handleToggleAiPatchVisibility,
    handleGenerateAiMask,
    handleGenerateAiDepthMask,
    handleGenerateAiForegroundMask,
    handleGenerateAiWholePersonMask,
    handleGenerateAiPersonPartMask,
    handleGenerateAiSkyMask,
  };
}
