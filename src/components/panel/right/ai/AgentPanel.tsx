import { ShieldCheck } from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import type { AgentChatTranscript } from '../../../../schemas/agent/agentChatTranscriptSchemas';
import { useEditorStore } from '../../../../store/useEditorStore';
import {
  type AgentInitialPromptContext,
  buildAgentInitialPromptContext,
} from '../../../../utils/agent/context/agentInitialPromptContext';
import {
  AGENT_APP_SERVER_DEFAULT_MODEL_LABEL,
  AGENT_APP_SERVER_DEFAULT_REASONING_EFFORT,
} from '../../../../utils/agent/session/agentAppServerModelSession';
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
      <header className="flex min-h-10 shrink-0 items-center gap-2 border-b border-editor-border px-2.5 py-1.5">
        <span
          aria-hidden="true"
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded border border-editor-border bg-editor-panel-well text-text-secondary"
        >
          <ShieldCheck size={14} strokeWidth={1.8} />
        </span>
        <div className="min-w-0">
          <h2 className="truncate text-[13px] font-semibold leading-5 text-text-primary">
            {t('editor.ai.agent.title')}
          </h2>
          <p className="truncate text-[11px] leading-4 text-text-secondary">{targetLabel}</p>
          <p
            className="truncate text-[10px] leading-3 text-text-tertiary"
            data-effective-reasoning-effort="pending"
            data-model-selection-status="pending"
            data-requested-model-id="gpt-5.6-terra"
            data-requested-reasoning-effort={AGENT_APP_SERVER_DEFAULT_REASONING_EFFORT}
            data-testid="agent-app-server-model-selection"
          >
            {t('editor.ai.agent.modelSelection.requested', { model: AGENT_APP_SERVER_DEFAULT_MODEL_LABEL })}
          </p>
        </div>
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
