import { useAuth } from '@clerk/react';
import { invoke } from '@tauri-apps/api/core';
import { useCallback, useEffect } from 'react';
import { toast } from 'react-toastify';
import {
  type EditDocumentV2,
  editDocumentLayersV2Schema,
  editDocumentSourceArtifactsV2Schema,
} from '../../../packages/rawengine-schema/src/editDocumentV2';
import { Mask, type SubMask } from '../../components/panel/right/layers/Masks';
import { AiProviderId, normalizeAiProviderId } from '../../schemas/ai/aiProviderSchemas';
import {
  type AiPeopleMaskPart,
  aiPeopleMaskAnalysisSchema,
  aiPeopleMaskPartSchema,
  aiPeopleMaskTargetSchema,
  parseAiPatchDataJson,
} from '../../schemas/masks/aiMaskingSchemas';
import { useEditorStore } from '../../store/useEditorStore';
import { useSettingsStore } from '../../store/useSettingsStore';
import { Invokes } from '../../tauri/commands';
import type { AiPatch, Coord, MaskContainer } from '../../utils/adjustments';
import type { AiMaskBoxAsyncRequest } from '../../utils/ai/aiMaskBoxAsyncOperations';
import { getAiPeopleMaskPartCapability } from '../../utils/ai/aiPeopleMaskContracts';
import { selectionAfterPatchDeletion } from '../../utils/aiEditSelection';
import {
  selectEditDocumentGeometry,
  selectEditDocumentMasks,
  selectEditDocumentNode,
  selectEditDocumentSourceArtifacts,
} from '../../utils/editDocumentSelectors';
import { formatUnknownError } from '../../utils/errorFormatting';
import { mergeMaskParameters, toMaskParameterRecord } from '../../utils/mask/maskParameterAccess';
import { useEditorActions } from '../editor/useEditorActions';

type SubMaskParameters = Record<string, unknown>;

export const parseAiPeopleMaskAnalysis = (value: unknown) => aiPeopleMaskAnalysisSchema.safeParse(value);

export const parseAiPeopleMaskPart = (value: string): AiPeopleMaskPart =>
  aiPeopleMaskPartSchema.catch('full_person').parse(value);

const aiMaskBoxAsyncOperationsModule = import('../../utils/ai/aiMaskBoxAsyncOperations.js');

interface AiDepthMaskParameters {
  feather?: number;
  maxDepth?: number;
  maxFade?: number;
  minDepth?: number;
  minFade?: number;
}

const getTransformAdjustments = (document: EditDocumentV2) => ({
  ...selectEditDocumentGeometry(document),
  ...selectEditDocumentNode(document, 'lens_correction').params,
});

interface AiMaskGenerationContext {
  adjustmentRevision: number;
  geometryIdentity: string;
  imageSessionId: string;
  sourceIdentity: string;
}

const captureAiMaskGenerationContext = (state: {
  adjustmentRevision: number;
  editDocumentV2: EditDocumentV2;
  imageSession: { id: string } | null;
  imageSessionId: number;
  selectedImage: { path: string } | null;
}): AiMaskGenerationContext => ({
  adjustmentRevision: state.adjustmentRevision,
  geometryIdentity: JSON.stringify(selectEditDocumentGeometry(state.editDocumentV2)),
  imageSessionId: state.imageSession?.id ?? `editor-image-session:${String(state.imageSessionId)}`,
  sourceIdentity: state.selectedImage?.path ?? '',
});

const isAiMaskGenerationCurrent = (
  state: {
    adjustmentRevision: number;
    editDocumentV2: EditDocumentV2;
    imageSession: { id: string } | null;
    imageSessionId: number;
    selectedImage: { path: string } | null;
  },
  context: AiMaskGenerationContext,
): boolean => {
  const imageSessionId = state.imageSession?.id ?? `editor-image-session:${String(state.imageSessionId)}`;
  return (
    state.adjustmentRevision === context.adjustmentRevision &&
    imageSessionId === context.imageSessionId &&
    state.selectedImage?.path === context.sourceIdentity &&
    JSON.stringify(selectEditDocumentGeometry(state.editDocumentV2)) === context.geometryIdentity
  );
};

const findAiSubMask = (document: EditDocumentV2, subMaskId: string): SubMask | undefined =>
  [
    ...selectEditDocumentMasks(document).flatMap((container) => container.subMasks),
    ...selectEditDocumentSourceArtifacts(document).aiPatches.flatMap((patch) => patch.subMasks),
  ].find((subMask) => subMask.id === subMaskId);

export function useAiMasking() {
  const { commitEditNodeOperations } = useEditorActions();
  const setEditor = useEditorStore((state) => state.setEditor);
  const applyAiEditCommand = useEditorStore((state) => state.applyAiEditCommand);
  const activeMaskId = useEditorStore((state) => state.activeMaskId);
  const activeAiSubMaskId = useEditorStore((state) => state.activeAiSubMaskId);
  const selectedImagePath = useEditorStore((state) => state.selectedImage?.path);
  const aiProvider = useSettingsStore((state) => normalizeAiProviderId(state.appSettings?.aiProvider));
  const { getToken } = useAuth();

  const updateSubMask = useCallback(
    (subMaskId: string, updatedData: Partial<SubMask>) => {
      const document = useEditorStore.getState().editDocumentV2;
      commitEditNodeOperations([
        {
          nodeType: 'layers',
          patch: {
            masks: editDocumentLayersV2Schema.parse({
              masks: selectEditDocumentMasks(document).map((c: MaskContainer) => ({
                ...c,
                subMasks: c.subMasks.map((sm: SubMask) => (sm.id === subMaskId ? { ...sm, ...updatedData } : sm)),
              })),
            }).masks,
          },
          type: 'patch-edit-document-node',
        },
        {
          nodeType: 'source_artifacts',
          patch: {
            aiPatches: editDocumentSourceArtifactsV2Schema.parse({
              aiPatches: selectEditDocumentSourceArtifacts(document).aiPatches.map((p: AiPatch) => ({
                ...p,
                subMasks: p.subMasks.map((sm: SubMask) => (sm.id === subMaskId ? { ...sm, ...updatedData } : sm)),
              })),
            }).aiPatches,
          },
          type: 'patch-edit-document-node',
        },
      ]);
    },
    [commitEditNodeOperations],
  );

  const handleGenerativeReplace = useCallback(
    async (patchId: string, prompt: string, useFastInpaint: boolean) => {
      const { selectedImage, editDocumentV2: adjustments, isGeneratingAi, patchResidency } = useEditorStore.getState();
      if (!selectedImage?.path || isGeneratingAi) return;

      const patch: AiPatch | undefined = selectEditDocumentSourceArtifacts(adjustments).aiPatches.find(
        (p: AiPatch) => p.id === patchId,
      );
      if (!patch) return;

      const patchDefinition = { ...patch, prompt };
      const token = await getToken();

      applyAiEditCommand(({ aiPatches, selection }) => ({
        aiPatches: aiPatches.map((p: AiPatch) => (p.id === patchId ? { ...p, isLoading: true, prompt } : p)),
        selection,
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
        applyAiEditCommand(({ aiPatches, selection }) => ({
          aiPatches: aiPatches.map((p: AiPatch) => (p.id === patchId ? { ...p, isLoading: false } : p)),
          selection,
        }));
      } finally {
        setEditor({ isGeneratingAi: false });
      }
    },
    [applyAiEditCommand, getToken, setEditor],
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
      const masks = selectEditDocumentMasks(useEditorStore.getState().editDocumentV2);
      commitEditNodeOperations([
        {
          nodeType: 'layers',
          patch: {
            masks: editDocumentLayersV2Schema.parse({ masks: masks.filter((c) => c.id !== containerId) }).masks,
          },
          type: 'patch-edit-document-node',
        },
      ]);
      if (activeMaskContainerId === containerId) {
        setEditor({ activeMaskContainerId: null, activeMaskId: null });
      }
    },
    [commitEditNodeOperations, setEditor],
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
    const { selectedImage, editDocumentV2: adjustments, patchResidency } = useEditorStore.getState();
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
        flipHorizontal: selectEditDocumentGeometry(adjustments).flipHorizontal,
        flipVertical: selectEditDocumentGeometry(adjustments).flipVertical,
        orientationSteps: selectEditDocumentGeometry(adjustments).orientationSteps,
        rotation: selectEditDocumentGeometry(adjustments).rotation,
      });

      const subMask = selectEditDocumentSourceArtifacts(adjustments)
        .aiPatches.flatMap((p: AiPatch) => p.subMasks)
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
    const { selectedImage, editDocumentV2: adjustments, patchResidency } = useEditorStore.getState();
    if (!selectedImage?.path) return;
    setEditor({ isGeneratingAiMask: true });

    try {
      const transformAdjustments = getTransformAdjustments(adjustments);
      const newParameters = await invoke<Record<string, unknown>>(Invokes.GenerateAiForegroundMask, {
        jsAdjustments: transformAdjustments,
        flipHorizontal: selectEditDocumentGeometry(adjustments).flipHorizontal,
        flipVertical: selectEditDocumentGeometry(adjustments).flipVertical,
        orientationSteps: selectEditDocumentGeometry(adjustments).orientationSteps,
        rotation: selectEditDocumentGeometry(adjustments).rotation,
      });

      const subMask = selectEditDocumentSourceArtifacts(adjustments)
        .aiPatches.flatMap((p: AiPatch) => p.subMasks)
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
    const initialState = useEditorStore.getState();
    const { selectedImage, editDocumentV2: adjustments, patchResidency } = initialState;
    if (!selectedImage?.path) return;
    const generationContext = captureAiMaskGenerationContext(initialState);
    setEditor({ isGeneratingAiMask: true });

    try {
      const transformAdjustments = getTransformAdjustments(adjustments);
      const newParameters = await invoke<Record<string, unknown>>(Invokes.GenerateAiWholePersonMask, {
        jsAdjustments: transformAdjustments,
        flipHorizontal: selectEditDocumentGeometry(adjustments).flipHorizontal,
        flipVertical: selectEditDocumentGeometry(adjustments).flipVertical,
        orientationSteps: selectEditDocumentGeometry(adjustments).orientationSteps,
        rotation: selectEditDocumentGeometry(adjustments).rotation,
      });

      const currentState = useEditorStore.getState();
      if (!isAiMaskGenerationCurrent(currentState, generationContext)) return;
      const subMask = findAiSubMask(currentState.editDocumentV2, subMaskId);
      const mergedParameters = mergeMaskParameters(subMask?.parameters, {
        ...newParameters,
        providerTier: getAiPeopleMaskPartCapability('full_person').providerTier,
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
    const initialState = useEditorStore.getState();
    const { selectedImage, editDocumentV2: adjustments, patchResidency } = initialState;
    if (!selectedImage?.path) return;

    const capability = getAiPeopleMaskPartCapability(part);
    const isCommandSupported = part === 'face' || part === 'full_person' || part === 'clothing' || part === 'hair';
    if (capability.validationMode !== 'runtime_apply' || !isCommandSupported) {
      toast.error(`AI ${part} Mask unavailable: ${capability.notes}`);
      return;
    }

    setEditor({ isGeneratingAiMask: true });
    const generationContext = captureAiMaskGenerationContext(initialState);

    try {
      const transformAdjustments = getTransformAdjustments(adjustments);
      const newParameters = await invoke<Record<string, unknown>>(Invokes.GenerateAiPersonPartMask, {
        jsAdjustments: transformAdjustments,
        part,
        flipHorizontal: selectEditDocumentGeometry(adjustments).flipHorizontal,
        flipVertical: selectEditDocumentGeometry(adjustments).flipVertical,
        orientationSteps: selectEditDocumentGeometry(adjustments).orientationSteps,
        rotation: selectEditDocumentGeometry(adjustments).rotation,
      });

      const currentState = useEditorStore.getState();
      if (!isAiMaskGenerationCurrent(currentState, generationContext)) return;
      const subMask = findAiSubMask(currentState.editDocumentV2, subMaskId);
      const target = aiPeopleMaskTargetSchema.safeParse(toMaskParameterRecord(subMask?.parameters)['target']);
      const mergedParameters = mergeMaskParameters(subMask?.parameters, {
        ...newParameters,
        providerTier: capability.providerTier,
        target: { part, personId: target.success ? target.data.personId : null },
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
    const { selectedImage, editDocumentV2: adjustments, patchResidency } = useEditorStore.getState();
    if (!selectedImage?.path) return;
    setEditor({ isGeneratingAiMask: true });

    try {
      const transformAdjustments = getTransformAdjustments(adjustments);
      const newParameters = await invoke<Record<string, unknown>>(Invokes.GenerateAiSkyMask, {
        jsAdjustments: transformAdjustments,
        flipHorizontal: selectEditDocumentGeometry(adjustments).flipHorizontal,
        flipVertical: selectEditDocumentGeometry(adjustments).flipVertical,
        orientationSteps: selectEditDocumentGeometry(adjustments).orientationSteps,
        rotation: selectEditDocumentGeometry(adjustments).rotation,
      });

      const subMask = selectEditDocumentSourceArtifacts(adjustments)
        .aiPatches.flatMap((p: AiPatch) => p.subMasks)
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
    const { editDocumentV2: adjustments } = useEditorStore.getState();
    const activeSubMask =
      selectEditDocumentMasks(adjustments)
        .flatMap((m: MaskContainer) => m.subMasks)
        .find((sm: SubMask) => sm.id === activeMaskId) ||
      selectEditDocumentSourceArtifacts(adjustments)
        .aiPatches.flatMap((p: AiPatch) => p.subMasks)
        .find((sm: SubMask) => sm.id === activeAiSubMaskId);

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
