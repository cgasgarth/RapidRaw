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
  markLightroomAiSceneMaskUnavailable,
  refineLightroomAiSceneMaskResult,
} from '../../utils/ai/lightroomAiSceneMaskGeneration';
import { selectEditDocumentGeometry, selectEditDocumentNode } from '../../utils/editDocumentSelectors';
import { formatUnknownError } from '../../utils/errorFormatting';

type RuntimeMaskParameters = Record<string, unknown>;

const LOCAL_RUNTIME_PROVIDER_ID = 'rawengine-local-ai';

const toRuntimeProviderId = (providerId: AiProviderId): string =>
  providerId === AiProviderId.Local ? LOCAL_RUNTIME_PROVIDER_ID : providerId;

const toRuntimeProviderClass = (
  providerId: AiProviderId,
): 'cloud_service' | 'local_model' | 'self_hosted_connector' => {
  if (providerId === AiProviderId.Local) return 'local_model';
  if (providerId === AiProviderId.Connector) return 'self_hosted_connector';
  return 'cloud_service';
};

const sceneMaskSourceAssetIdentity = (selectedImage: { path: string; width: number; height: number } | null): string =>
  `${selectedImage?.path ?? ''}:${selectedImage?.width ?? 0}x${selectedImage?.height ?? 0}`;

const asRuntimeMaskParameters = (value: unknown): RuntimeMaskParameters => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('The mask provider returned an invalid result.');
  }
  return Object.fromEntries(Object.entries(value));
};

const readRuntimeParameter = (parameters: RuntimeMaskParameters, key: string): unknown => parameters[key];

type PreparedSubjectMaskTool = Extract<
  Awaited<ReturnType<typeof prepareAiSubjectMaskAppServerTool>>,
  { status: 'prepared' }
>;

type SceneMaskRuntimeResult =
  | { payload: RuntimeMaskParameters; status: 'ready'; subjectTool: PreparedSubjectMaskTool | null }
  | { message: string; status: 'unavailable' };

const invokeSceneMaskRuntime = async (input: {
  capability: LightroomAiSceneMaskCapability;
  geometry: ReturnType<typeof selectEditDocumentGeometry>;
  providerClass: 'cloud_service' | 'local_model' | 'self_hosted_connector';
  providerId: string;
  requestId: string;
  selectedImagePath: string;
  transformAdjustments: Record<string, unknown>;
}): Promise<SceneMaskRuntimeResult> => {
  let subjectTool: PreparedSubjectMaskTool | null = null;
  if (input.capability === 'subject') {
    const prepared = await prepareAiSubjectMaskAppServerTool({
      maskName: 'Subject mask',
      operationId: `lightroom-scene-${input.requestId}`,
      providerClass: input.providerClass,
      providerId: input.providerId,
      requestId: input.requestId,
      selectedImagePath: input.selectedImagePath,
    });
    if (prepared.status === 'blocked') return { message: prepared.userVisibleMessage, status: 'unavailable' };
    subjectTool = prepared;
  }

  const payload =
    input.capability === 'subject'
      ? await invoke<RuntimeMaskParameters>(Invokes.GenerateAiSubjectMask, {
          endPoint: [1, 1],
          flipHorizontal: input.geometry.flipHorizontal,
          flipVertical: input.geometry.flipVertical,
          jsAdjustments: input.transformAdjustments,
          orientationSteps: input.geometry.orientationSteps,
          path: input.selectedImagePath,
          rotation: input.geometry.rotation,
          startPoint: [0, 0],
        })
      : await invoke<RuntimeMaskParameters>(
          input.capability === 'sky' ? Invokes.GenerateAiSkyMask : Invokes.GenerateAiForegroundMask,
          {
            flipHorizontal: input.geometry.flipHorizontal,
            flipVertical: input.geometry.flipVertical,
            jsAdjustments: input.transformAdjustments,
            orientationSteps: input.geometry.orientationSteps,
            rotation: input.geometry.rotation,
          },
        );
  return { payload, status: 'ready', subjectTool };
};

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
        if (operationRef.current !== null) operationRef.current.cancelled = true;
        operationRef.current = null;
        setJob(null);
        useEditorStore.getState().setEditor({ isGeneratingAiMask: false });
        return;
      }
      const requestId = crypto.randomUUID();
      const operation = { cancelled: false, requestId };
      operationRef.current = operation;
      const runtimeProviderId = toRuntimeProviderId(aiProvider);
      const authority = createLightroomAiSceneMaskAuthority({
        capability,
        cancellationToken: crypto.randomUUID(),
        imageSessionId: state.imageSession?.id ?? `editor-image-session:${String(state.imageSessionId)}`,
        modelVersion: 'runtime-v1',
        providerId: runtimeProviderId,
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
        const transformAdjustments = {
          ...geometry,
          ...selectEditDocumentNode(state.editDocumentV2, 'lens_correction').params,
        };
        const runtimeResult = await invokeSceneMaskRuntime({
          capability,
          geometry,
          providerClass: toRuntimeProviderClass(aiProvider),
          providerId: runtimeProviderId,
          requestId,
          selectedImagePath: selectedImage.path,
          transformAdjustments,
        });
        if (runtimeResult.status === 'unavailable') {
          setJob((current) =>
            current?.authority.requestId === requestId
              ? markLightroomAiSceneMaskUnavailable(current, runtimeResult.message)
              : current,
          );
          return;
        }
        const latestState = useEditorStore.getState();
        const latestSessionId =
          latestState.imageSession?.id ?? `editor-image-session:${String(latestState.imageSessionId)}`;
        const isCurrent =
          !operation.cancelled &&
          operationRef.current?.requestId === requestId &&
          latestSessionId === authority.imageSessionId &&
          latestState.adjustmentRevision === authority.renderRevision &&
          sceneMaskSourceAssetIdentity(latestState.selectedImage) === authority.sourceAssetIdentity;
        if (!isCurrent) {
          setJob((current) =>
            current?.authority.requestId === requestId ? markLightroomAiSceneMaskCancelled(current) : current,
          );
          return;
        }
        const parameters = asRuntimeMaskParameters(runtimeResult.payload);
        const maskDataBase64 = readRuntimeParameter(parameters, 'maskDataBase64');
        const generatedMaskArtifactId = readRuntimeParameter(parameters, 'generatedMaskArtifactId');
        const generatedMaskCoverage = readRuntimeParameter(parameters, 'generatedMaskCoverage');
        const subjectApplyResult = runtimeResult.subjectTool === null ? null : await runtimeResult.subjectTool.apply();
        if (subjectApplyResult?.status === 'blocked') {
          setJob((current) =>
            current?.authority.requestId === requestId
              ? markLightroomAiSceneMaskUnavailable(current, subjectApplyResult.userVisibleMessage)
              : current,
          );
          return;
        }
        const postApplyState = useEditorStore.getState();
        const postApplySessionId =
          postApplyState.imageSession?.id ?? `editor-image-session:${String(postApplyState.imageSessionId)}`;
        const isCurrentAfterSubjectApply =
          !operation.cancelled &&
          operationRef.current?.requestId === requestId &&
          postApplySessionId === authority.imageSessionId &&
          postApplyState.adjustmentRevision === authority.renderRevision &&
          sceneMaskSourceAssetIdentity(postApplyState.selectedImage) === authority.sourceAssetIdentity;
        if (!isCurrentAfterSubjectApply) {
          setJob((current) =>
            current?.authority.requestId === requestId ? markLightroomAiSceneMaskCancelled(current) : current,
          );
          return;
        }
        const accepted = acceptLightroomAiSceneMaskResult(
          { authority, errorMessage: null, progress: 0.9, result: null, status: 'running' },
          {
            authority,
            maskDataBase64: typeof maskDataBase64 === 'string' ? maskDataBase64 : null,
            generatedMaskArtifactId: typeof generatedMaskArtifactId === 'string' ? generatedMaskArtifactId : null,
            generatedMaskCoverage: typeof generatedMaskCoverage === 'number' ? generatedMaskCoverage : null,
            parameters: {
              ...parameters,
              ...(runtimeResult.subjectTool !== null && subjectApplyResult?.status === 'applied'
                ? {
                    rawEngine: {
                      dryRunPlanHash: runtimeResult.subjectTool.dryRunResult.dryRunPlanHash,
                      dryRunPlanId: runtimeResult.subjectTool.dryRunResult.dryRunPlanId,
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
    if (result.noOp) return false;
    const container = createLightroomAiSceneMaskContainer({
      capability: current.authority.capability,
      result: current.result,
      ...(state.selectedImage === null
        ? {}
        : { imageDimensions: { width: state.selectedImage.width, height: state.selectedImage.height } }),
    });
    state.setEditor({ activeMaskContainerId: container.id, activeMaskId: container.subMasks[0]?.id ?? null });
    setJob((jobState) => (jobState === null ? null : { ...jobState, status: 'current' }));
    return true;
  }, [job]);

  return { apply, cancel, job, refine, retry, start };
}
