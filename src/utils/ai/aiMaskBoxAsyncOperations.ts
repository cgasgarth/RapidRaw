import { toast } from 'react-toastify';
import { z } from 'zod';
import type { EditDocumentV2 } from '../../../packages/rawengine-schema/src/editDocumentV2';
import type { ViewerAiMaskBoxCommand } from '../../components/panel/editor/viewerAiMaskBoxInteractionController';
import type { SubMask } from '../../components/panel/right/layers/Masks';
import { AiProviderId, type AiProviderId as AiProviderIdType } from '../../schemas/ai/aiProviderSchemas';
import { parseAiPatchDataJson } from '../../schemas/masks/aiMaskingSchemas';
import { useEditorStore } from '../../store/useEditorStore';
import { Invokes } from '../../tauri/commands';
import type { AiPatch } from '../adjustments';
import {
  selectEditDocumentGeometry,
  selectEditDocumentMasks,
  selectEditDocumentNode,
  selectEditDocumentSourceArtifacts,
} from '../editDocumentSelectors';
import { formatUnknownError } from '../errorFormatting';
import { mergeMaskParameters } from '../mask/maskParameterAccess';
import { invokeWithSchema } from '../tauriSchemaInvoke';
import { type AiSubjectMaskToolAppliedResult, prepareAiSubjectMaskAppServerTool } from './aiSubjectMaskAppServerTool';

type SubMaskParameters = Record<string, unknown>;

const aiSubjectMaskParametersSchema = z.union([
  z
    .object({
      startX: z.number().finite(),
      startY: z.number().finite(),
      endX: z.number().finite(),
      endY: z.number().finite(),
      maskDataBase64: z.string().min(1).nullable(),
      rotation: z.number().finite().nullable(),
      flipHorizontal: z.boolean().nullable(),
      flipVertical: z.boolean().nullable(),
      orientationSteps: z.number().int().min(0).max(7).nullable(),
    })
    .strict(),
  z
    .object({
      generatedMaskArtifactId: z.string().min(1),
      generatedMaskCoverage: z.number().min(0).max(1),
    })
    .strict(),
]);

const generativePatchDataJsonSchema = z.string().min(1);

export interface AiMaskBoxAsyncRequest {
  readonly command: ViewerAiMaskBoxCommand;
  readonly commitParameters: (parameters: Readonly<SubMaskParameters>) => void;
  readonly isCurrent: () => boolean;
  readonly isLatestOperation: () => boolean;
}

const getTransformAdjustments = (document: EditDocumentV2) => ({
  ...selectEditDocumentGeometry(document),
  ...selectEditDocumentNode(document, 'lens_correction').params,
});

const findCommandSubMask = (document: EditDocumentV2, command: ViewerAiMaskBoxCommand): SubMask | null => {
  const masks = selectEditDocumentMasks(document);
  const aiPatches = selectEditDocumentSourceArtifacts(document).aiPatches;
  const containers = command.key.containerFamily === 'masks' ? masks : aiPatches;
  const siblingContainers = command.key.containerFamily === 'masks' ? aiPatches : masks;
  if (
    siblingContainers.some(
      (container) =>
        container.id === command.key.containerId || container.subMasks.some((subMask) => subMask.id === command.maskId),
    )
  )
    return null;
  const containerMatches = containers.filter((container) => container.id === command.key.containerId);
  if (containerMatches.length !== 1) return null;
  const subMaskMatches = containerMatches[0]?.subMasks.filter((subMask) => subMask.id === command.maskId) ?? [];
  if (subMaskMatches.length !== 1 || subMaskMatches[0]?.type !== command.key.tool) return null;
  return subMaskMatches[0] ?? null;
};

export const runQuickEraseBoxOperation = async (
  { command, isCurrent, isLatestOperation }: AiMaskBoxAsyncRequest,
  getToken: () => Promise<string | null>,
): Promise<void> => {
  const { selectedImage, editDocumentV2: adjustments, patchResidency, setEditor } = useEditorStore.getState();
  if (!isCurrent() || !selectedImage?.path || command.key.containerFamily !== 'aiPatches') return;
  const subMaskToUpdate = findCommandSubMask(adjustments, command);
  if (subMaskToUpdate === null) return;
  const token = await getToken();
  if (!isCurrent()) return;
  const patchId = command.key.containerId;
  setEditor({ isGeneratingAi: true });

  try {
    const newMaskParams = await invokeWithSchema(
      Invokes.GenerateAiSubjectMask,
      {
        jsAdjustments: getTransformAdjustments(adjustments),
        endPoint: [command.endPoint.x, command.endPoint.y],
        flipHorizontal: selectEditDocumentGeometry(adjustments).flipHorizontal,
        flipVertical: selectEditDocumentGeometry(adjustments).flipVertical,
        orientationSteps: selectEditDocumentGeometry(adjustments).orientationSteps,
        path: selectedImage.path,
        rotation: selectEditDocumentGeometry(adjustments).rotation,
        startPoint: [command.startPoint.x, command.startPoint.y],
      },
      aiSubjectMaskParametersSchema,
    );
    if (!isCurrent()) return;
    const finalSubMaskParams: SubMaskParameters = {
      ...((subMaskToUpdate.parameters as SubMaskParameters | undefined) ?? {}),
      ...command.parameters,
      ...newMaskParams,
    };
    const updatedAdjustmentsForBackend = {
      ...adjustments,
      aiPatches: selectEditDocumentSourceArtifacts(adjustments).aiPatches.map((patch: AiPatch) =>
        patch.id === patchId
          ? {
              ...patch,
              subMasks: patch.subMasks.map((subMask) =>
                subMask.id === command.maskId ? { ...subMask, parameters: finalSubMaskParams } : subMask,
              ),
            }
          : patch,
      ),
    };
    const patchDefinitionForBackend = updatedAdjustmentsForBackend.aiPatches.find((patch) => patch.id === patchId);
    const newPatchDataJson = await invokeWithSchema(
      Invokes.InvokeGenerativeReplaceWithMaskDef,
      {
        currentAdjustments: updatedAdjustmentsForBackend,
        patchDefinition: { ...patchDefinitionForBackend, prompt: '' },
        path: selectedImage.path,
        token: token || null,
        useFastInpaint: true,
      },
      generativePatchDataJsonSchema,
    );
    if (!isCurrent() || findCommandSubMask(useEditorStore.getState().editDocumentV2, command) === null) return;
    const newPatchData = parseAiPatchDataJson(newPatchDataJson);
    patchResidency.remove(patchId);
    useEditorStore.getState().applyAiEditCommand(({ aiPatches }) => {
      if (!isCurrent()) return null;
      const currentPatch = aiPatches.find((candidate) => candidate.id === patchId);
      const matches = currentPatch?.subMasks.filter((subMask) => subMask.id === command.maskId) ?? [];
      if (matches.length !== 1 || matches[0]?.type !== command.key.tool) return null;
      return {
        aiPatches: aiPatches.map((patch) =>
          patch.id === patchId
            ? {
                ...patch,
                isLoading: false,
                patchData: newPatchData,
                subMasks: patch.subMasks.map((subMask) =>
                  subMask.id === command.maskId ? { ...subMask, parameters: finalSubMaskParams } : subMask,
                ),
              }
            : patch,
        ),
        selection: { containerId: null, subMaskId: null },
      };
    });
  } catch (error) {
    if (isCurrent()) toast.error(`Quick Erase Failed: ${formatUnknownError(error)}`);
  } finally {
    if (isLatestOperation()) setEditor({ isGeneratingAi: false });
  }
};

export const runAiSubjectBoxOperation = async (
  { command, commitParameters, isCurrent, isLatestOperation }: AiMaskBoxAsyncRequest,
  aiProvider: AiProviderIdType,
): Promise<void> => {
  const { selectedImage, editDocumentV2: adjustments, patchResidency, setEditor } = useEditorStore.getState();
  if (!isCurrent() || !selectedImage?.path || findCommandSubMask(adjustments, command) === null) return;
  setEditor({ isGeneratingAiMask: true });

  try {
    const subjectMaskToolSession = await prepareAiSubjectMaskAppServerTool({
      maskName: 'Subject mask',
      operationId: `ai-subject-mask-${command.maskId}-${String(command.key.operationGeneration)}`,
      providerClass:
        aiProvider === AiProviderId.Local
          ? 'local_model'
          : aiProvider === AiProviderId.Connector
            ? 'self_hosted_connector'
            : 'cloud_service',
      providerId: aiProvider === AiProviderId.Local ? 'rawengine-local-ai' : aiProvider,
      requestId: `ai-subject-mask-${command.maskId}-${String(command.key.operationGeneration)}-request`,
      selectedImagePath: selectedImage.path,
    });
    if (!isCurrent()) return;
    if (subjectMaskToolSession.status === 'blocked') {
      toast.error(`AI Subject Mask unavailable: ${subjectMaskToolSession.userVisibleMessage}`);
      return;
    }

    const newParameters = await invokeWithSchema(
      Invokes.GenerateAiSubjectMask,
      {
        jsAdjustments: getTransformAdjustments(adjustments),
        endPoint: [command.endPoint.x, command.endPoint.y],
        flipHorizontal: selectEditDocumentGeometry(adjustments).flipHorizontal,
        flipVertical: selectEditDocumentGeometry(adjustments).flipVertical,
        orientationSteps: selectEditDocumentGeometry(adjustments).orientationSteps,
        path: selectedImage.path,
        rotation: selectEditDocumentGeometry(adjustments).rotation,
        startPoint: [command.startPoint.x, command.startPoint.y],
      },
      aiSubjectMaskParametersSchema,
    );
    if (!isCurrent()) return;
    const subjectMaskToolResult = await subjectMaskToolSession.apply();
    if (!isCurrent()) return;
    if (subjectMaskToolResult.status === 'blocked') {
      toast.error(`AI Mask Failed: ${subjectMaskToolResult.userVisibleMessage}`);
      return;
    }

    const subMask = findCommandSubMask(adjustments, command);
    if (subMask === null) return;
    const applyResult: AiSubjectMaskToolAppliedResult = subjectMaskToolResult;
    const mergedParameters = mergeMaskParameters(subMask.parameters, {
      ...command.parameters,
      ...newParameters,
      rawEngine: {
        acceptedDryRunPlanHash: applyResult.applyResult.dryRunPlanHash,
        acceptedDryRunPlanId: applyResult.applyResult.dryRunPlanId,
        appliedGraphRevision: applyResult.applyResult.appliedGraphRevision,
        auditEventId: applyResult.auditEvents.at(-1)?.eventId ?? null,
        commandId: applyResult.applyResult.commandId,
        dryRunPlanHash: applyResult.applyResult.dryRunPlanHash,
        dryRunPlanId: applyResult.applyResult.dryRunPlanId,
        maskArtifactId: applyResult.dryRunResult.maskArtifacts[0]?.artifactId ?? null,
        maskContentHash: applyResult.dryRunResult.maskArtifacts[0]?.contentHash ?? null,
        maskCoverageRatio: applyResult.dryRunResult.maskCoverageRatio,
        outputArtifactId: applyResult.applyResult.outputArtifacts[0]?.artifactId ?? null,
        outputContentHash: applyResult.applyResult.outputArtifacts[0]?.contentHash ?? null,
        previewArtifactId: applyResult.dryRunResult.previewArtifacts[0]?.artifactId ?? null,
        providerFallback: applyResult.auditEvents.at(-1)?.providerFallback ?? null,
        provenanceEntryIds: applyResult.applyResult.provenanceEntryIds,
        sourceGraphRevision: applyResult.applyResult.sourceGraphRevision,
        toolName: 'ai.mask.apply_subject',
        warnings: applyResult.applyResult.warnings,
      },
    });
    if (!isCurrent()) return;
    patchResidency.remove(command.maskId);
    commitParameters(mergedParameters);
  } catch (error) {
    if (isCurrent()) toast.error(`AI Mask Failed: ${formatUnknownError(error)}`);
  } finally {
    if (isLatestOperation()) setEditor({ isGeneratingAiMask: false });
  }
};
