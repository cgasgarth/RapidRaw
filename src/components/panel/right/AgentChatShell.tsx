import { AlertTriangle, CheckCircle2, CircleDashed, Server, Sparkles } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { buildAgentAppServerToolReadinessSummary } from '../../../utils/agentAppServerToolReadiness';

import type {
  AgentArtifactReview,
  AgentAuditTranscript,
  AgentChatDryRunReview,
  AgentLivePromptWalkthrough,
  AgentChatMessage,
  AgentChatToolCall,
  AgentChatTranscript,
  AgentPrivateRawArtifacts,
  AgentReviewHandoff,
  AgentSelectedFrameScope,
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

const auditOutcomeStyles = {
  blocked: 'border-red-500/30 bg-red-500/10 text-red-100',
  success: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-100',
  warning: 'border-amber-500/30 bg-amber-500/10 text-amber-100',
} satisfies Record<AgentAuditTranscript['records'][number]['outcome'], string>;

const handoffApprovalStyles = {
  approved: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-100',
  not_required: 'border-white/10 bg-white/5 text-text-secondary',
  rejected: 'border-red-500/30 bg-red-500/10 text-red-100',
  required: 'border-amber-500/30 bg-amber-500/10 text-amber-100',
} satisfies Record<AgentReviewHandoff['approvalState'], string>;

const rollbackStatusStyles = {
  available: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-100',
  blocked: 'border-red-500/30 bg-red-500/10 text-red-100',
  not_required: 'border-white/10 bg-white/5 text-text-secondary',
} satisfies Record<AgentReviewHandoff['rollback']['status'], string>;

const scopePolicyStateStyles = {
  passed: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-100',
  review_required: 'border-amber-500/30 bg-amber-500/10 text-amber-100',
} satisfies Record<AgentSelectedFrameScope['policyChecks'][number]['state'], string>;

const walkthroughStageStyles = {
  completed: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-100',
  current: 'border-sky-500/30 bg-sky-500/10 text-sky-100',
  pending: 'border-white/10 bg-white/5 text-text-secondary',
} satisfies Record<AgentLivePromptWalkthrough['stages'][number]['state'], string>;

type LocalReviewDecision = 'approved' | 'pending' | 'rejected';

const formatRouteFamily = (family: string): string => family.replaceAll('_', ' ');

const agentRuntimeBadge = {
  runtime_apply_demo: {
    className: 'border-emerald-500/25 bg-emerald-500/10 text-emerald-100',
  },
  ui_only_demo: {
    className: 'border-amber-500/25 bg-amber-500/10 text-amber-100',
  },
} satisfies Record<AgentChatTranscript['runtimeStatus'], { className: string }>;

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

function ReviewHandoffPanel({ handoff }: { handoff: AgentReviewHandoff }) {
  const [rollbackRestoreState, setRollbackRestoreState] = useState<'available' | 'restored'>('available');
  const rollbackCanRestore = handoff.rollback.status === 'available' && rollbackRestoreState === 'available';

  return (
    <div
      className="space-y-3 rounded-md border border-emerald-500/20 bg-emerald-500/5 p-3"
      data-after-artifact-id={handoff.afterArtifactId}
      data-approval-state={handoff.approvalState}
      data-before-artifact-id={handoff.beforeArtifactId}
      data-output-proof-status={handoff.outputProof.status}
      data-rollback-restore-state={rollbackRestoreState}
      data-rollback-status={handoff.rollback.status}
      data-testid="agent-review-handoff"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-xs font-semibold text-text-primary">{handoff.title}</div>
          <p className="mt-1 text-[11px] leading-4 text-text-secondary">{handoff.commandSummary}</p>
        </div>
        <span
          className={`shrink-0 rounded border px-2 py-0.5 text-[11px] ${handoffApprovalStyles[handoff.approvalState]}`}
        >
          {handoff.approvalLabel}
        </span>
      </div>

      <div className="grid grid-cols-3 gap-2 text-[11px]" data-testid="agent-review-handoff-artifacts">
        <div className="rounded border border-white/10 bg-black/15 p-2">
          <div className="text-[10px] uppercase text-text-secondary">{handoff.beforeLabel}</div>
          <div className="mt-1 truncate font-mono text-text-primary">{handoff.beforeArtifactId}</div>
        </div>
        <div className="rounded border border-white/10 bg-black/15 p-2">
          <div className="text-[10px] uppercase text-text-secondary">{handoff.afterLabel}</div>
          <div className="mt-1 truncate font-mono text-text-primary">{handoff.afterArtifactId}</div>
        </div>
        <div className="rounded border border-white/10 bg-black/15 p-2">
          <div className="text-[10px] uppercase text-text-secondary">{handoff.auditLabel}</div>
          <div className="mt-1 truncate font-mono text-text-primary">{handoff.auditArtifactId}</div>
        </div>
      </div>

      <div className="space-y-1" data-testid="agent-review-handoff-audit-trail">
        {handoff.auditTrail.map((entry) => (
          <div
            className="grid gap-2 rounded border border-white/10 bg-black/15 p-2 text-[11px] md:grid-cols-[1fr_auto]"
            data-approval-state={entry.approvalState}
            data-artifact-ids={entry.artifactIds.join(',')}
            data-stage={entry.stage}
            data-tool-call-id={entry.toolCallId}
            data-tool-name={entry.toolName}
            key={entry.id}
          >
            <div className="min-w-0">
              <div className="truncate font-mono text-text-primary">{entry.toolName}</div>
              <div className="mt-1 truncate font-mono text-text-secondary">{entry.artifactIds.join(' -> ')}</div>
            </div>
            <div className="flex flex-wrap items-start justify-end gap-1.5">
              <span className="rounded border border-white/10 bg-white/5 px-1.5 py-0.5 text-text-secondary">
                {entry.stage}
              </span>
              <span className={`rounded border px-1.5 py-0.5 ${handoffApprovalStyles[entry.approvalState]}`}>
                {entry.approvalState}
              </span>
            </div>
          </div>
        ))}
      </div>

      <div className="grid gap-2 md:grid-cols-[1fr_1fr]" data-testid="agent-review-handoff-next">
        <a
          className="rounded border border-sky-500/25 bg-sky-500/10 p-2 text-[11px] text-sky-100 hover:border-sky-300/70"
          href={handoff.outputProof.href}
        >
          <span className="block font-semibold text-text-primary">{handoff.outputProof.label}</span>
          <span className="mt-1 block font-mono text-[10px] text-text-secondary">
            {handoff.outputProof.contentHash}
          </span>
          <span className="mt-1 block uppercase">{handoff.outputProof.status}</span>
        </a>
        <div className="rounded border border-white/10 bg-black/15 p-2 text-[11px]">
          <div className="flex items-center justify-between gap-2">
            <span className="font-semibold text-text-primary">{handoff.rollback.label}</span>
            <span className={`rounded border px-1.5 py-0.5 ${rollbackStatusStyles[handoff.rollback.status]}`}>
              {handoff.rollback.status}
            </span>
          </div>
          <div className="mt-1 truncate font-mono text-text-secondary">{handoff.rollback.targetRevision}</div>
          <p className="mt-1 leading-4 text-text-secondary">
            {rollbackRestoreState === 'restored'
              ? handoff.rollback.restoreAction.restoredLabel
              : handoff.rollback.summary}
          </p>
          <button
            className="mt-2 w-full rounded-md border border-emerald-500/25 bg-emerald-500/10 px-2 py-1.5 text-left text-[11px] text-emerald-100 disabled:border-white/10 disabled:bg-white/5 disabled:text-text-secondary"
            data-command-id={handoff.rollback.restoreAction.commandId}
            data-testid="agent-review-handoff-rollback-restore"
            data-tool-name={handoff.rollback.restoreAction.toolName}
            disabled={!rollbackCanRestore}
            onClick={() => {
              setRollbackRestoreState('restored');
            }}
            type="button"
          >
            {handoff.rollback.restoreAction.buttonLabel}
          </button>
        </div>
      </div>

      <div className="rounded border border-white/10 bg-black/15 px-2 py-1.5 text-[11px] leading-4 text-text-secondary">
        {handoff.nextAction}
      </div>
    </div>
  );
}

function PrivateRawArtifactsPanel({ proof }: { proof: AgentPrivateRawArtifacts }) {
  const { t } = useTranslation();

  return (
    <div
      className="space-y-3 rounded-md border border-sky-500/20 bg-sky-500/5 p-3"
      data-artifact-count={proof.artifactCount}
      data-fixture-id={proof.fixtureId}
      data-issue={proof.issue}
      data-source-hash-unchanged={String(proof.sourceHashUnchanged)}
      data-status={proof.status}
      data-testid="agent-private-raw-artifacts"
      data-validation-mode={proof.validationMode}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-xs font-semibold text-text-primary">{proof.title}</div>
          <p className="mt-1 text-[11px] leading-4 text-text-secondary">
            {t('editor.ai.agent.privateRawArtifacts.summary')}
          </p>
        </div>
        <span className="shrink-0 rounded border border-sky-500/25 bg-sky-500/10 px-2 py-0.5 text-[11px] text-sky-100">
          {proof.status}
        </span>
      </div>
      <div className="grid gap-2 text-[11px] md:grid-cols-2">
        <div className="rounded border border-white/10 bg-black/15 p-2">
          <div className="text-[10px] uppercase text-text-secondary">
            {t('editor.ai.agent.privateRawArtifacts.fixture')}
          </div>
          <div className="mt-1 truncate font-mono text-text-primary">{proof.fixtureId}</div>
        </div>
        <div className="rounded border border-white/10 bg-black/15 p-2">
          <div className="text-[10px] uppercase text-text-secondary">
            {t('editor.ai.agent.privateRawArtifacts.artifacts')}
          </div>
          <div className="mt-1 font-mono text-text-primary">{proof.artifactCount}</div>
        </div>
        <div className="rounded border border-white/10 bg-black/15 p-2">
          <div className="text-[10px] uppercase text-text-secondary">
            {t('editor.ai.agent.privateRawArtifacts.report')}
          </div>
          <div className="mt-1 truncate font-mono text-text-primary">{proof.reportPath}</div>
        </div>
        <div className="rounded border border-white/10 bg-black/15 p-2">
          <div className="text-[10px] uppercase text-text-secondary">
            {t('editor.ai.agent.privateRawArtifacts.runtime')}
          </div>
          <div className="mt-1 truncate font-mono text-text-primary">{proof.workflowReportPath}</div>
        </div>
      </div>
    </div>
  );
}

function SelectedFrameScopePanel({ scope }: { scope: AgentSelectedFrameScope }) {
  return (
    <div
      className="space-y-3 rounded-md border border-violet-500/20 bg-violet-500/5 p-3"
      data-approval-state={scope.approvalState}
      data-audit-artifact-id={scope.auditArtifactId}
      data-dry-run-tool-call-id={scope.dryRunToolCallId}
      data-excluded-asset-count={scope.excludedAssets.length}
      data-no-overwrite-target={scope.noOverwriteTarget.value}
      data-policy-check-count={scope.policyChecks.length}
      data-proof-href={scope.proofHref}
      data-selected-asset-count={scope.selectedAssets.length}
      data-testid="agent-selected-frame-scope"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-xs font-semibold text-text-primary">{scope.title}</div>
          <p className="mt-1 text-[11px] leading-4 text-text-secondary">{scope.summary}</p>
        </div>
        <span
          className={`shrink-0 rounded border px-2 py-0.5 text-[11px] ${handoffApprovalStyles[scope.approvalState]}`}
        >
          {scope.approvalLabel}
        </span>
      </div>

      <div className="grid gap-2 md:grid-cols-2" data-testid="agent-selected-frame-assets">
        {scope.selectedAssets.map((asset) => (
          <div className="rounded border border-white/10 bg-black/15 p-2 text-[11px]" key={asset.id}>
            <div className="flex items-center justify-between gap-2">
              <span className="font-semibold text-text-primary">{asset.label}</span>
              <span className="rounded border border-emerald-500/25 bg-emerald-500/10 px-1.5 py-0.5 text-emerald-100">
                {asset.stateLabel}
              </span>
            </div>
            <div className="mt-1 truncate text-text-primary">{asset.value}</div>
            <div className="mt-1 font-mono text-[10px] text-text-secondary">{asset.role}</div>
          </div>
        ))}
      </div>

      <div className="grid gap-2 md:grid-cols-[1fr_1fr]" data-testid="agent-selected-frame-boundaries">
        <div className="rounded border border-white/10 bg-black/15 p-2 text-[11px]">
          <div className="font-semibold text-text-primary">{scope.noOverwriteTarget.label}</div>
          <div className="mt-1 truncate font-mono text-text-secondary">{scope.noOverwriteTarget.value}</div>
          <p className="mt-1 leading-4 text-text-secondary">{scope.noOverwriteTarget.summary}</p>
        </div>
        <a
          className="rounded border border-sky-500/25 bg-sky-500/10 p-2 text-[11px] text-sky-100 hover:border-sky-300/70"
          href={scope.proofHref}
        >
          <span className="block font-semibold text-text-primary">{scope.proofLabel}</span>
          <span className="mt-1 block font-mono text-[10px] text-text-secondary">{scope.auditArtifactId}</span>
          <span className="mt-1 block font-mono text-[10px] text-text-secondary">{scope.dryRunToolCallId}</span>
        </a>
      </div>

      <div className="space-y-1" data-testid="agent-excluded-frame-assets">
        {scope.excludedAssets.map((asset) => (
          <div
            className="grid grid-cols-[1fr_1.4fr] gap-2 rounded border border-white/10 bg-white/[0.03] p-2 text-[11px]"
            key={asset.id}
          >
            <div className="min-w-0">
              <div className="font-semibold text-text-primary">{asset.label}</div>
              <div className="mt-1 truncate font-mono text-text-secondary">{asset.value}</div>
            </div>
            <p className="leading-4 text-text-secondary">{asset.reason}</p>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap gap-1.5" data-testid="agent-selected-frame-policy-checks">
        {scope.policyChecks.map((check) => (
          <span
            className={`rounded border px-2 py-1 text-[11px] ${scopePolicyStateStyles[check.state]}`}
            data-policy-state={check.state}
            data-testid={`agent-selected-frame-policy-${check.id}`}
            key={check.id}
          >
            {check.label}
          </span>
        ))}
      </div>
    </div>
  );
}

function AuditTranscriptViewer({ auditTranscript }: { auditTranscript: AgentAuditTranscript }) {
  const { t } = useTranslation();
  const warningCount = auditTranscript.records.reduce((count, record) => count + record.warnings.length, 0);
  const artifactLinkCount = auditTranscript.records.reduce((count, record) => count + record.artifactLinks.length, 0);
  const applyRecordCount = auditTranscript.records.filter((record) => record.stage === 'apply').length;

  return (
    <div
      className="space-y-3 rounded-md border border-white/10 bg-black/15 p-3"
      data-apply-record-count={applyRecordCount}
      data-artifact-link-count={artifactLinkCount}
      data-evidence-tier={auditTranscript.evidenceTier}
      data-record-count={auditTranscript.records.length}
      data-replay-root={auditTranscript.replayRoot}
      data-schema-version={auditTranscript.schemaVersion}
      data-testid="agent-audit-transcript-viewer"
      data-warning-count={warningCount}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-xs font-semibold text-text-primary">
            <CircleDashed size={15} />
            <span>{t('editor.ai.agent.audit.title')}</span>
          </div>
          <p className="mt-1 text-[11px] leading-4 text-text-secondary">{t('editor.ai.agent.audit.uiOnly')}</p>
        </div>
        <span className="shrink-0 rounded border border-white/10 bg-white/5 px-2 py-0.5 text-[11px] text-text-secondary">
          {t('editor.ai.agent.audit.html')}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-2 text-[11px]" data-testid="agent-audit-summary">
        <div className="rounded border border-white/10 bg-white/[0.03] p-2">
          <div className="text-[10px] uppercase text-text-secondary">{t('editor.ai.agent.audit.target')}</div>
          <div className="mt-1 truncate text-text-primary">{auditTranscript.targetLabel}</div>
        </div>
        <div className="rounded border border-white/10 bg-white/[0.03] p-2">
          <div className="text-[10px] uppercase text-text-secondary">{t('editor.ai.agent.audit.evidence')}</div>
          <div className="mt-1 font-mono text-text-primary">{auditTranscript.evidenceTier}</div>
        </div>
        <div className="rounded border border-white/10 bg-white/[0.03] p-2">
          <div className="text-[10px] uppercase text-text-secondary">{t('editor.ai.agent.audit.initialRevision')}</div>
          <div className="mt-1 truncate font-mono text-text-primary">{auditTranscript.initialRevision}</div>
        </div>
        <div className="rounded border border-white/10 bg-white/[0.03] p-2">
          <div className="text-[10px] uppercase text-text-secondary">{t('editor.ai.agent.audit.finalRevision')}</div>
          <div className="mt-1 truncate font-mono text-text-primary">{auditTranscript.finalRevision}</div>
        </div>
      </div>

      <ol className="space-y-2" data-testid="agent-audit-transcript-records">
        {auditTranscript.records.map((record) => (
          <li
            className="rounded border border-white/10 bg-white/[0.03] p-2 text-[11px]"
            data-testid={`agent-audit-record-${record.id}`}
            key={record.id}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-text-primary">{record.title}</span>
                  <span className="rounded border border-white/10 bg-black/20 px-1.5 py-0.5 uppercase text-text-secondary">
                    {record.stage}
                  </span>
                </div>
                <div className="mt-1 truncate font-mono text-text-secondary">{record.toolName}</div>
              </div>
              <span className={`shrink-0 rounded border px-1.5 py-0.5 ${auditOutcomeStyles[record.outcome]}`}>
                {record.outcome}
              </span>
            </div>

            <p className="mt-2 leading-4 text-text-secondary">{record.summary}</p>

            <div className="mt-2 grid grid-cols-2 gap-2 font-mono text-[10px] text-text-secondary">
              <span>{record.timestamp}</span>
              <span>{record.toolCallId}</span>
              <span className="truncate">{record.schema}</span>
              <span className="truncate">{record.requestHash}</span>
            </div>

            {record.artifactLinks.length > 0 ? (
              <div className="mt-2 flex flex-wrap gap-1.5" data-testid={`agent-audit-links-${record.id}`}>
                {record.artifactLinks.map((artifact) => (
                  <a
                    className="inline-flex max-w-full items-center gap-1 rounded border border-sky-500/25 bg-sky-500/10 px-1.5 py-0.5 text-sky-100 hover:border-sky-300/70"
                    href={artifact.href}
                    key={artifact.id}
                  >
                    <span className="truncate">{artifact.label}</span>
                  </a>
                ))}
              </div>
            ) : null}

            {record.warnings.length > 0 ? (
              <div className="mt-2 space-y-1" data-testid={`agent-audit-warnings-${record.id}`}>
                {record.warnings.map((warning) => (
                  <div
                    className="rounded border border-amber-500/25 bg-amber-500/10 px-2 py-1 text-amber-100"
                    key={warning}
                  >
                    {warning}
                  </div>
                ))}
              </div>
            ) : null}
          </li>
        ))}
      </ol>
    </div>
  );
}

function DryRunReviewPanel({
  review,
  runtimeStatus,
}: {
  review: AgentChatDryRunReview;
  runtimeStatus: AgentChatTranscript['runtimeStatus'];
}) {
  const { t } = useTranslation();
  const [localDecision, setLocalDecision] = useState<LocalReviewDecision>('pending');
  const applyUnavailableReason =
    runtimeStatus === 'runtime_apply_demo'
      ? t('editor.ai.agent.review.runtimeReplayApply')
      : localDecision === 'approved'
        ? t('editor.ai.agent.review.noReplayApply')
        : localDecision === 'rejected'
          ? t('editor.ai.agent.review.rejectedApply')
          : t('editor.ai.agent.review.pendingApply');
  const applyAvailability = runtimeStatus === 'runtime_apply_demo' ? 'runtime_apply_demo' : 'unavailable';
  const applyLabel =
    runtimeStatus === 'runtime_apply_demo'
      ? t('editor.ai.agent.runtimeApplyProof')
      : t('editor.ai.agent.review.applyUnavailable');

  return (
    <div
      className="space-y-3 rounded-md border border-sky-500/20 bg-sky-500/5 p-3"
      data-action-count={review.actions.length}
      data-affected-target-count={review.affectedTargets.length}
      data-apply-availability={applyAvailability}
      data-approval-states={review.actions.map((action) => action.state).join(',')}
      data-local-review-decision={localDecision}
      data-parameter-diff-count={review.parameterDiffs.length}
      data-policy-availability="reviewable"
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
            disabled={action.state !== 'available'}
            key={action.id}
            onClick={() => {
              if (action.id === 'approve-dry-run') {
                setLocalDecision('approved');
              }
              if (action.id === 'reject-plan') {
                setLocalDecision('rejected');
              }
            }}
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

      <div className="rounded border border-white/10 bg-black/20 p-2" data-testid="agent-review-apply-state">
        <button
          className="w-full rounded-md border border-white/10 bg-white/5 px-2 py-2 text-left text-[11px] text-text-secondary"
          data-testid="agent-review-apply-unavailable"
          disabled
          type="button"
        >
          <span className="block font-semibold text-text-primary">{applyLabel}</span>
          <span className="mt-1 block leading-4">{applyUnavailableReason}</span>
        </button>
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

function AppServerToolReadinessSummary() {
  const { t } = useTranslation();
  const summary = buildAgentAppServerToolReadinessSummary();

  return (
    <div
      className="space-y-3 rounded-md border border-emerald-500/20 bg-emerald-500/5 p-3"
      data-apply-route-count={summary.applyRouteCount}
      data-dry-run-route-count={summary.dryRunRouteCount}
      data-family-count={summary.familyCount}
      data-host-command-route-count={summary.hostCommandRouteCount}
      data-route-count={summary.routeCount}
      data-runtime-check-count={summary.runtimeCheckCount}
      data-testid="agent-app-server-tool-readiness"
      data-tool-count={summary.toolCount}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-xs font-semibold text-text-primary">
            <Server size={15} />
            <span>{t('editor.ai.agent.readiness.title')}</span>
          </div>
          <p className="mt-1 text-[11px] leading-4 text-text-secondary">
            {t('editor.ai.agent.readiness.registeredOnly')}
          </p>
        </div>
        <span className="shrink-0 rounded border border-emerald-500/25 bg-emerald-500/10 px-2 py-0.5 text-[11px] text-emerald-100">
          {t('editor.ai.agent.readiness.appServer')}
        </span>
      </div>

      <div className="grid grid-cols-4 gap-2 text-[11px]" data-testid="agent-app-server-tool-readiness-counts">
        <div className="rounded border border-white/10 bg-black/15 p-2">
          <div className="text-[10px] uppercase text-text-secondary">{t('editor.ai.agent.readiness.tools')}</div>
          <div className="mt-1 font-mono text-text-primary">{summary.toolCount}</div>
        </div>
        <div className="rounded border border-white/10 bg-black/15 p-2">
          <div className="text-[10px] uppercase text-text-secondary">{t('editor.ai.agent.readiness.routes')}</div>
          <div className="mt-1 font-mono text-text-primary">{summary.routeCount}</div>
        </div>
        <div className="rounded border border-white/10 bg-black/15 p-2">
          <div className="text-[10px] uppercase text-text-secondary">{t('editor.ai.agent.readiness.dryRuns')}</div>
          <div className="mt-1 font-mono text-text-primary">{summary.dryRunRouteCount}</div>
        </div>
        <div className="rounded border border-white/10 bg-black/15 p-2">
          <div className="text-[10px] uppercase text-text-secondary">{t('editor.ai.agent.readiness.applies')}</div>
          <div className="mt-1 font-mono text-text-primary">{summary.applyRouteCount}</div>
        </div>
      </div>

      <div className="flex flex-wrap gap-1.5" data-testid="agent-app-server-tool-readiness-families">
        {summary.families.map((family) => (
          <span
            className="rounded border border-white/10 bg-black/15 px-2 py-1 text-[11px] text-text-secondary"
            data-apply-route-count={family.applyRouteCount}
            data-dry-run-route-count={family.dryRunRouteCount}
            data-family={family.family}
            data-route-count={family.routeCount}
            data-testid={`agent-app-server-tool-family-${family.family}`}
            data-tool-count={family.toolCount}
            key={family.family}
          >
            <span className="text-text-primary">{formatRouteFamily(family.family)}</span>
            <span className="ml-1 font-mono">{family.toolCount}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

function LivePromptWalkthroughPanel({ walkthrough }: { walkthrough: AgentLivePromptWalkthrough }) {
  const { t } = useTranslation();

  return (
    <div
      className="space-y-3 rounded-md border border-sky-500/20 bg-sky-500/5 p-3"
      data-approval-state={walkthrough.approval.state}
      data-prompt={walkthrough.prompt}
      data-stage-count={walkthrough.stages.length}
      data-testid="agent-live-prompt-walkthrough"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-xs font-semibold text-text-primary">{t('editor.ai.agent.walkthrough.title')}</div>
          <p className="mt-1 text-[11px] leading-4 text-text-secondary">{walkthrough.prompt}</p>
        </div>
        <span
          className={`shrink-0 rounded border px-2 py-0.5 text-[11px] ${handoffApprovalStyles[walkthrough.approval.state]}`}
        >
          {walkthrough.approval.label}
        </span>
      </div>

      <div className="grid gap-2 text-[11px]" data-testid="agent-live-prompt-walkthrough-stages">
        {walkthrough.stages.map((stage) => (
          <div className="rounded border border-white/10 bg-black/15 p-2" data-stage-state={stage.state} key={stage.id}>
            <div className="flex items-center justify-between gap-2">
              <span className="font-semibold text-text-primary">{stage.label}</span>
              <span className={`rounded border px-1.5 py-0.5 ${walkthroughStageStyles[stage.state]}`}>
                {stage.state}
              </span>
            </div>
            <p className="mt-1 leading-4 text-text-secondary">{stage.summary}</p>
            {stage.toolCallId ? (
              <div className="mt-1 font-mono text-[10px] text-text-secondary">{stage.toolCallId}</div>
            ) : null}
          </div>
        ))}
      </div>

      <div
        className="grid gap-2 text-[11px] md:grid-cols-[1fr_1fr]"
        data-testid="agent-live-prompt-walkthrough-summary"
      >
        <div className="rounded border border-white/10 bg-black/15 p-2">
          <div className="text-[10px] uppercase text-text-secondary">{t('editor.ai.agent.walkthrough.target')}</div>
          <div className="mt-1 font-mono text-text-primary">{walkthrough.targetLabel}</div>
        </div>
        <div className="rounded border border-white/10 bg-black/15 p-2">
          <div className="text-[10px] uppercase text-text-secondary">{t('editor.ai.agent.walkthrough.plan')}</div>
          <p className="mt-1 leading-4 text-text-secondary">{walkthrough.planSummary}</p>
        </div>
      </div>

      <div className="rounded border border-white/10 bg-black/15 px-2 py-1.5 text-[11px] leading-4 text-text-secondary">
        {walkthrough.approval.summary}
      </div>
    </div>
  );
}

export default function AgentChatShell({ transcript }: AgentChatShellProps) {
  const { t } = useTranslation();
  const runtimeBadge = agentRuntimeBadge[transcript.runtimeStatus];

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
        <span className={`rounded border px-2 py-1 text-[11px] ${runtimeBadge.className}`}>
          {transcript.runtimeStatus === 'runtime_apply_demo'
            ? t('editor.ai.agent.runtimeApplyDemo')
            : t('editor.ai.agent.uiOnly')}
        </span>
      </div>

      <div className="space-y-2" data-testid="agent-chat-messages">
        {transcript.messages.map((message) => (
          <MessageBubble key={message.id} message={message} />
        ))}
      </div>

      <AppServerToolReadinessSummary />

      {transcript.livePromptWalkthrough ? (
        <LivePromptWalkthroughPanel walkthrough={transcript.livePromptWalkthrough} />
      ) : null}

      <div className="space-y-2" data-testid="agent-tool-transcript">
        <div className="flex items-center justify-between text-xs">
          <span className="font-semibold text-text-primary">{t('editor.ai.agent.transcript')}</span>
          <span className="text-text-secondary">
            {transcript.runtimeStatus === 'runtime_apply_demo'
              ? t('editor.ai.agent.runtimeApplyProof')
              : t('editor.ai.agent.noAppliedEdits')}
          </span>
        </div>
        {transcript.toolCalls.map((toolCall) => (
          <ToolCallRow key={toolCall.id} toolCall={toolCall} />
        ))}
      </div>

      {transcript.selectedFrameScope ? <SelectedFrameScopePanel scope={transcript.selectedFrameScope} /> : null}

      {transcript.artifactReview ? <ArtifactReviewPanel review={transcript.artifactReview} /> : null}

      {transcript.reviewHandoff ? <ReviewHandoffPanel handoff={transcript.reviewHandoff} /> : null}

      {transcript.privateRawArtifacts ? <PrivateRawArtifactsPanel proof={transcript.privateRawArtifacts} /> : null}

      {transcript.auditTranscript ? <AuditTranscriptViewer auditTranscript={transcript.auditTranscript} /> : null}

      {transcript.dryRunReview ? (
        <DryRunReviewPanel review={transcript.dryRunReview} runtimeStatus={transcript.runtimeStatus} />
      ) : null}
    </section>
  );
}
