import { useMemo } from 'react';
import type { AgentChatTranscript } from '../../../../schemas/agent/agentChatTranscriptSchemas';
import { useEditorStore } from '../../../../store/useEditorStore';
import {
  type AgentInitialPromptContext,
  buildAgentInitialPromptContext,
} from '../../../../utils/agent/context/agentInitialPromptContext';
import AgentChatShell from './AgentChatShell';

const getImageLabelFromPath = (path: string): string => {
  const cleanPath = path.split('?')[0] ?? path;
  return cleanPath.split(/[\\/]/u).pop() || cleanPath || 'selected RAW';
};

const buildLiveAgentTranscript = (
  selectedImagePath: string | undefined,
  initialPromptContext: AgentInitialPromptContext | null,
): AgentChatTranscript => {
  const targetLabel = selectedImagePath ? getImageLabelFromPath(selectedImagePath) : 'No image selected';
  const targetSummary = selectedImagePath
    ? `Ready to plan a local app-server edit for ${targetLabel}.`
    : 'Select an image before asking the agent to plan or apply edits.';
  const previewSummary =
    initialPromptContext === null
      ? null
      : `Initial prompt includes ${initialPromptContext.preview.encodedFormat.toUpperCase()} preview ${initialPromptContext.preview.artifactId}.`;

  return {
    id: selectedImagePath ? `live-agent-${targetLabel}` : 'live-agent-no-selection',
    initialPromptPreviewContext:
      initialPromptContext === null
        ? undefined
        : {
            accessScope: initialPromptContext.preview.accessScope,
            artifactId: initialPromptContext.preview.artifactId,
            colorProfile: initialPromptContext.modelInput.initialPreview.colorProfile,
            encodedFormat: initialPromptContext.preview.encodedFormat,
            graphRevision: initialPromptContext.modelInput.graphRevision,
            height: initialPromptContext.modelInput.initialPreview.height,
            includesOriginalRaw: initialPromptContext.modelInput.initialPreview.includesOriginalRaw,
            longEdgePx: initialPromptContext.preview.longEdgePx,
            mediaType: initialPromptContext.preview.mediaType,
            previewRef: initialPromptContext.preview.previewRef,
            purpose: initialPromptContext.preview.purpose,
            quality: initialPromptContext.preview.quality,
            recipeHash: initialPromptContext.preview.recipeHash,
            renderHash: initialPromptContext.preview.renderHash,
            toolName: initialPromptContext.preview.toolName,
            transport: initialPromptContext.modelInput.transport,
            width: initialPromptContext.modelInput.initialPreview.width,
          },
    messages: [
      {
        body: previewSummary === null ? targetSummary : `${targetSummary} ${previewSummary}`,
        id: 'live-agent-current-context',
        role: 'system',
        timestamp: 'now',
      },
    ],
    runtimeStatus: 'runtime_apply_demo',
    sessionTitle: selectedImagePath ? `Current image: ${targetLabel}` : 'No image selected',
    toolCalls: [
      {
        approvalState: 'not_required',
        id: 'live-agent-current-context-readiness',
        mode: 'read',
        provenance: {
          requestHash: 'sha256:0000000000000000',
          runtime: 'codex_app_server',
          schema: 'liveAgentCurrentContext.v1',
        },
        status: selectedImagePath ? 'succeeded' : 'blocked',
        summary: targetSummary,
        timestamp: 'now',
        title: selectedImagePath ? 'Current image context' : 'Waiting for image selection',
        toolName: 'rawengine.live_context',
      },
      ...(initialPromptContext === null
        ? []
        : [
            {
              approvalState: 'not_required',
              id: 'live-agent-initial-preview-context',
              mode: 'read',
              provenance: {
                requestHash: `sha256:${initialPromptContext.preview.renderHash.replace('render:', '').repeat(8)}`,
                runtime: 'codex_app_server',
                schema: 'agentInitialPromptContext.v1',
              },
              status: 'succeeded',
              summary: previewSummary ?? targetSummary,
              timestamp: 'now',
              title: 'Selected image preview',
              toolName: 'rawengine.image.get_preview',
            } satisfies AgentChatTranscript['toolCalls'][number],
          ]),
    ],
  };
};

export function AgentPanel() {
  const selectedImage = useEditorStore((state) => state.selectedImage);
  const initialPromptContext = useMemo(() => {
    if (selectedImage === null) return null;

    return buildAgentInitialPromptContext({
      operationId: `live-agent-initial-context-${selectedImage.path}`,
      prompt: `Inspect ${getImageLabelFromPath(selectedImage.path)} before planning edits.`,
      sessionId: `live-agent-${selectedImage.path}`,
    });
  }, [selectedImage]);

  return (
    <div className="h-full overflow-y-auto overflow-x-hidden p-4" data-testid="agent-right-rail-panel">
      <AgentChatShell transcript={buildLiveAgentTranscript(selectedImage?.path, initialPromptContext)} />
    </div>
  );
}
