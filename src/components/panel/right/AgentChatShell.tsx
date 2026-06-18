import { AlertTriangle, CheckCircle2, CircleDashed, Eye, RotateCcw, Sparkles } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import type {
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

      <div className="grid grid-cols-2 gap-2" data-testid="agent-chat-actions">
        <button className="flex items-center justify-center gap-2 rounded-md bg-primary px-2 py-2 text-xs font-semibold text-black">
          <CheckCircle2 size={14} />
          {t('editor.ai.agent.actions.approveApply')}
        </button>
        <button className="flex items-center justify-center gap-2 rounded-md border border-white/10 bg-white/5 px-2 py-2 text-xs text-text-primary">
          <Eye size={14} />
          {t('editor.ai.agent.actions.inspectDiff')}
        </button>
        <button className="flex items-center justify-center gap-2 rounded-md border border-white/10 bg-white/5 px-2 py-2 text-xs text-text-primary">
          <RotateCcw size={14} />
          {t('editor.ai.agent.actions.revert')}
        </button>
        <button className="flex items-center justify-center gap-2 rounded-md border border-white/10 bg-white/5 px-2 py-2 text-xs text-text-primary">
          <RotateCcw size={14} />
          {t('editor.ai.agent.actions.exportAudit')}
        </button>
      </div>
    </section>
  );
}
