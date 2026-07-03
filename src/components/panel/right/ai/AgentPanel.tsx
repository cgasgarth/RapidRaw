import { CheckCircle2, CircleDashed, Eye, FileCheck2, RotateCcw, ShieldCheck } from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { AgentChatTranscript } from '../../../../schemas/agent/agentChatTranscriptSchemas';
import { useEditorStore } from '../../../../store/useEditorStore';
import { buildAgentAppServerToolReadinessSummary } from '../../../../utils/agent/context/agentAppServerToolReadiness';
import {
  type AgentInitialPromptContext,
  buildAgentInitialPromptContext,
} from '../../../../utils/agent/context/agentInitialPromptContext';
import type { SelectedImage } from '../../../ui/AppProperties';
import { agentReviewWorkspaceTokens } from '../../../ui/inspectorTokens';
import AgentChatShell from './AgentChatShell';

type AgentReviewWorkspaceStateId =
  | 'applied'
  | 'approval-required'
  | 'audit-persisted'
  | 'blocked'
  | 'dry-run-ready'
  | 'no-selection'
  | 'preview-ready';

export type AgentReviewWorkspaceState = Record<AgentReviewWorkspaceStateId, boolean>;

export const resolveAgentReviewWorkspaceState = ({
  hasAppliedEdit,
  hasPreviewReceipt,
  selectedImage,
}: {
  hasAppliedEdit: boolean;
  hasPreviewReceipt: boolean;
  selectedImage: Pick<SelectedImage, 'isReady' | 'path'> | null;
}): AgentReviewWorkspaceState => {
  const hasSelection = selectedImage !== null;
  const selectionReady = hasSelection && selectedImage.isReady;

  return {
    applied: hasAppliedEdit,
    'approval-required': selectionReady && hasPreviewReceipt,
    'audit-persisted': hasPreviewReceipt,
    blocked: !selectionReady,
    'dry-run-ready': selectionReady && hasPreviewReceipt,
    'no-selection': !hasSelection,
    'preview-ready': selectionReady && hasPreviewReceipt,
  };
};

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
  const { t } = useTranslation();
  const selectedImage = useEditorStore((state) => state.selectedImage);
  const historyIndex = useEditorStore((state) => state.historyIndex);
  const lastBasicToneCommand = useEditorStore((state) => state.lastBasicToneCommand);
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
  const readiness = useMemo(() => buildAgentAppServerToolReadinessSummary(), []);
  const reviewState = resolveAgentReviewWorkspaceState({
    hasAppliedEdit: lastBasicToneCommand !== null || historyIndex > 0,
    hasPreviewReceipt: initialPromptContext !== null,
    selectedImage,
  });
  const targetLabel = selectedImage
    ? getImageLabelFromPath(selectedImage.path)
    : t('editor.ai.agent.workspace.noImage');
  const preview = initialPromptContext?.preview;

  return (
    <div
      className="h-full min-w-0 overflow-y-auto overflow-x-hidden bg-editor-panel text-text-primary"
      data-review-workspace-state={reviewState.blocked ? 'blocked' : 'ready'}
      data-testid="agent-right-rail-panel"
    >
      <div className="space-y-2 p-2" data-testid="agent-review-workspace">
        <header
          className="flex min-h-9 items-center justify-between gap-2 border-b border-editor-border pb-2"
          data-testid="agent-review-workspace-header"
        >
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 text-[13px] font-semibold leading-5">
              <ShieldCheck size={15} />
              <span>{t('editor.ai.agent.workspace.title')}</span>
            </div>
            <p className="truncate text-[11px] leading-4 text-text-secondary">{targetLabel}</p>
          </div>
          <span
            className={`${agentReviewWorkspaceTokens.chip} ${
              reviewState.blocked ? agentReviewWorkspaceTokens.stateBlocked : agentReviewWorkspaceTokens.stateActive
            } shrink-0`}
            data-testid="agent-review-workspace-status"
          >
            {reviewState.blocked ? t('editor.ai.agent.workspace.blocked') : t('editor.ai.agent.workspace.reviewReady')}
          </span>
        </header>

        <section
          className={agentReviewWorkspaceTokens.card}
          data-artifact-id={preview?.artifactId ?? ''}
          data-image-path={selectedImage?.path ?? ''}
          data-preview-ready={String(reviewState['preview-ready'])}
          data-recipe-hash={preview?.recipeHash ?? ''}
          data-render-hash={preview?.renderHash ?? ''}
          data-testid="agent-preview-receipt-card"
        >
          <div className="flex items-start gap-2">
            <div className="h-14 w-14 shrink-0 overflow-hidden rounded border border-editor-border bg-editor-panel">
              {initialPromptContext === null ? (
                <div className="grid h-full place-items-center text-text-tertiary">
                  <Eye size={16} />
                </div>
              ) : (
                <img
                  alt={t('editor.ai.agent.initialPreviewContext.title')}
                  className="h-full w-full object-cover"
                  src={initialPromptContext.modelInput.initialPreview.previewRef}
                />
              )}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between gap-2">
                <span className={agentReviewWorkspaceTokens.sectionTitle}>
                  {t('editor.ai.agent.workspace.previewReceipt')}
                </span>
                <span
                  className={`${agentReviewWorkspaceTokens.chip} ${
                    reviewState['preview-ready']
                      ? agentReviewWorkspaceTokens.stateActive
                      : agentReviewWorkspaceTokens.stateInactive
                  }`}
                  data-testid="agent-review-state-preview-ready"
                  data-state={reviewState['preview-ready'] ? 'active' : 'inactive'}
                >
                  {t('editor.ai.agent.workspace.previewReady')}
                </span>
              </div>
              <dl className="mt-1 grid grid-cols-[4.1rem_minmax(0,1fr)] gap-x-2 gap-y-1">
                <dt className={agentReviewWorkspaceTokens.label}>
                  {t('editor.ai.agent.previewLineage.meta.artifact')}
                </dt>
                <dd className={agentReviewWorkspaceTokens.metaValue}>{preview?.artifactId ?? 'none'}</dd>
                <dt className={agentReviewWorkspaceTokens.label}>
                  {t('editor.ai.agent.previewLineage.meta.renderHash')}
                </dt>
                <dd className={agentReviewWorkspaceTokens.metaValue}>{preview?.renderHash ?? 'waiting'}</dd>
                <dt className={agentReviewWorkspaceTokens.label}>
                  {t('editor.ai.agent.previewLineage.meta.recipeHash')}
                </dt>
                <dd className={agentReviewWorkspaceTokens.metaValue}>{preview?.recipeHash ?? 'waiting'}</dd>
              </dl>
            </div>
          </div>
        </section>

        <section className={agentReviewWorkspaceTokens.card} data-testid="agent-review-state-strip">
          <div className="grid grid-cols-2 gap-1">
            {(
              [
                'no-selection',
                'blocked',
                'dry-run-ready',
                'approval-required',
                'applied',
                'audit-persisted',
              ] satisfies AgentReviewWorkspaceStateId[]
            ).map((stateId) => (
              <span
                className={`${agentReviewWorkspaceTokens.chip} ${
                  reviewState[stateId]
                    ? stateId === 'blocked' || stateId === 'no-selection'
                      ? agentReviewWorkspaceTokens.stateBlocked
                      : agentReviewWorkspaceTokens.stateActive
                    : agentReviewWorkspaceTokens.stateInactive
                }`}
                data-state={reviewState[stateId] ? 'active' : 'inactive'}
                data-testid={`agent-review-state-${stateId}`}
                key={stateId}
              >
                {reviewState[stateId] ? <CheckCircle2 size={11} /> : <CircleDashed size={11} />}
                <span className="truncate">{t(`editor.ai.agent.workspace.states.${stateId}`)}</span>
              </span>
            ))}
          </div>
        </section>

        <section className={agentReviewWorkspaceTokens.card} data-testid="agent-tool-readiness-chip-row">
          <div className="flex flex-wrap gap-1">
            <span className={`${agentReviewWorkspaceTokens.chip} ${agentReviewWorkspaceTokens.stateActive}`}>
              {t('editor.ai.agent.readiness.tools')} <span className="font-mono">{readiness.toolCount}</span>
            </span>
            <span className={`${agentReviewWorkspaceTokens.chip} ${agentReviewWorkspaceTokens.stateActive}`}>
              {t('editor.ai.agent.readiness.dryRuns')} <span className="font-mono">{readiness.dryRunRouteCount}</span>
            </span>
            <span className={`${agentReviewWorkspaceTokens.chip} ${agentReviewWorkspaceTokens.stateActive}`}>
              {t('editor.ai.agent.readiness.applies')} <span className="font-mono">{readiness.applyRouteCount}</span>
            </span>
            <span className={`${agentReviewWorkspaceTokens.chip} ${agentReviewWorkspaceTokens.stateActive}`}>
              {t('editor.ai.agent.workspace.audit')} <span className="font-mono">{readiness.runtimeCheckCount}</span>
            </span>
          </div>
        </section>

        <section
          className={agentReviewWorkspaceTokens.card}
          data-approval-required={String(reviewState['approval-required'])}
          data-testid="agent-dry-run-apply-review-controls"
        >
          <div className="grid grid-cols-2 gap-1">
            <button
              className={`${agentReviewWorkspaceTokens.actionButton} border-sky-500/30 bg-sky-500/10 text-sky-100`}
              data-testid="agent-review-control-dry-run"
              disabled={!reviewState['dry-run-ready']}
              type="button"
            >
              <Eye size={13} />
              {t('editor.ai.agent.composer.dryRun')}
            </button>
            <button
              className={`${agentReviewWorkspaceTokens.actionButton} border-amber-500/30 bg-amber-500/10 text-amber-100`}
              data-testid="agent-review-control-apply"
              disabled={!reviewState['approval-required']}
              type="button"
            >
              <CheckCircle2 size={13} />
              {t('editor.ai.agent.actions.approveApply')}
            </button>
            <button
              className={`${agentReviewWorkspaceTokens.actionButton} border-teal-500/30 bg-teal-500/10 text-teal-100`}
              data-testid="agent-review-control-export"
              disabled={!reviewState['audit-persisted']}
              type="button"
            >
              <FileCheck2 size={13} />
              {t('editor.ai.agent.actions.exportAudit')}
            </button>
            <button
              className={`${agentReviewWorkspaceTokens.actionButton} border-red-500/30 bg-red-500/10 text-red-100`}
              data-testid="agent-review-control-rollback"
              disabled={!reviewState.applied}
              type="button"
            >
              <RotateCcw size={13} />
              {t('editor.ai.agent.actions.revert')}
            </button>
          </div>
        </section>

        <section className={agentReviewWorkspaceTokens.card} data-testid="agent-review-live-activity-timeline">
          <div className="mb-1 flex items-center justify-between gap-2">
            <span className={agentReviewWorkspaceTokens.sectionTitle}>{t('editor.ai.agent.timeline.title')}</span>
            <span className="font-mono text-[10px] text-text-tertiary">{transcript.toolCalls.length}</span>
          </div>
          <div className="space-y-1">
            {transcript.toolCalls.slice(0, 3).map((toolCall) => (
              <div
                className="grid grid-cols-[0.5rem_minmax(0,1fr)_auto] items-center gap-1 text-[11px] leading-4"
                data-status={toolCall.status}
                data-testid={`agent-review-live-activity-${toolCall.id}`}
                key={toolCall.id}
              >
                <span
                  className={`h-1.5 w-1.5 rounded-full ${
                    toolCall.status === 'succeeded' ? 'bg-emerald-300' : 'bg-amber-300'
                  }`}
                />
                <span className="truncate text-text-primary">{toolCall.title}</span>
                <span className="font-mono text-[10px] text-text-tertiary">{toolCall.mode}</span>
              </div>
            ))}
          </div>
        </section>

        <div data-testid="agent-review-transcript-lower">
          <AgentChatShell transcript={transcript} />
        </div>
      </div>
    </div>
  );
}
