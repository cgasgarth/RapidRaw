import { Image as ImageIcon, ShieldCheck } from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

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
    messages: [],
    runtimeStatus: 'runtime_apply_ready',
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
        summary: 'Image context is ready.',
        timestamp: 'now',
        title: selectedImagePath ? 'Image context' : 'Waiting for image selection',
        toolName: 'rawengine.live_context',
      },
    ],
  };
};

export function AgentPanel() {
  const { t } = useTranslation();
  const selectedImage = useEditorStore((state) => state.selectedImage);
  const initialPromptContext = useMemo(() => {
    if (selectedImage === null) return null;

    return buildAgentInitialPromptContext({
      operationId: `live-agent-initial-context-${selectedImage.path}`,
      prompt: `Inspect ${getImageLabelFromPath(selectedImage.path)} before planning edits.`,
      sessionId: `live-agent-${selectedImage.path}`,
    });
  }, [selectedImage]);
  const transcript = useMemo(
    () => buildLiveAgentTranscript(selectedImage?.path, initialPromptContext),
    [initialPromptContext, selectedImage?.path],
  );
  const targetLabel = selectedImage
    ? getImageLabelFromPath(selectedImage.path)
    : t('editor.ai.agent.workspace.noImage');
  const isReady = selectedImage?.isReady === true;

  return (
    <section
      aria-label={t('editor.ai.agent.title')}
      className="flex h-full min-w-0 flex-col overflow-hidden bg-editor-panel text-text-primary"
      data-review-workspace-state={isReady ? 'ready' : 'blocked'}
      data-testid="agent-right-rail-panel"
    >
      <header className="flex min-h-12 shrink-0 items-center gap-2 border-b border-editor-border px-2.5 py-1.5">
        <span
          aria-hidden="true"
          className="relative flex h-7 w-7 shrink-0 items-center justify-center overflow-hidden rounded border border-editor-border bg-editor-panel-well text-text-secondary"
        >
          <ImageIcon className="absolute" size={14} strokeWidth={1.8} />
          {selectedImage?.thumbnailUrl ? (
            <img
              alt=""
              className="absolute inset-0 h-full w-full object-cover"
              onError={(event) => {
                event.currentTarget.hidden = true;
              }}
              src={selectedImage.thumbnailUrl}
            />
          ) : null}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <h2 className="truncate text-[12px] font-semibold leading-4 text-text-primary">{targetLabel}</h2>
            {selectedImage ? (
              <span className="shrink-0 rounded-sm bg-editor-panel-well px-1 py-0.5 text-[9px] font-semibold leading-3 text-text-secondary">
                {selectedImage.isRaw ? 'RAW' : 'IMAGE'}
              </span>
            ) : null}
          </div>
          <p className="truncate text-[10px] leading-4 text-text-secondary" title={selectedImage?.path}>
            {selectedImage
              ? `${selectedImage.width} x ${selectedImage.height}`
              : t('editor.ai.agent.workspace.noImage')}
          </p>
        </div>
        <span
          aria-label={isReady ? 'Selected image ready for AI edits' : 'Selected image is not ready'}
          className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-sm ${
            isReady ? 'text-text-secondary' : 'text-text-tertiary'
          }`}
          data-tooltip={isReady ? 'Selected image ready' : t('editor.ai.agent.workspace.noImage')}
        >
          <ShieldCheck size={14} strokeWidth={1.8} />
        </span>
      </header>

      {isReady ? (
        <div className="min-h-0 flex-1 overflow-hidden px-2.5 py-2" data-testid="agent-photographer-workspace">
          <AgentChatShell transcript={transcript} />
        </div>
      ) : (
        <div className="grid min-h-0 flex-1 place-items-center px-5 text-center">
          <p className="max-w-52 text-[12px] leading-5 text-text-secondary">{t('editor.ai.agent.workspace.noImage')}</p>
        </div>
      )}
    </section>
  );
}
