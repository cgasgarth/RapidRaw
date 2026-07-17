import { invoke } from '@tauri-apps/api/core';
import { useCallback, useRef, useState } from 'react';
import { AiProviderId, normalizeAiProviderId } from '../../schemas/ai/aiProviderSchemas';
import { useEditorStore } from '../../store/useEditorStore';
import { useSettingsStore } from '../../store/useSettingsStore';
import { Invokes } from '../../tauri/commands';
import { prepareAiSubjectMaskAppServerTool } from '../../utils/ai/aiSubjectMaskAppServerTool';
import {
  acceptLightroomAiSceneMaskResult,
  buildLightroomAiSceneMaskTransaction,
  createLightroomAiSceneMaskAuthority,
  createLightroomAiSceneMaskContainer,
  createLightroomAiSceneMaskJob,
  type LightroomAiSceneMaskCapability,
  type LightroomAiSceneMaskJob,
  markLightroomAiSceneMaskCancelled,
  markLightroomAiSceneMaskFailed,
  markLightroomAiSceneMaskRunning,
  refineLightroomAiSceneMaskResult,
} from '../../utils/ai/lightroomAiSceneMaskGeneration';
import { selectEditDocumentGeometry } from '../../utils/editDocumentSelectors';
import { formatUnknownError } from '../../utils/errorFormatting';

type RuntimeMaskParameters = Record<string, unknown>;

const asRuntimeMaskParameters = (value: unknown): RuntimeMaskParameters => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('The mask provider returned an invalid result.');
  }
  return Object.fromEntries(Object.entries(value));
};

const readRuntimeParameter = (parameters: RuntimeMaskParameters, key: string): unknown => parameters[key];

export function useLightroomAiSceneMasks() {
  const aiProvider = useSettingsStore((state) => normalizeAiProviderId(state.appSettings?.aiProvider));
  const [job, setJob] = useState<LightroomAiSceneMaskJob | null>(null);
  const operationRef = useRef<{ cancelled: boolean; requestId: string } | null>(null);

  const cancel = useCallback(() => {
    const operation = operationRef.current;
    if (operation !== null) operation.cancelled = true;
    setJob((current) => (current === null ? null : markLightroomAiSceneMaskCancelled(current)));
    useEditorStore.getState().setEditor({ isGeneratingAiMask: false });
  }, []);

  const start = useCallback(
    async (capability: LightroomAiSceneMaskCapability) => {
      const state = useEditorStore.getState();
      const selectedImage = state.selectedImage;
      if (selectedImage === null || !selectedImage.path) {
        setJob(null);
        return;
      }
      const requestId = crypto.randomUUID();
      const operation = { cancelled: false, requestId };
      operationRef.current = operation;
      const authority = createLightroomAiSceneMaskAuthority({
        capability,
        cancellationToken: crypto.randomUUID(),
        imageSessionId: state.imageSession?.id ?? `editor-image-session:${String(state.imageSessionId)}`,
        modelVersion: 'runtime-v1',
        providerId: aiProvider,
        renderRevision: state.adjustmentRevision,
        requestId,
        sourceAssetIdentity: `${selectedImage.path}:${selectedImage.width}x${selectedImage.height}`,
        sourceGraphRevision: `adjustment:${String(state.adjustmentRevision)}`,
      });
      setJob(createLightroomAiSceneMaskJob(authority));
      useEditorStore.getState().setEditor({ isGeneratingAiMask: true });
      setJob((current) => (current === null ? null : markLightroomAiSceneMaskRunning(current)));

      try {
        const geometry = selectEditDocumentGeometry(state.editDocumentV2);
        const subjectTool =
          capability === 'subject'
            ? await prepareAiSubjectMaskAppServerTool({
                maskName: 'Subject mask',
                operationId: `lightroom-scene-${requestId}`,
                providerClass:
                  aiProvider === AiProviderId.Local
                    ? 'local_model'
                    : aiProvider === AiProviderId.Connector
                      ? 'self_hosted_connector'
                      : 'cloud_service',
                providerId: aiProvider,
                requestId,
                selectedImagePath: selectedImage.path,
              })
            : null;
        if (subjectTool?.status === 'blocked') throw new Error(subjectTool.userVisibleMessage);
        const payload =
          capability === 'subject'
            ? await invoke<RuntimeMaskParameters>(Invokes.GenerateAiSubjectMask, {
                endPoint: [1, 1],
                flipHorizontal: geometry.flipHorizontal,
                flipVertical: geometry.flipVertical,
                jsAdjustments: { ...geometry },
                orientationSteps: geometry.orientationSteps,
                path: selectedImage.path,
                rotation: geometry.rotation,
                startPoint: [0, 0],
              })
            : await invoke<RuntimeMaskParameters>(
                capability === 'sky' ? Invokes.GenerateAiSkyMask : Invokes.GenerateAiForegroundMask,
                {
                  flipHorizontal: geometry.flipHorizontal,
                  flipVertical: geometry.flipVertical,
                  jsAdjustments: { ...geometry },
                  orientationSteps: geometry.orientationSteps,
                  rotation: geometry.rotation,
                },
              );
        const latestState = useEditorStore.getState();
        const latestImage = latestState.selectedImage;
        const latestSessionId =
          latestState.imageSession?.id ?? `editor-image-session:${String(latestState.imageSessionId)}`;
        if (
          operation.cancelled ||
          operationRef.current?.requestId !== requestId ||
          latestSessionId !== authority.imageSessionId ||
          latestState.adjustmentRevision !== authority.renderRevision ||
          `${latestImage?.path ?? ''}:${latestImage?.width ?? 0}x${latestImage?.height ?? 0}` !==
            authority.sourceAssetIdentity
        ) {
          setJob((current) => (current === null ? null : markLightroomAiSceneMaskCancelled(current)));
          return;
        }
        const parameters = asRuntimeMaskParameters(payload);
        const maskDataBase64 = readRuntimeParameter(parameters, 'maskDataBase64');
        const generatedMaskArtifactId = readRuntimeParameter(parameters, 'generatedMaskArtifactId');
        const generatedMaskCoverage = readRuntimeParameter(parameters, 'generatedMaskCoverage');
        const subjectApplyResult = subjectTool?.status === 'prepared' ? await subjectTool.apply() : null;
        if (subjectApplyResult?.status === 'blocked') throw new Error(subjectApplyResult.userVisibleMessage);
        const accepted = acceptLightroomAiSceneMaskResult(
          { authority, errorMessage: null, progress: 0.9, result: null, status: 'running' },
          {
            authority,
            maskDataBase64: typeof maskDataBase64 === 'string' ? maskDataBase64 : null,
            generatedMaskArtifactId: typeof generatedMaskArtifactId === 'string' ? generatedMaskArtifactId : null,
            generatedMaskCoverage: typeof generatedMaskCoverage === 'number' ? generatedMaskCoverage : null,
            parameters: {
              ...parameters,
              ...(subjectTool?.status === 'prepared' && subjectApplyResult?.status === 'applied'
                ? {
                    rawEngine: {
                      dryRunPlanHash: subjectTool.dryRunResult.dryRunPlanHash,
                      dryRunPlanId: subjectTool.dryRunResult.dryRunPlanId,
                      appliedGraphRevision: subjectApplyResult.applyResult.appliedGraphRevision,
                      commandId: subjectApplyResult.applyResult.commandId,
                    },
                  }
                : {}),
            },
            previewUrl: null,
          },
        );
        if (accepted === null) throw new Error('The mask provider returned a stale or malformed result.');
        setJob(accepted);
      } catch (error) {
        if (!operation.cancelled && operationRef.current?.requestId === requestId) {
          setJob((current) =>
            current === null ? null : markLightroomAiSceneMaskFailed(current, formatUnknownError(error)),
          );
        }
      } finally {
        if (operationRef.current?.requestId === requestId)
          useEditorStore.getState().setEditor({ isGeneratingAiMask: false });
      }
    },
    [aiProvider],
  );

  const retry = useCallback(() => {
    const capability = job?.authority.capability;
    if (capability !== undefined) void start(capability);
  }, [job, start]);

  const refine = useCallback((parameters: RuntimeMaskParameters) => {
    setJob((current) => (current === null ? null : refineLightroomAiSceneMaskResult(current, parameters)));
  }, []);

  const apply = useCallback(() => {
    const current = job;
    if (current === null || current.status !== 'preview' || current.result === null) return false;
    const state = useEditorStore.getState();
    const currentSessionId = state.imageSession?.id ?? `editor-image-session:${String(state.imageSessionId)}`;
    if (
      current.authority.imageSessionId !== currentSessionId ||
      current.authority.renderRevision !== state.adjustmentRevision ||
      current.authority.sourceAssetIdentity !==
        `${state.selectedImage?.path ?? ''}:${state.selectedImage?.width ?? 0}x${state.selectedImage?.height ?? 0}`
    ) {
      setJob((jobState) => (jobState === null ? null : markLightroomAiSceneMaskCancelled(jobState)));
      return false;
    }
    const transaction = buildLightroomAiSceneMaskTransaction({
      baseAdjustmentRevision: state.adjustmentRevision,
      capability: current.authority.capability,
      document: state.editDocumentV2,
      imageSessionId: currentSessionId,
      result: current.result,
      ...(state.selectedImage === null
        ? {}
        : { imageDimensions: { width: state.selectedImage.width, height: state.selectedImage.height } }),
    });
    const result = state.applyEditTransaction(transaction);
    const container = createLightroomAiSceneMaskContainer({
      capability: current.authority.capability,
      result: current.result,
      ...(state.selectedImage === null
        ? {}
        : { imageDimensions: { width: state.selectedImage.width, height: state.selectedImage.height } }),
    });
    state.setEditor({ activeMaskContainerId: container.id, activeMaskId: container.subMasks[0]?.id ?? null });
    setJob((jobState) => (jobState === null ? null : { ...jobState, status: 'current' }));
    return !result.noOp;
  }, [job]);

  return { apply, cancel, job, refine, retry, start };
}
