import { Check, CircleAlert, LoaderCircle, RotateCcw, Send, Sparkles, Wrench, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
// i18next-instrument-ignore
import {
  RAW_ENGINE_AGENT_SELECTED_IMAGE_PROPOSAL_RENDER_TOOL_NAME,
  type RawEngineAgentSelectedImageProposalReceiptV1,
} from '../../../../../packages/rawengine-schema/src/agentSelectedImageProposalSchemas';
import type { AgentChatMessage, AgentChatTranscript } from '../../../../schemas/agent/agentChatTranscriptSchemas';
import { useEditorStore } from '../../../../store/useEditorStore';
import { buildAgentImageContextSnapshot } from '../../../../utils/agent/context/agentImageContextSnapshot';
import {
  RAW_ENGINE_IMAGE_GET_PREVIEW_TOOL_NAME,
  renderAgentReadOnlyPreview,
} from '../../../../utils/agent/context/agentReadOnlyAppServerTools';
import { agentSelectedImageProposalRuntime } from '../../../../utils/agent/context/agentSelectedImageProposalRuntime';
import {
  AGENT_HISTORY_ROLLBACK_TOOL_NAME,
  agentHistoryRollbackResponseSchema,
} from '../../../../utils/agent/session/agentSessionHistory';
import {
  createAgentTypedToolExecutionContext,
  dispatchAgentTypedEditorTool,
} from '../../../../utils/agent/session/agentTypedToolDispatch';
import {
  AGENT_TONE_ADJUSTMENT_APPLY_TOOL_NAME,
  type AgentToneAdjustmentDryRunResponse,
  type AgentToneAdjustmentPromptDraft,
  applyAgentToneAdjustment,
  buildAgentToneAdjustmentPromptDraft,
  dryRunAgentToneAdjustment,
} from '../../../../utils/agent/tools/agentToneAdjustmentTool';
import { cancelRawEngineAppServerTypedDispatch } from '../../../../utils/rawEngineAppServerHost';

interface AgentChatShellProps {
  transcript: AgentChatTranscript;
}

type LivePromptStatus =
  | 'applied'
  | 'applying'
  | 'approval_required'
  | 'blocked'
  | 'cancelled'
  | 'cancelling'
  | 'dry_run_ready'
  | 'failed'
  | 'idle'
  | 'previewing'
  | 'rolled_back';

interface LivePromptResult {
  dryRunReceipt?: AgentToneAdjustmentDryRunResponse['receipt'];
  error?: string;
  previewAfterUrl?: string;
  previewBeforeUrl?: string;
  proposal?: RawEngineAgentSelectedImageProposalReceiptV1;
  proposalId?: string;
  recipeName?: string;
  toneAdjustmentDraft?: AgentToneAdjustmentPromptDraft;
  status: LivePromptStatus;
}

interface LiveSessionEvent {
  body: string;
  id: string;
  role: AgentChatMessage['role'];
  timestamp: string;
}

export const buildAgentChatTimeline = (
  transcript: AgentChatTranscript,
  liveSessionEvents: readonly LiveSessionEvent[],
): AgentChatMessage[] => [...transcript.messages.filter((message) => message.role !== 'system'), ...liveSessionEvents];

const createAgentRollbackSnapshot = () => {
  const state = useEditorStore.getState();
  const context = buildAgentImageContextSnapshot();

  return {
    adjustments: state.adjustments,
    activeImagePath: context.activeImagePath,
    finalPreviewUrl: state.finalPreviewUrl,
    graphRevision: context.graphRevision,
    history: state.history,
    historyIndex: state.historyIndex,
    lastBasicToneCommand: state.lastBasicToneCommand,
    recipeHash: context.initialPreview.recipeHash,
    uncroppedAdjustedPreviewUrl: state.uncroppedAdjustedPreviewUrl,
  };
};

type AgentRollbackSnapshot = ReturnType<typeof createAgentRollbackSnapshot> & {
  expectedCurrentGraphRevision?: string;
  expectedCurrentRecipeHash?: string;
};
type AgentRollbackInvalidationReason =
  | 'context_unavailable'
  | 'graph_revision_changed'
  | 'image_changed'
  | 'recipe_hash_changed';
type AgentRollbackValidation =
  | {
      currentGraphRevision: string;
      currentImagePath: string;
      currentRecipeHash: string;
      reason: null;
      state: 'available';
    }
  | {
      currentGraphRevision: string;
      currentImagePath: string;
      currentRecipeHash: string;
      reason: AgentRollbackInvalidationReason;
      state: 'invalidated';
    };

const validateAgentRollbackSnapshot = (snapshot: AgentRollbackSnapshot): AgentRollbackValidation => {
  try {
    const context = buildAgentImageContextSnapshot();
    const current = {
      currentGraphRevision: context.graphRevision,
      currentImagePath: context.activeImagePath,
      currentRecipeHash: context.initialPreview.recipeHash,
    };
    if (current.currentImagePath !== snapshot.activeImagePath) {
      return { ...current, reason: 'image_changed', state: 'invalidated' };
    }
    if (current.currentGraphRevision !== (snapshot.expectedCurrentGraphRevision ?? snapshot.graphRevision)) {
      return { ...current, reason: 'graph_revision_changed', state: 'invalidated' };
    }
    if (current.currentRecipeHash !== (snapshot.expectedCurrentRecipeHash ?? snapshot.recipeHash)) {
      return { ...current, reason: 'recipe_hash_changed', state: 'invalidated' };
    }
    return { ...current, reason: null, state: 'available' };
  } catch {
    return {
      currentGraphRevision: 'unavailable',
      currentImagePath: 'unavailable',
      currentRecipeHash: 'unavailable',
      reason: 'context_unavailable',
      state: 'invalidated',
    };
  }
};

function MessageBubble({ message }: { message: AgentChatMessage }) {
  const isUser = message.role === 'user';

  return (
    <div
      className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}
      data-testid={`agent-chat-message-${message.id}`}
    >
      {/* i18next-instrument-ignore */}
      <div className={`min-w-0 max-w-[88%] ${isUser ? 'text-right' : 'text-left'}`}>
        <div className="mb-0.5 flex items-center gap-1.5 text-[10px] font-medium uppercase leading-3 text-text-tertiary">
          <span>{isUser ? 'You' : 'Agent'}</span>
          {message.timestamp !== 'now' ? <span className="font-normal normal-case">{message.timestamp}</span> : null}
        </div>
        <div
          className={`rounded border px-2.5 py-1.5 text-[12px] leading-5 ${
            isUser
              ? 'border-editor-selected-quiet bg-editor-selected-quiet text-editor-selected-quiet-text'
              : 'border-editor-border bg-editor-panel-well text-text-primary'
          }`}
        >
          <p className="whitespace-pre-wrap break-words">{message.body}</p>
        </div>
      </div>
    </div>
  );
}

interface LivePromptComposerProps {
  isContextReady: boolean;
  onSessionEvent?: (event: LiveSessionEvent) => void;
}

const AGENT_QUICK_START_KEYS = ['recoverHighlights', 'liftShadows', 'naturalContrast', 'brightenGently'] as const;

const createLiveSessionEvent = (role: AgentChatMessage['role'], body: string, suffix: string): LiveSessionEvent => ({
  body,
  id: `live-agent-session-${Date.now()}-${suffix}`,
  role,
  timestamp: 'now',
});

function LivePromptComposer({ isContextReady, onSessionEvent }: LivePromptComposerProps) {
  const { t } = useTranslation();
  const promptInputRef = useRef<HTMLTextAreaElement | null>(null);
  const activeOperationRef = useRef<{ cancellationIds: string[]; cancelled: boolean; id: string } | null>(null);
  const previewRequestRef = useRef(0);
  const restorePromptFocusRef = useRef(false);
  const [prompt, setPrompt] = useState('');
  const [result, setResult] = useState<LivePromptResult>({ status: 'idle' });
  const [toneAdjustmentDraft, setToneAdjustmentDraft] = useState<AgentToneAdjustmentPromptDraft | null>(null);
  const [rollbackSnapshot, setRollbackSnapshot] = useState<AgentRollbackSnapshot | null>(null);
  const rollbackValidationKey = useEditorStore((state) =>
    JSON.stringify({
      adjustments: state.adjustments,
      finalPreviewUrl: state.finalPreviewUrl,
      historyIndex: state.historyIndex,
      selectedImagePath: state.selectedImage?.path ?? null,
      uncroppedAdjustedPreviewUrl: state.uncroppedAdjustedPreviewUrl,
    }),
  );
  const rollbackValidation = useMemo(() => {
    void rollbackValidationKey;
    return rollbackSnapshot === null ? null : validateAgentRollbackSnapshot(rollbackSnapshot);
  }, [rollbackSnapshot, rollbackValidationKey]);
  const canRun =
    isContextReady && result.status !== 'applying' && result.status !== 'cancelling' && result.status !== 'previewing';
  const canApply =
    isContextReady &&
    toneAdjustmentDraft?.supported === true &&
    result.proposal?.status === 'ready' &&
    result.status === 'dry_run_ready';
  const canCancel = result.status === 'previewing' && activeOperationRef.current !== null;
  const canRollback =
    rollbackSnapshot !== null && rollbackValidation?.state === 'available' && result.status === 'applied';
  const canSubmit = canRun && prompt.trim().length > 0;
  useEffect(
    () => () => {
      previewRequestRef.current += 1;
    },
    [],
  );
  useEffect(
    () => () => {
      if (result.proposalId !== undefined)
        void agentSelectedImageProposalRuntime.release(result.proposalId, 'superseded');
    },
    [result.proposalId],
  );
  useEffect(() => {
    if (result.proposalId === undefined || result.status !== 'dry_run_ready') return;
    let active = true;
    void agentSelectedImageProposalRuntime.ensureReady(result.proposalId).then((proposal) => {
      if (!active || proposal?.status === 'ready') return;
      setResult((current) => {
        if (current.proposalId !== result.proposalId) return current;
        const { previewAfterUrl: _previewAfterUrl, previewBeforeUrl: _previewBeforeUrl, ...blockedResult } = current;
        return {
          ...blockedResult,
          error: proposal?.warnings[0] ?? 'Selected-image proposal is stale. Render a new preview before applying.',
          ...(proposal === undefined ? {} : { proposal }),
          status: 'blocked',
        };
      });
    });
    return () => {
      active = false;
    };
  }, [result.proposalId, result.status, rollbackValidationKey]);
  useEffect(() => {
    if (!restorePromptFocusRef.current) return;
    if (!['applied', 'blocked', 'cancelled', 'dry_run_ready', 'failed', 'idle', 'rolled_back'].includes(result.status))
      return;
    restorePromptFocusRef.current = false;
    const frame = window.requestAnimationFrame(() => promptInputRef.current?.focus({ preventScroll: true }));
    return () => window.cancelAnimationFrame(frame);
  }, [result.status]);
  let statusLabel;

  switch (result.status) {
    case 'applied':
      statusLabel = t('editor.ai.agent.composer.status.applied');
      break;
    case 'applying':
      statusLabel = t('editor.ai.agent.composer.status.applying');
      break;
    case 'approval_required':
      statusLabel = t('editor.ai.agent.composer.status.approval_required');
      break;
    case 'blocked':
      statusLabel = t('editor.ai.agent.composer.status.blocked');
      break;
    case 'cancelled':
      statusLabel = 'Edit preview cancelled';
      break;
    case 'cancelling':
      statusLabel = 'Cancelling edit preview';
      break;
    case 'dry_run_ready':
      statusLabel = t('editor.ai.agent.composer.status.dry_run_ready');
      break;
    case 'failed':
      statusLabel = t('editor.ai.agent.composer.status.failed');
      break;
    case 'rolled_back':
      statusLabel = t('editor.ai.agent.composer.status.rolled_back');
      break;
    case 'idle':
      statusLabel = t('editor.ai.agent.composer.status.idle');
      break;
    case 'previewing':
      statusLabel = 'Preparing preview';
      break;
  }

  const runDryRun = async () => {
    const requestedPrompt = (promptInputRef.current?.value ?? prompt).trim();
    if (!isContextReady || requestedPrompt.length === 0) return;
    const previewRequest = ++previewRequestRef.current;
    const operationId = `agent_chat_basic_tone_${Date.now()}`;
    const requestId = `agent-live-basic-tone-${Date.now()}`;
    const operation = { cancellationIds: [] as string[], cancelled: false, id: requestId };
    activeOperationRef.current = operation;

    try {
      const initialState = useEditorStore.getState();
      const selectedImagePath = initialState.selectedImage?.path;
      if (selectedImagePath === undefined) throw new Error('Select an image before previewing an AI edit.');
      setToneAdjustmentDraft(null);
      setResult({ status: 'previewing' });
      onSessionEvent?.(createLiveSessionEvent('user', requestedPrompt, 'prompt'));
      setPrompt('');
      const snapshot = buildAgentImageContextSnapshot();
      const draft = buildAgentToneAdjustmentPromptDraft(requestedPrompt, initialState.adjustments);
      if (!draft.supported) {
        const nextResult = {
          error: draft.reason,
          status: 'blocked',
          toneAdjustmentDraft: draft,
        } satisfies LivePromptResult;
        setResult(nextResult);
        restorePromptFocusRef.current = true;
        return;
      }

      const dryRun = await dryRunAgentToneAdjustment({
        adjustments: draft.requestedAdjustments,
        expectedGraphRevision: snapshot.graphRevision,
        expectedRecipeHash: snapshot.initialPreview.recipeHash,
        operationId,
        requestId,
        sessionId: 'agent-chat-shell',
      });
      if (operation.cancelled || activeOperationRef.current?.id !== operation.id) return;
      const baseRequest = {
        expectedRecipeHash: snapshot.initialPreview.recipeHash,
        requestId: `${requestId}:proposal-base`,
      };
      const baseContext = createAgentTypedToolExecutionContext({
        arguments: baseRequest,
        callId: baseRequest.requestId,
        deadlineMs: 60_000,
        requestId: baseRequest.requestId,
        sessionId: 'agent-chat-shell',
      });
      operation.cancellationIds.push(baseContext.cancellationId);
      const basePreview = await dispatchAgentTypedEditorTool({
        args: baseRequest,
        context: baseContext,
        toolName: RAW_ENGINE_IMAGE_GET_PREVIEW_TOOL_NAME,
      });
      if (operation.cancelled || activeOperationRef.current?.id !== operation.id) return;
      const proposalRequestId = `${requestId}:proposal`;
      const proposalContext = createAgentTypedToolExecutionContext({
        arguments: {
          expectedGraphRevision: snapshot.graphRevision,
          expectedRecipeHash: snapshot.initialPreview.recipeHash,
          expectedSelectedImagePath: selectedImagePath,
        },
        callId: proposalRequestId,
        deadlineMs: 60_000,
        requestId: proposalRequestId,
        sessionId: 'agent-chat-shell',
      });
      operation.cancellationIds.push(proposalContext.cancellationId);
      const baseAttachment = basePreview.receipt.attachment;
      const proposal = await dispatchAgentTypedEditorTool({
        args: {
          basePreview: {
            accessScope: baseAttachment.accessScope,
            artifactId: baseAttachment.artifactId,
            byteLength: baseAttachment.byteLength,
            colorPipeline: baseAttachment.colorPipeline,
            contentHash: baseAttachment.contentHash,
            dimensions: baseAttachment.dimensions,
            encodedFormat: baseAttachment.encodedFormat,
            expiresAt: baseAttachment.expiresAt,
            mediaType: baseAttachment.mediaType,
            quality: baseAttachment.quality,
            recipeHash: baseAttachment.revision.recipeHash,
            renderHash: baseAttachment.revision.renderHash,
          },
          cancellationId: proposalContext.cancellationId,
          commandType: RAW_ENGINE_AGENT_SELECTED_IMAGE_PROPOSAL_RENDER_TOOL_NAME,
          deadlineAt: proposalContext.deadlineAt,
          dryRun: true,
          dryRunPlan: {
            planHash: dryRun.dryRunPlanHash,
            planId: dryRun.dryRunPlanId,
            predictedGraphRevision: dryRun.predictedGraphRevision,
          },
          edit: { kind: 'basic_tone_v1', patch: draft.requestedAdjustments },
          expectedGraphRevision: snapshot.graphRevision,
          expectedRecipeHash: snapshot.initialPreview.recipeHash,
          expectedRenderHash: snapshot.initialPreview.renderHash,
          expectedSelectedImagePath: selectedImagePath,
          idempotencyKey: proposalContext.idempotencyKey,
          lineage: { callId: proposalContext.callId, parentCallId: baseContext.callId },
          operationId,
          requestedPreview: { longEdgePx: 1536, maxBytes: 8 * 1024 * 1024, quality: 0.86 },
          requestId: proposalRequestId,
          sessionId: 'agent-chat-shell',
        },
        context: proposalContext,
        toolName: RAW_ENGINE_AGENT_SELECTED_IMAGE_PROPOSAL_RENDER_TOOL_NAME,
      });
      const previewAfterUrl = agentSelectedImageProposalRuntime.getPreviewUrl(proposal.proposalId, 'after');
      const previewBeforeUrl = agentSelectedImageProposalRuntime.getPreviewUrl(proposal.proposalId, 'before');
      const currentSnapshot = buildAgentImageContextSnapshot();
      const previewIsCurrent =
        previewRequest === previewRequestRef.current &&
        !operation.cancelled &&
        activeOperationRef.current?.id === operation.id &&
        currentSnapshot.activeImagePath === selectedImagePath &&
        currentSnapshot.graphRevision === snapshot.graphRevision &&
        currentSnapshot.initialPreview.recipeHash === snapshot.initialPreview.recipeHash;
      if (!previewIsCurrent) {
        if (operation.cancelled) {
          setResult({ status: 'cancelled' });
        } else {
          setResult({
            error: 'Selected image changed while the edit proposal was rendering.',
            status: 'blocked',
          });
          restorePromptFocusRef.current = true;
        }
        await agentSelectedImageProposalRuntime.release(
          proposal.proposalId,
          operation.cancelled ? 'cancelled' : 'stale',
        );
        return;
      }
      if (proposal.status !== 'ready' || previewAfterUrl === undefined || previewBeforeUrl === undefined) {
        setResult({
          error: proposal.warnings[0] ?? `Selected-image proposal ended as ${proposal.status}.`,
          proposal,
          proposalId: proposal.proposalId,
          status: 'blocked',
        });
        restorePromptFocusRef.current = true;
        return;
      }
      setToneAdjustmentDraft(draft);

      const nextResult = {
        dryRunReceipt: dryRun.receipt,
        previewAfterUrl,
        previewBeforeUrl,
        proposal,
        proposalId: proposal.proposalId,
        recipeName: dryRun.receipt.dryRunPlanHash,
        status: 'dry_run_ready',
        toneAdjustmentDraft: draft,
      } satisfies LivePromptResult;
      setResult(nextResult);
      restorePromptFocusRef.current = true;
      onSessionEvent?.(createLiveSessionEvent('assistant', draft.summary, 'dry-run-ready'));
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : t('editor.ai.agent.composer.unknownError');

      const nextResult = {
        error: errorMessage,
        status: 'failed',
      } satisfies LivePromptResult;
      setResult(nextResult);
      restorePromptFocusRef.current = true;
    } finally {
      if (activeOperationRef.current?.id === operation.id) {
        activeOperationRef.current = null;
        if (operation.cancelled) setResult({ status: 'cancelled' });
      }
    }
  };

  const cancelActiveOperation = () => {
    const operation = activeOperationRef.current;
    if (operation === null) return;
    operation.cancelled = true;
    for (const cancellationId of operation.cancellationIds) cancelRawEngineAppServerTypedDispatch(cancellationId);
    previewRequestRef.current += 1;

    const nextResult = { ...result, status: 'cancelling' } satisfies LivePromptResult;
    setResult(nextResult);
    restorePromptFocusRef.current = true;
  };

  const applyDryRun = async () => {
    if (!canApply || toneAdjustmentDraft?.supported !== true) return;

    const operation = { cancellationIds: [] as string[], cancelled: false, id: `agent-chat-apply-${Date.now()}` };
    activeOperationRef.current = operation;
    try {
      const proposal =
        result.proposalId === undefined
          ? undefined
          : await agentSelectedImageProposalRuntime.ensureReady(result.proposalId);
      if (proposal?.status !== 'ready') {
        throw new Error(
          'Selected-image proposal is stale or no longer available. Render a new preview before applying.',
        );
      }
      setRollbackSnapshot(createAgentRollbackSnapshot());

      const applyingResult = { ...result, status: 'applying' } satisfies LivePromptResult;
      setResult(applyingResult);
      const requestId = operation.id;
      const snapshot = buildAgentImageContextSnapshot();
      const dryRunReceipt = result.dryRunReceipt;
      if (dryRunReceipt === undefined) throw new Error('Typed basic-tone apply requires a prior dry-run receipt.');
      await applyAgentToneAdjustment({
        acceptedPlanHash: dryRunReceipt.dryRunPlanHash,
        acceptedPlanId: dryRunReceipt.dryRunPlanId,
        adjustments: toneAdjustmentDraft.requestedAdjustments,
        expectedGraphRevision: dryRunReceipt.sourceGraphRevision,
        expectedRecipeHash: snapshot.initialPreview.recipeHash,
        operationId: dryRunReceipt.operationId,
        requestId,
        sessionId: 'agent-chat-shell',
      });

      const afterSnapshot = buildAgentImageContextSnapshot();
      setRollbackSnapshot((checkpoint) =>
        checkpoint === null
          ? null
          : {
              ...checkpoint,
              expectedCurrentGraphRevision: afterSnapshot.graphRevision,
              expectedCurrentRecipeHash: afterSnapshot.initialPreview.recipeHash,
            },
      );
      const previewRequestId = `${requestId}-preview-refresh`;
      const previewRefresh = renderAgentReadOnlyPreview({
        expectedRecipeHash: afterSnapshot.initialPreview.recipeHash,
        purpose: 'refresh',
        requestId: previewRequestId,
        sourceToolName: AGENT_TONE_ADJUSTMENT_APPLY_TOOL_NAME,
        turn: useEditorStore.getState().historyIndex,
      });
      const previewRefreshReceipt = previewRefresh.receipt;
      if (previewRefreshReceipt === undefined) {
        throw new Error('Typed basic-tone apply requires a preview refresh receipt.');
      }
      if (operation.cancelled || activeOperationRef.current?.id !== operation.id) {
        return;
      }

      const {
        previewAfterUrl: _previewAfterUrl,
        previewBeforeUrl: _previewBeforeUrl,
        proposal: _proposal,
        proposalId: _proposalId,
        ...appliedResult
      } = applyingResult;
      const nextResult = {
        ...appliedResult,
        dryRunReceipt,
        recipeName: previewRefresh.preview.recipeHash,
        status: 'applied',
        toneAdjustmentDraft,
      } satisfies LivePromptResult;
      if (result.proposalId !== undefined)
        await agentSelectedImageProposalRuntime.release(result.proposalId, 'released');
      setResult(nextResult);
      restorePromptFocusRef.current = true;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : t('editor.ai.agent.composer.unknownError');

      const nextResult = {
        ...result,
        error: errorMessage,
        status: 'failed',
      } satisfies LivePromptResult;
      setResult(nextResult);
      restorePromptFocusRef.current = true;
    } finally {
      if (activeOperationRef.current?.id === operation.id) activeOperationRef.current = null;
    }
  };

  const rollbackApply = async () => {
    if (rollbackSnapshot === null) return;
    const validation = validateAgentRollbackSnapshot(rollbackSnapshot);
    if (validation.state === 'invalidated') {
      setResult({
        error: 'The image changed, so this edit cannot be reverted.',
        status: 'blocked',
      });
      restorePromptFocusRef.current = true;
      return;
    }

    const rollbackRequestId = `agent-live-rollback-${Date.now()}`;
    agentHistoryRollbackResponseSchema.parse(
      await dispatchAgentTypedEditorTool({
        args: {
          checkpoint: {
            adjustments: rollbackSnapshot.adjustments,
            activeImagePath: rollbackSnapshot.activeImagePath,
            graphRevision: rollbackSnapshot.graphRevision,
            historyIndex: rollbackSnapshot.historyIndex,
            lastBasicToneCommand: rollbackSnapshot.lastBasicToneCommand,
            previewRecipeHash: rollbackSnapshot.recipeHash,
            previewRef: rollbackSnapshot.finalPreviewUrl,
            sessionId: 'agent-chat-shell',
            uncroppedPreviewRef: rollbackSnapshot.uncroppedAdjustedPreviewUrl,
          },
          expectedCurrentGraphRevision: validation.currentGraphRevision,
          expectedCurrentPreviewRecipeHash: validation.currentRecipeHash,
          expectedSelectedImagePath: validation.currentImagePath,
          requestId: rollbackRequestId,
          scope: 'session_start',
          sessionId: 'agent-chat-shell',
        },
        context: createAgentTypedToolExecutionContext({
          arguments: {
            checkpoint: {
              adjustments: rollbackSnapshot.adjustments,
              activeImagePath: rollbackSnapshot.activeImagePath,
              graphRevision: rollbackSnapshot.graphRevision,
              historyIndex: rollbackSnapshot.historyIndex,
              lastBasicToneCommand: rollbackSnapshot.lastBasicToneCommand,
              previewRecipeHash: rollbackSnapshot.recipeHash,
              previewRef: rollbackSnapshot.finalPreviewUrl,
              sessionId: 'agent-chat-shell',
              uncroppedPreviewRef: rollbackSnapshot.uncroppedAdjustedPreviewUrl,
            },
            expectedCurrentGraphRevision: validation.currentGraphRevision,
            expectedCurrentPreviewRecipeHash: validation.currentRecipeHash,
            expectedSelectedImagePath: validation.currentImagePath,
            requestId: rollbackRequestId,
            scope: 'session_start',
            sessionId: 'agent-chat-shell',
          },
          callId: rollbackRequestId,
          requestId: rollbackRequestId,
          sessionId: 'agent-chat-shell',
        }),
        toolName: AGENT_HISTORY_ROLLBACK_TOOL_NAME,
      }),
    );
    previewRequestRef.current += 1;
    setRollbackSnapshot(null);
    const nextResult = { status: 'rolled_back' } satisfies LivePromptResult;
    setResult(nextResult);
    restorePromptFocusRef.current = true;
  };

  const hasPreview = result.previewBeforeUrl !== undefined && result.previewAfterUrl !== undefined;
  const isBusy = result.status === 'applying' || result.status === 'cancelling' || result.status === 'previewing';
  const showLifecycle = result.status !== 'idle';
  const lifecycleIcon =
    result.status === 'applied' || result.status === 'dry_run_ready' || result.status === 'rolled_back' ? (
      <Check aria-hidden="true" size={13} strokeWidth={2.4} />
    ) : result.status === 'applying' || result.status === 'cancelling' || result.status === 'previewing' ? (
      <LoaderCircle aria-hidden="true" className="animate-spin" size={13} strokeWidth={2} />
    ) : result.status === 'blocked' || result.status === 'failed' ? (
      <CircleAlert aria-hidden="true" size={13} strokeWidth={2} />
    ) : (
      <X aria-hidden="true" size={13} strokeWidth={2} />
    );

  return (
    <form
      className="pointer-events-auto relative z-10 mt-2 shrink-0 space-y-2 border-t border-editor-border bg-editor-panel pt-2"
      data-live-prompt-status={result.status}
      data-testid="agent-live-prompt-composer"
      onSubmit={(event) => {
        event.preventDefault();
        void runDryRun();
      }}
    >
      {showLifecycle ? (
        <section
          aria-live="polite"
          className="overflow-hidden rounded border border-editor-border bg-editor-panel-well"
          data-proposal-state={result.status}
          data-testid="agent-photographer-result"
        >
          <div className="flex min-h-9 items-center gap-2 border-b border-editor-border px-2.5 py-1.5">
            <span
              className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-sm ${
                result.status === 'blocked' || result.status === 'failed'
                  ? 'bg-editor-danger/10 text-editor-danger'
                  : 'bg-editor-panel-raised text-text-secondary'
              }`}
            >
              {lifecycleIcon}
            </span>
            <div className="min-w-0">
              <p className="truncate text-[11px] font-semibold leading-4 text-text-primary">
                {result.status === 'dry_run_ready' ? t('editor.ai.agent.proposal.title') : statusLabel}
              </p>
              <p className="truncate text-[10px] leading-3 text-text-secondary">
                {result.status === 'dry_run_ready'
                  ? t('editor.ai.agent.composer.status.dry_run_ready')
                  : isBusy
                    ? 'Selected image remains unchanged until the edit is applied.'
                    : result.status === 'applied'
                      ? 'Current preview reflects the accepted edit.'
                      : result.status === 'rolled_back'
                        ? 'The selected image returned to its previous edit state.'
                        : undefined}
              </p>
            </div>
          </div>

          {hasPreview ? (
            <div className="grid grid-cols-2 gap-px bg-editor-border" data-testid="agent-photographer-before-after">
              <figure className="min-w-0 bg-editor-panel p-1.5">
                <figcaption className="mb-1 text-[10px] font-medium uppercase leading-3 text-text-tertiary">
                  {t('editor.ai.agent.previewLineage.role.before')}
                </figcaption>
                <img
                  alt={t('editor.ai.agent.previewLineage.role.before')}
                  className="aspect-[4/3] w-full rounded-sm object-cover"
                  src={result.previewBeforeUrl}
                />
              </figure>
              <figure className="min-w-0 bg-editor-panel p-1.5">
                <figcaption className="mb-1 text-[10px] font-medium uppercase leading-3 text-text-tertiary">
                  {t('editor.ai.agent.proposal.after')}
                </figcaption>
                <img
                  alt={t('editor.ai.agent.proposal.after')}
                  className="aspect-[4/3] w-full rounded-sm object-cover"
                  src={result.previewAfterUrl}
                />
              </figure>
            </div>
          ) : null}

          <div className="space-y-1.5 px-2.5 py-2">
            {isBusy ? (
              <div
                className="flex items-center gap-1.5 text-[11px] leading-4 text-text-secondary"
                data-testid="agent-tool-state"
              >
                <Wrench aria-hidden="true" size={12} strokeWidth={1.8} />
                <span>{result.status === 'applying' ? t('editor.ai.agent.composer.applying') : statusLabel}</span>
              </div>
            ) : null}
            {result.proposal ? (
              <div
                className="flex items-center justify-between gap-2"
                data-testid="agent-selected-image-proposal-state"
              >
                <span className="text-[10px] font-medium uppercase leading-3 text-text-tertiary">
                  {t('editor.ai.agent.proposal.title')}
                </span>
                <span className="shrink-0 text-[10px] font-semibold uppercase leading-3 text-text-primary">
                  {result.proposal.status}
                </span>
              </div>
            ) : null}
            {result.error ? (
              <p className="break-words text-[11px] leading-4 text-editor-danger" data-testid="agent-live-prompt-error">
                {result.error}
              </p>
            ) : null}
            {result.proposal ? (
              <details className="border-t border-editor-border pt-1.5 text-[10px] leading-4 text-text-secondary">
                <summary className="cursor-pointer text-text-secondary focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-editor-focus-ring">
                  {t('editor.ai.agent.composer.inspectState')}
                </summary>
                <dl className="mt-1 grid grid-cols-2 gap-x-2 gap-y-0.5">
                  <div className="min-w-0">
                    <dt className="text-text-tertiary">{t('editor.ai.agent.selectedImageLoop.before')}</dt>
                    <dd className="truncate text-text-primary">{result.proposal.base.graphRevision}</dd>
                  </div>
                  <div className="min-w-0">
                    <dt className="text-text-tertiary">{t('editor.ai.agent.walkthrough.plan')}</dt>
                    <dd className="truncate text-text-primary">{result.proposal.dryRunPlan.planId}</dd>
                  </div>
                </dl>
              </details>
            ) : null}
            {canApply || canCancel || canRollback ? (
              <div className="flex items-center justify-end gap-1.5 border-t border-editor-border pt-2">
                {canCancel ? (
                  <button
                    aria-label={t('editor.ai.agent.composer.cancel')}
                    className="inline-flex h-7 w-7 items-center justify-center rounded border border-editor-danger/40 text-editor-danger transition-colors hover:bg-editor-danger/10 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-editor-focus-ring"
                    data-cancel-boundary="late-result-guard"
                    data-testid="agent-live-prompt-cancel"
                    data-tooltip={t('editor.ai.agent.composer.cancel')}
                    onClick={cancelActiveOperation}
                    type="button"
                  >
                    <X aria-hidden="true" size={14} />
                  </button>
                ) : null}
                {canRollback ? (
                  <button
                    className="inline-flex h-7 items-center gap-1.5 rounded px-2 text-[11px] font-medium text-text-secondary transition-colors hover:bg-editor-panel-raised hover:text-text-primary focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-editor-focus-ring"
                    data-discard-control="rollback-session"
                    data-testid="agent-live-prompt-rollback"
                    onClick={rollbackApply}
                    type="button"
                  >
                    <RotateCcw aria-hidden="true" size={13} />
                    {t('editor.ai.agent.composer.revertEdit')}
                  </button>
                ) : null}
                {canApply ? (
                  <button
                    className="inline-flex h-7 items-center gap-1.5 rounded bg-editor-primary-active px-2.5 text-[11px] font-semibold text-editor-primary-active-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-editor-focus-ring disabled:bg-editor-panel-raised disabled:text-text-tertiary"
                    data-testid="agent-live-prompt-apply"
                    onClick={() => {
                      void applyDryRun();
                    }}
                    type="button"
                  >
                    <Check aria-hidden="true" size={13} strokeWidth={2.4} />
                    {t('editor.ai.agent.composer.apply')}
                  </button>
                ) : null}
              </div>
            ) : null}
          </div>
        </section>
      ) : null}

      <div className="rounded border border-editor-border bg-editor-panel-well p-2">
        <label className="sr-only" htmlFor="agent-live-prompt-input">
          {t('editor.ai.agent.composer.label')}
        </label>
        <textarea
          className="min-h-14 w-full resize-y bg-transparent px-1 py-0.5 text-[12px] leading-5 text-text-primary outline-none placeholder:text-text-tertiary disabled:cursor-not-allowed"
          data-testid="agent-live-prompt-input"
          id="agent-live-prompt-input"
          disabled={!isContextReady}
          onChange={(event) => {
            setPrompt(event.target.value);
          }}
          onMouseDown={() => {
            promptInputRef.current?.focus();
          }}
          onKeyDown={(event) => {
            if (event.key === 'Escape' && canCancel) {
              event.preventDefault();
              cancelActiveOperation();
              return;
            }
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              void runDryRun();
            }
          }}
          placeholder={t('editor.ai.agent.composer.placeholder')}
          ref={promptInputRef}
          value={prompt}
        />

        <div className="mt-1.5 flex items-end justify-between gap-2 border-t border-editor-border pt-1.5">
          <div className="flex min-w-0 flex-wrap gap-1" data-testid="agent-live-prompt-quick-starts">
            {AGENT_QUICK_START_KEYS.map((key) => (
              <button
                className="rounded-sm bg-editor-panel-raised px-1.5 py-1 text-[10px] leading-3 text-text-secondary transition-colors hover:bg-editor-selected-quiet hover:text-text-primary focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-editor-focus-ring"
                key={key}
                onClick={() => {
                  const nextPrompt = t(`editor.ai.agent.composer.quickStarts.${key}`);
                  setPrompt(nextPrompt);
                  promptInputRef.current?.focus();
                }}
                type="button"
              >
                {t(`editor.ai.agent.composer.quickStarts.${key}`)}
              </button>
            ))}
          </div>

          <div className="flex shrink-0 items-center">
            <button
              aria-label={t('editor.ai.agent.composer.previewEdit')}
              className="inline-flex h-7 w-7 items-center justify-center rounded bg-editor-primary-active text-editor-primary-active-text transition-colors hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-editor-focus-ring disabled:bg-editor-panel-raised disabled:text-text-tertiary"
              data-testid="agent-live-prompt-run"
              data-native-accessibility-input="reads-textarea-dom-value"
              data-tooltip={t('editor.ai.agent.composer.previewEdit')}
              disabled={!canSubmit}
              onClick={() => {
                void runDryRun();
              }}
              type="button"
            >
              <Send aria-hidden="true" size={14} />
              <span className="sr-only">{t('editor.ai.agent.composer.previewEdit')}</span>
            </button>
          </div>
        </div>
      </div>
    </form>
  );
}

export default function AgentChatShell({ transcript }: AgentChatShellProps) {
  const { t } = useTranslation();
  const [liveSessionEvents, setLiveSessionEvents] = useState<LiveSessionEvent[]>([]);
  const isContextReady = transcript.toolCalls.some(
    (toolCall) => toolCall.toolName === 'rawengine.live_context' && toolCall.status === 'succeeded',
  );
  const timeline = buildAgentChatTimeline(transcript, liveSessionEvents);
  const visibleToolCalls = transcript.toolCalls.filter(
    (toolCall) => toolCall.mode !== 'read' || toolCall.status !== 'succeeded',
  );
  return (
    <section
      className="flex h-full min-h-0 flex-col overflow-hidden"
      data-live-session-event-count={liveSessionEvents.length}
      data-live-session-state={isContextReady ? 'ready' : 'blocked'}
      data-testid="agent-chat-shell"
    >
      <div
        className="flex min-h-0 flex-1 flex-col justify-end gap-3 overflow-y-auto pr-0.5"
        data-testid="agent-chat-messages"
      >
        <div
          className="flex items-center gap-1.5 text-[10px] leading-3 text-text-secondary"
          data-testid="agent-chat-context-state"
        >
          <Sparkles aria-hidden="true" size={12} strokeWidth={1.8} />
          <span className="truncate">
            {isContextReady ? transcript.sessionTitle : 'Select an image to start an edit.'}
          </span>
        </div>
        {visibleToolCalls.length > 0 ? (
          <div className="flex flex-wrap gap-1" data-testid="agent-chat-tool-states">
            {visibleToolCalls.map((toolCall) => (
              <span
                className="inline-flex max-w-full items-center gap-1 rounded-sm border border-editor-border bg-editor-panel-well px-1.5 py-0.5 text-[10px] leading-3 text-text-secondary"
                data-tool-status={toolCall.status}
                key={toolCall.id}
                title={toolCall.summary}
              >
                <Wrench aria-hidden="true" size={10} strokeWidth={1.8} />
                <span className="truncate">{toolCall.title}</span>
              </span>
            ))}
          </div>
        ) : null}
        {timeline.length === 0 ? (
          <div className="pt-4 text-[12px] leading-5 text-text-secondary" data-testid="agent-chat-empty-state">
            {t('editor.ai.agent.composer.describeEdit')}
          </div>
        ) : (
          timeline.map((message) => <MessageBubble key={message.id} message={message} />)
        )}
      </div>

      <LivePromptComposer
        isContextReady={isContextReady}
        onSessionEvent={(event) => {
          setLiveSessionEvents((events) => [...events, event]);
        }}
      />
    </section>
  );
}
