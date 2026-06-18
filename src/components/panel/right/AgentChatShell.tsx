import { AlertTriangle, CheckCircle2, CircleDashed, Eye, Sparkles } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import type {
  AgentArtifactReview,
  AgentChatDryRunReview,
  AgentChatMessage,
  AgentChatToolCall,
  AgentChatTranscript,
} from '../../../schemas/agentChatTranscriptSchemas';

interface AgentChatShellProps {
  transcript: AgentChatTranscript;
}

const statusStyles = {
  blocked: 'border-amber-500/30 bg-amber-500/10 text-amber-200',
  failed: 'border-red-500/30 bg-red-500/10 text-red-200',
  queued: 'border-white/10 bg-white/5 text-text-secondary',
  running: 'border-sky-500/30 bg-sky-500/10 text-sky-200',
  succeeded: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200',
  warning: 'border-amber-500/30 bg-amber-500/10 text-amber-200',
} satisfies Record<AgentChatToolCall['status'], string>;

const statusIcons = {
  blocked: AlertTriangle,
  failed: AlertTriangle,
  queued: CircleDashed,
  running: CircleDashed,
  succeeded: CheckCircle2,
  warning: AlertTriangle,
} satisfies Record<AgentChatToolCall['status'], typeof AlertTriangle>;

const reviewActionStyles = {
  available: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-100',
  disabled: 'border-white/10 bg-white/5 text-text-secondary',
  rejected: 'border-red-500/30 bg-red-500/10 text-red-100',
  unavailable: 'border-amber-500/30 bg-amber-500/10 text-amber-100',
} satisfies Record<AgentChatDryRunReview['actions'][number]['state'], string>;

const artifactStatusStyles = {
  audit_only: 'border-white/10 bg-white/5 text-text-secondary',
  ready: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-100',
  review_required: 'border-amber-500/30 bg-amber-500/10 text-amber-100',
} satisfies Record<AgentArtifactReview['previewArtifacts'][number]['status'], string>;

function MessageBubble({ message }: { message: AgentChatMessage }) {
  const isUser = message.role === 'user';

  return (
    <div
      className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}
      data-testid={`agent-chat-message-${message.id}`}
    >
      <div
        className={`max-w-[88%] rounded-md border px-3 py-2 ${
          isUser ? 'border-primary/30 bg-primary/15' : 'border-white/10 bg-white/5'
        }`}
      >
        <div className="mb-1 flex items-center justify-between gap-3 text-[11px] uppercase text-text-secondary">
          <span>{message.role}</span>
          <span>{message.timestamp}</span>
        </div>
        <p className="text-xs leading-5 text-text-primary">{message.body}</p>
      </div>
    </div>
  );
}

function ArtifactReviewPanel({ review }: { review: AgentArtifactReview }) {
  const { t } = useTranslation();

  return (
    <div
      className="space-y-3 rounded-md border border-white/10 bg-black/15 p-3"
      data-artifact-count={review.previewArtifacts.length}
      data-audit-count={review.auditEntries.length}
      data-before-revision={review.beforeAfter.beforeRevision}
      data-testid="agent-artifact-review"
    >
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="text-xs font-semibold text-text-primary">{t('editor.ai.agent.artifacts.title')}</div>
          <p className="mt-1 text-[11px] leading-4 text-text-secondary">{t('editor.ai.agent.artifacts.uiOnly')}</p>
        </div>
        <span className="shrink-0 rounded border border-white/10 bg-white/5 px-2 py-0.5 text-[11px] text-text-secondary">
          {t('editor.ai.agent.artifacts.audit')}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-2" data-testid="agent-before-after-preview">
        <div className="rounded border border-white/10 bg-gradient-to-br from-[#283540] via-[#556069] to-[#c19b67] p-2">
          <span className="rounded bg-black/35 px-1.5 py-0.5 text-[10px] uppercase text-text-primary">
            {review.beforeAfter.beforeLabel}
          </span>
          <div className="mt-14 font-mono text-[10px] text-text-primary">{review.beforeAfter.beforeRevision}</div>
        </div>
        <div className="rounded border border-sky-500/25 bg-gradient-to-br from-[#37444a] via-[#776f65] to-[#f2c779] p-2">
          <span className="rounded bg-black/35 px-1.5 py-0.5 text-[10px] uppercase text-text-primary">
            {review.beforeAfter.afterLabel}
          </span>
          <div className="mt-14 font-mono text-[10px] text-text-primary">{review.beforeAfter.afterRevision}</div>
        </div>
      </div>

      <div className="space-y-1" data-testid="agent-preview-artifacts">
        {review.previewArtifacts.map((artifact) => (
          <div
            className="grid grid-cols-[1fr_auto] gap-2 rounded border border-white/10 bg-white/[0.03] p-2 text-[11px]"
            key={artifact.id}
          >
            <div className="min-w-0">
              <div className="truncate font-semibold text-text-primary">{artifact.title}</div>
              <div className="mt-1 truncate font-mono text-text-secondary">{artifact.id}</div>
              <div className="mt-1 truncate font-mono text-text-secondary">{artifact.contentHash}</div>
            </div>
            <div className="flex flex-col items-end gap-1">
              <span className={`rounded border px-1.5 py-0.5 ${artifactStatusStyles[artifact.status]}`}>
                {artifact.status}
              </span>
              <span className="font-mono text-[10px] text-text-secondary">{artifact.toolCallId}</span>
            </div>
          </div>
        ))}
      </div>

      <div className="space-y-1" data-testid="agent-audit-entries">
        {review.auditEntries.map((entry) => (
          <a
            className="block rounded border border-white/10 bg-white/[0.03] p-2 text-[11px] hover:border-primary/50"
            href={entry.replayLink}
            key={entry.id}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="font-semibold text-text-primary">{entry.stage}</span>
              <span className="font-mono text-text-secondary">{entry.toolCallId}</span>
            </div>
            <div className="mt-1 font-mono text-text-secondary">{entry.artifactId}</div>
            <div className="mt-1 truncate font-mono text-text-secondary">{entry.replayLink}</div>
            <p className="mt-1 leading-4 text-text-secondary">{entry.summary}</p>
          </a>
        ))}
      </div>
    </div>
  );
}

function DryRunReviewPanel({ review }: { review: AgentChatDryRunReview }) {
  const { t } = useTranslation();

  return (
    <div
      className="space-y-3 rounded-md border border-sky-500/20 bg-sky-500/5 p-3"
      data-action-count={review.actions.length}
      data-affected-target-count={review.affectedTargets.length}
      data-approval-states={review.actions.map((action) => action.state).join(',')}
      data-parameter-diff-count={review.parameterDiffs.length}
      data-testid="agent-dry-run-review"
      data-warning-count={review.warnings.length}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-xs font-semibold text-text-primary">
            <CheckCircle2 size={15} />
            <span>{t('editor.ai.agent.review.title')}</span>
          </div>
          <p className="mt-1 text-[11px] leading-4 text-text-secondary">{t('editor.ai.agent.review.uiOnly')}</p>
        </div>
        <span className="shrink-0 rounded border border-sky-500/25 bg-sky-500/10 px-2 py-0.5 text-[11px] text-sky-100">
          {t('editor.ai.agent.review.dryRun')}
        </span>
      </div>

      <div className="grid grid-cols-3 gap-2" data-testid="agent-approval-states">
        {review.actions.map((action) => (
          <button
            className={`rounded-md border px-2 py-2 text-left text-[11px] ${reviewActionStyles[action.state]}`}
            data-testid={`agent-approval-action-${action.id}`}
            disabled
            key={action.id}
            type="button"
          >
            <span className="block font-semibold text-text-primary">{action.label}</span>
            <span className="mt-1 block uppercase tracking-normal">{action.state}</span>
          </button>
        ))}
      </div>

      <div className="space-y-1" data-testid="agent-parameter-diffs">
        <div className="text-[11px] font-semibold uppercase text-text-secondary">
          {t('editor.ai.agent.review.parameterDiffs')}
        </div>
        {review.parameterDiffs.map((diff) => (
          <div
            className="grid grid-cols-[1fr_auto_auto] items-center gap-2 rounded border border-white/10 bg-black/15 px-2 py-1.5 text-[11px]"
            key={diff.id}
          >
            <span className="text-text-primary">{diff.label}</span>
            <span className="font-mono text-text-secondary">{diff.before}</span>
            <span className="font-mono text-sky-100">{diff.after}</span>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-3 gap-2" data-testid="agent-affected-targets">
        {review.affectedTargets.map((target) => (
          <div className="rounded border border-white/10 bg-black/15 p-2" key={target.id}>
            <div className="text-[10px] uppercase text-text-secondary">{target.label}</div>
            <div className="mt-1 truncate text-[11px] text-text-primary">{target.value}</div>
          </div>
        ))}
      </div>

      <div className="space-y-1" data-testid="agent-review-warnings">
        {review.warnings.map((warning) => (
          <div
            className="rounded border border-amber-500/25 bg-amber-500/10 px-2 py-1.5 text-[11px] leading-4 text-amber-100"
            key={warning}
          >
            {warning}
          </div>
        ))}
      </div>
    </div>
  );
}

function ToolCallRow({ toolCall }: { toolCall: AgentChatToolCall }) {
  const { t } = useTranslation();
  const StatusIcon = statusIcons[toolCall.status];
  const modeLabel =
    toolCall.mode === 'apply'
      ? t('editor.ai.agent.mode.apply')
      : toolCall.mode === 'dry_run'
        ? t('editor.ai.agent.mode.dryRun')
        : t('editor.ai.agent.mode.read');
  const approvalLabel =
    toolCall.approvalState === 'approved'
      ? t('editor.ai.agent.approval.approved')
      : toolCall.approvalState === 'not_required'
        ? t('editor.ai.agent.approval.notRequired')
        : toolCall.approvalState === 'rejected'
          ? t('editor.ai.agent.approval.rejected')
          : t('editor.ai.agent.approval.required');

  return (
    <div className="rounded-md border border-white/10 bg-black/15 p-3" data-testid={`agent-tool-call-${toolCall.id}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <StatusIcon className="shrink-0" size={15} />
            <span className="truncate text-xs font-semibold text-text-primary">{toolCall.title}</span>
          </div>
          <div className="mt-1 truncate font-mono text-[11px] text-text-secondary">{toolCall.toolName}</div>
        </div>
        <span
          className={`shrink-0 rounded border px-2 py-0.5 text-[11px] ${statusStyles[toolCall.status]}`}
          data-testid={`agent-tool-status-${toolCall.id}`}
        >
          {toolCall.status}
        </span>
      </div>
      <p className="mt-2 text-xs leading-5 text-text-secondary">{toolCall.summary}</p>
      {toolCall.warning ? (
        <p className="mt-2 rounded border border-amber-500/25 bg-amber-500/10 px-2 py-1.5 text-[11px] leading-4 text-amber-100">
          {toolCall.warning}
        </p>
      ) : null}
      <div className="mt-3 grid grid-cols-2 gap-2 text-[11px] text-text-secondary">
        <span>{modeLabel}</span>
        <span>{approvalLabel}</span>
        <span>{toolCall.timestamp}</span>
        <span>
          {toolCall.durationMs === undefined ? t('editor.ai.agent.duration.pending') : `${toolCall.durationMs} ms`}
        </span>
      </div>
      <div className="mt-2 truncate font-mono text-[10px] text-text-secondary">{toolCall.provenance.requestHash}</div>
    </div>
  );
}

export default function AgentChatShell({ transcript }: AgentChatShellProps) {
  const { t } = useTranslation();

  return (
    <section
      className="space-y-3 rounded-md border border-white/10 bg-card/40 p-3"
      data-agent-runtime-status={transcript.runtimeStatus}
      data-testid="agent-chat-shell"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-sm font-semibold text-text-primary">
            <Sparkles size={16} />
            <span>{t('editor.ai.agent.title')}</span>
          </div>
          <p className="mt-1 text-xs text-text-secondary">{transcript.sessionTitle}</p>
        </div>
        <span className="rounded border border-amber-500/25 bg-amber-500/10 px-2 py-1 text-[11px] text-amber-100">
          {t('editor.ai.agent.uiOnly')}
        </span>
      </div>

      <div className="space-y-2" data-testid="agent-chat-messages">
        {transcript.messages.map((message) => (
          <MessageBubble key={message.id} message={message} />
        ))}
      </div>

      <div className="space-y-2" data-testid="agent-tool-transcript">
        <div className="flex items-center justify-between text-xs">
          <span className="font-semibold text-text-primary">{t('editor.ai.agent.transcript')}</span>
          <span className="text-text-secondary">{t('editor.ai.agent.noAppliedEdits')}</span>
        </div>
        {transcript.toolCalls.map((toolCall) => (
          <ToolCallRow key={toolCall.id} toolCall={toolCall} />
        ))}
      </div>

      {transcript.artifactReview ? <ArtifactReviewPanel review={transcript.artifactReview} /> : null}

      {transcript.dryRunReview ? <DryRunReviewPanel review={transcript.dryRunReview} /> : null}

      <div className="grid grid-cols-2 gap-2" data-testid="agent-chat-actions">
        <button
          className="flex items-center justify-center gap-2 rounded-md bg-primary/40 px-2 py-2 text-xs font-semibold text-black/60"
          disabled
          type="button"
        >
          <CheckCircle2 size={14} />
          {t('editor.ai.agent.actions.approveApply')}
        </button>
        <button
          className="flex items-center justify-center gap-2 rounded-md border border-white/10 bg-white/5 px-2 py-2 text-xs text-text-primary"
          type="button"
        >
          <Eye size={14} />
          {t('editor.ai.agent.actions.inspectDiff')}
        </button>
      </div>
    </section>
  );
}
