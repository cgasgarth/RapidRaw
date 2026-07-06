import {
  CheckCircle2,
  CircleDashed,
  Eye,
  FileCheck2,
  GitCompareArrows,
  RotateCcw,
  ShieldCheck,
  SlidersHorizontal,
} from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { AgentChatTranscript } from '../../../../schemas/agent/agentChatTranscriptSchemas';
import type { AgentSelectedImagePreviewReceipt } from '../../../../schemas/agent/agentSelectedImagePreviewReceiptSchemas';
import { useEditorStore } from '../../../../store/useEditorStore';
import { buildAgentAppServerToolReadinessSummary } from '../../../../utils/agent/context/agentAppServerToolReadiness';
import {
  type AgentInitialPromptContext,
  buildAgentInitialPromptContext,
} from '../../../../utils/agent/context/agentInitialPromptContext';
import type { SelectedImage } from '../../../ui/AppProperties';
import { agentReviewWorkspaceTokens } from '../../../ui/inspectorTokens';
import AgentChatShell from './AgentChatShell';
import { useAgentSelectedImageWorkspaceController } from './useAgentSelectedImageWorkspaceController';

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
  canApply,
  canDryRun,
  canRollback,
  hasAppliedEdit,
  hasAuditRecord,
  hasPreviewReceipt,
  liveActionBlocked,
  selectedImage,
}: {
  canApply?: boolean;
  canDryRun?: boolean;
  canRollback?: boolean;
  hasAppliedEdit: boolean;
  hasAuditRecord?: boolean;
  hasPreviewReceipt: boolean;
  liveActionBlocked?: boolean;
  selectedImage: Pick<SelectedImage, 'isReady' | 'path'> | null;
}): AgentReviewWorkspaceState => {
  const hasSelection = selectedImage !== null;
  const selectionReady = hasSelection && selectedImage.isReady;

  return {
    applied: canRollback ?? hasAppliedEdit,
    'approval-required': canApply ?? (selectionReady && hasPreviewReceipt),
    'audit-persisted': hasAuditRecord ?? hasPreviewReceipt,
    blocked: !selectionReady || liveActionBlocked === true,
    'dry-run-ready': canDryRun ?? (selectionReady && hasPreviewReceipt),
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

const shortReceiptValue = (value: string): string => {
  const markerIndex = value.indexOf(':');
  const prefix = markerIndex === -1 ? '' : `${value.slice(0, markerIndex + 1)}`;
  const body = markerIndex === -1 ? value : value.slice(markerIndex + 1);
  return `${prefix}${body.slice(0, 12)}`;
};

function AgentBeforeAfterReceiptCard({ receipt }: { receipt: AgentSelectedImagePreviewReceipt }) {
  const { t } = useTranslation();
  const receiptTitle =
    receipt.kind === 'apply' ? t('editor.ai.agent.composer.applyReceipt') : t('editor.ai.agent.composer.dryRun');

  return (
    <section
      className={agentReviewWorkspaceTokens.card}
      data-after-artifact-id={receipt.after.artifactId}
      data-after-graph-revision={receipt.after.graphRevision}
      data-after-recipe-hash={receipt.after.recipeHash}
      data-after-render-hash={receipt.after.renderHash}
      data-before-artifact-id={receipt.before.artifactId}
      data-before-graph-revision={receipt.before.graphRevision}
      data-before-recipe-hash={receipt.before.recipeHash}
      data-before-render-hash={receipt.before.renderHash}
      data-receipt-kind={receipt.kind}
      data-receipt-request-id={receipt.requestId}
      data-receipt-state={receipt.state}
      data-stale-reason={receipt.staleReason ?? ''}
      data-testid="agent-before-after-preview-receipt"
      data-tool-name={receipt.toolName}
    >
      <div className="mb-1 flex items-center justify-between gap-2">
        <span className={`${agentReviewWorkspaceTokens.sectionTitle} inline-flex min-w-0 items-center gap-1.5`}>
          <GitCompareArrows size={12} />
          <span className="truncate">{receiptTitle}</span>
        </span>
        <span
          className={`${agentReviewWorkspaceTokens.chip} ${
            receipt.state === 'current'
              ? agentReviewWorkspaceTokens.stateActive
              : agentReviewWorkspaceTokens.stateBlocked
          }`}
          data-testid="agent-before-after-preview-receipt-state"
        >
          {receipt.state}
        </span>
      </div>
      <div className="grid grid-cols-2 gap-1.5">
        {([receipt.before, receipt.after] as const).map((side) => (
          <div
            className="min-w-0 rounded border border-editor-border bg-editor-panel p-1"
            data-artifact-id={side.artifactId}
            data-graph-revision={side.graphRevision}
            data-preview-ref={side.previewRef ?? ''}
            data-recipe-hash={side.recipeHash}
            data-render-hash={side.renderHash}
            data-testid={`agent-before-after-preview-receipt-${side.role}`}
            data-tool-name={side.toolName ?? ''}
            key={side.role}
          >
            <div className="mb-1 flex items-center justify-between gap-1">
              <span className={agentReviewWorkspaceTokens.label}>
                {side.role === 'before'
                  ? t('editor.ai.agent.previewLineage.role.before')
                  : t('editor.ai.agent.proposal.after')}
              </span>
              <span className="truncate font-mono text-[9px] leading-3 text-text-tertiary">
                {shortReceiptValue(side.graphRevision)}
              </span>
            </div>
            <div className="mb-1 aspect-[4/3] overflow-hidden rounded-sm border border-editor-border bg-editor-panel-well">
              {side.previewRef === undefined ? (
                <div className="grid h-full place-items-center px-1 text-center font-mono text-[9px] leading-3 text-text-tertiary">
                  {shortReceiptValue(side.renderHash)}
                </div>
              ) : (
                <img
                  alt={
                    side.role === 'before'
                      ? t('editor.ai.agent.previewLineage.role.before')
                      : t('editor.ai.agent.proposal.after')
                  }
                  className="h-full w-full object-cover"
                  src={side.previewRef}
                />
              )}
            </div>
            <dl className="grid grid-cols-[2.7rem_minmax(0,1fr)] gap-x-1 gap-y-0.5">
              <dt className={agentReviewWorkspaceTokens.label}>
                {t('editor.ai.agent.previewLineage.meta.renderHash')}
              </dt>
              <dd className={agentReviewWorkspaceTokens.metaValue}>{shortReceiptValue(side.renderHash)}</dd>
              <dt className={agentReviewWorkspaceTokens.label}>
                {t('editor.ai.agent.previewLineage.meta.recipeHash')}
              </dt>
              <dd className={agentReviewWorkspaceTokens.metaValue}>{shortReceiptValue(side.recipeHash)}</dd>
            </dl>
          </div>
        ))}
      </div>
      <dl className="mt-1 grid grid-cols-[3.6rem_minmax(0,1fr)] gap-x-2 gap-y-0.5">
        <dt className={agentReviewWorkspaceTokens.label}>{t('editor.ai.agent.previewLineage.meta.tool')}</dt>
        <dd className={agentReviewWorkspaceTokens.metaValue}>{receipt.toolName}</dd>
        <dt className={agentReviewWorkspaceTokens.label}>{t('editor.ai.agent.previewLineage.meta.request')}</dt>
        <dd className={agentReviewWorkspaceTokens.metaValue}>{receipt.requestId}</dd>
      </dl>
    </section>
  );
}

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
  const liveWorkspaceController = useAgentSelectedImageWorkspaceController({ selectedImage });
  const reviewState = resolveAgentReviewWorkspaceState({
    canApply: liveWorkspaceController.canApply,
    canDryRun: liveWorkspaceController.canDryRun,
    canRollback: liveWorkspaceController.canRollback,
    hasAppliedEdit: lastBasicToneCommand !== null || historyIndex > 0,
    hasAuditRecord: liveWorkspaceController.auditRecord !== null,
    hasPreviewReceipt: initialPromptContext !== null,
    liveActionBlocked: liveWorkspaceController.status === 'blocked',
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
          data-command-id={liveWorkspaceController.selectedCommandPlan.receipt.commandId}
          data-command-intensity={liveWorkspaceController.selectedCommandPlan.receipt.intensity}
          data-testid="agent-reviewed-command-composer"
        >
          <div className="mb-2 flex items-center justify-between gap-2">
            <span className={agentReviewWorkspaceTokens.sectionTitle}>
              {t('editor.ai.agent.workspace.reviewedCommand')}
            </span>
            <span className={`${agentReviewWorkspaceTokens.chip} ${agentReviewWorkspaceTokens.stateActive}`}>
              <SlidersHorizontal size={11} />
              {liveWorkspaceController.selectedCommandPlan.receipt.intensity}
            </span>
          </div>
          <div className="grid grid-cols-2 gap-1" role="listbox">
            {liveWorkspaceController.reviewedCommandOptions.map((command) => {
              const selected = command.id === liveWorkspaceController.selectedCommandId;
              return (
                <button
                  aria-selected={selected}
                  className={`${agentReviewWorkspaceTokens.actionButton} ${
                    selected
                      ? 'border-sky-500/40 bg-sky-500/15 text-sky-100'
                      : 'border-editor-border bg-editor-panel text-text-secondary'
                  }`}
                  data-command-id={command.id}
                  data-command-intensity={command.intensity}
                  data-selected={String(selected)}
                  data-testid={`agent-reviewed-command-option-${command.id}`}
                  disabled={!liveWorkspaceController.canDryRun}
                  key={command.id}
                  onClick={() => {
                    liveWorkspaceController.actions.selectCommand(command.id);
                  }}
                  role="option"
                  title={command.description}
                  type="button"
                >
                  <SlidersHorizontal size={13} />
                  {command.label}
                </button>
              );
            })}
          </div>
          <dl className="mt-2 grid grid-cols-[minmax(0,1fr)_auto_auto] gap-x-2 gap-y-1 text-[11px] leading-4">
            {liveWorkspaceController.selectedCommandPlan.receipt.adjustmentDiffs.map((diff) => (
              <div
                className="contents"
                data-after={diff.after}
                data-before={diff.before}
                data-delta={diff.delta}
                data-key={diff.key}
                data-testid={`agent-reviewed-command-diff-${diff.key}`}
                key={diff.key}
              >
                <dt className="truncate text-text-secondary">{diff.key}</dt>
                <dd className="font-mono text-text-tertiary">{diff.before}</dd>
                <dd className="font-mono text-sky-100">{diff.delta > 0 ? `+${diff.delta}` : diff.delta}</dd>
              </div>
            ))}
          </dl>
        </section>

        <section
          className={agentReviewWorkspaceTokens.card}
          data-approval-required={String(reviewState['approval-required'])}
          data-disabled-reason={liveWorkspaceController.disabledReason}
          data-live-action-request-id={liveWorkspaceController.latestRequestId ?? ''}
          data-live-action-status={liveWorkspaceController.status}
          data-live-action-tool-name={liveWorkspaceController.latestToolName ?? ''}
          data-testid="agent-dry-run-apply-review-controls"
        >
          <div className="grid grid-cols-2 gap-1">
            <button
              className={`${agentReviewWorkspaceTokens.actionButton} border-sky-500/30 bg-sky-500/10 text-sky-100`}
              data-testid="agent-review-control-dry-run"
              disabled={!reviewState['dry-run-ready']}
              onClick={() => {
                void liveWorkspaceController.actions.dryRun();
              }}
              type="button"
            >
              <Eye size={13} />
              {t('editor.ai.agent.composer.dryRun')}
            </button>
            <button
              className={`${agentReviewWorkspaceTokens.actionButton} border-amber-500/30 bg-amber-500/10 text-amber-100`}
              data-testid="agent-review-control-apply"
              disabled={!reviewState['approval-required']}
              onClick={() => {
                void liveWorkspaceController.actions.apply();
              }}
              type="button"
            >
              <CheckCircle2 size={13} />
              {t('editor.ai.agent.actions.approveApply')}
            </button>
            <button
              className={`${agentReviewWorkspaceTokens.actionButton} border-teal-500/30 bg-teal-500/10 text-teal-100`}
              data-testid="agent-review-control-export"
              disabled={!liveWorkspaceController.canExportAudit}
              onClick={() => {
                void liveWorkspaceController.actions.exportAudit();
              }}
              type="button"
            >
              <FileCheck2 size={13} />
              {t('editor.ai.agent.actions.exportAudit')}
            </button>
            <button
              className={`${agentReviewWorkspaceTokens.actionButton} border-red-500/30 bg-red-500/10 text-red-100`}
              data-testid="agent-review-control-rollback"
              disabled={!reviewState.applied}
              onClick={() => {
                void liveWorkspaceController.actions.rollback();
              }}
              type="button"
            >
              <RotateCcw size={13} />
              {t('editor.ai.agent.actions.revert')}
            </button>
          </div>
        </section>

        {liveWorkspaceController.previewReceipt === null ? null : (
          <AgentBeforeAfterReceiptCard receipt={liveWorkspaceController.previewReceipt} />
        )}

        <section className={agentReviewWorkspaceTokens.card} data-testid="agent-review-live-activity-timeline">
          <div className="mb-1 flex items-center justify-between gap-2">
            <span className={agentReviewWorkspaceTokens.sectionTitle}>{t('editor.ai.agent.timeline.title')}</span>
            <span className="font-mono text-[10px] text-text-tertiary">{transcript.toolCalls.length}</span>
          </div>
          <div className="space-y-1">
            {liveWorkspaceController.activityEntries.slice(-3).map((entry) => (
              <div
                className="grid grid-cols-[0.5rem_minmax(0,1fr)_auto] items-center gap-1 text-[11px] leading-4"
                data-graph-revision={entry.graphRevision ?? ''}
                data-recipe-hash={entry.recipeHash ?? ''}
                data-request-id={entry.requestId ?? ''}
                data-status={entry.status}
                data-testid={`agent-review-live-activity-${entry.id}`}
                data-tool-name={entry.toolName ?? ''}
                key={entry.id}
              >
                <span
                  className={`h-1.5 w-1.5 rounded-full ${
                    entry.status === 'completed' || entry.status === 'rolled_back' ? 'bg-emerald-300' : 'bg-amber-300'
                  }`}
                />
                <span className="truncate text-text-primary">{entry.body}</span>
                <span className="font-mono text-[10px] text-text-tertiary">{entry.kind}</span>
              </div>
            ))}
            {liveWorkspaceController.activityEntries.length === 0
              ? transcript.toolCalls.slice(0, 3).map((toolCall) => (
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
                ))
              : null}
          </div>
        </section>

        <div data-testid="agent-review-transcript-lower">
          <AgentChatShell transcript={transcript} />
        </div>
      </div>
    </div>
  );
}
