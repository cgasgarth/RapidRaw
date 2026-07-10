import { RotateCcw, Send } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type {
  AgentChatMessage,
  AgentChatTranscript,
  AgentInitialPromptPreviewContext,
} from '../../../../schemas/agent/agentChatTranscriptSchemas';
import { useEditorStore } from '../../../../store/useEditorStore';
import { buildAgentImageContextSnapshot } from '../../../../utils/agent/context/agentImageContextSnapshot';
import { renderAgentReadOnlyPreview } from '../../../../utils/agent/context/agentReadOnlyAppServerTools';
import { dispatchAgentLiveEditorTool } from '../../../../utils/agent/session/agentLiveToolDispatch';
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
  renderAgentToneDryRunPreview,
} from '../../../../utils/agent/tools/agentToneAdjustmentTool';

interface AgentChatShellProps {
  transcript: AgentChatTranscript;
}

type LivePromptStatus =
  | 'applied'
  | 'applying'
  | 'approval_required'
  | 'blocked'
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
  recipeName?: string;
  toneAdjustmentDraft?: AgentToneAdjustmentPromptDraft;
  status: LivePromptStatus;
}

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
      <div
        className={`max-w-[92%] rounded-md px-3 py-2 text-[12px] leading-5 ${
          isUser ? 'bg-editor-selected-quiet text-editor-selected-quiet-text' : 'bg-editor-panel-well text-text-primary'
        }`}
      >
        <p>{message.body}</p>
      </div>
    </div>
  );
}

interface LivePromptComposerProps {
  initialPromptPreviewContext: AgentInitialPromptPreviewContext | undefined;
  isContextReady: boolean;
  onSessionEvent?: (event: LiveSessionEvent) => void;
}

const AGENT_QUICK_START_KEYS = ['recoverHighlights', 'liftShadows', 'naturalContrast', 'brightenGently'] as const;

interface LiveSessionEvent {
  body: string;
  id: string;
  role: AgentChatMessage['role'];
  timestamp: string;
}

const createLiveSessionEvent = (role: AgentChatMessage['role'], body: string, suffix: string): LiveSessionEvent => ({
  body,
  id: `live-agent-session-${Date.now()}-${suffix}`,
  role,
  timestamp: 'now',
});

function LivePromptComposer({ initialPromptPreviewContext, isContextReady, onSessionEvent }: LivePromptComposerProps) {
  const { t } = useTranslation();
  const promptInputRef = useRef<HTMLTextAreaElement | null>(null);
  const activeOperationRef = useRef<{ cancelled: boolean; id: string } | null>(null);
  const previewRequestRef = useRef(0);
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
  const canApply = isContextReady && toneAdjustmentDraft?.supported === true && result.status === 'dry_run_ready';
  const canCancel = result.status === 'applying' && activeOperationRef.current !== null;
  const canRollback =
    rollbackSnapshot !== null && rollbackValidation?.state === 'available' && result.status === 'applied';
  useEffect(() => {
    const previewUrl = result.previewAfterUrl;
    return () => {
      if (previewUrl?.startsWith('blob:')) URL.revokeObjectURL(previewUrl);
    };
  }, [result.previewAfterUrl]);
  useEffect(
    () => () => {
      previewRequestRef.current += 1;
    },
    [],
  );
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

    try {
      const initialState = useEditorStore.getState();
      const selectedImagePath = initialState.selectedImage?.path;
      if (selectedImagePath === undefined) throw new Error('Select an image before previewing an AI edit.');
      setToneAdjustmentDraft(null);
      setResult({ status: 'previewing' });
      onSessionEvent?.(createLiveSessionEvent('user', requestedPrompt, 'prompt'));
      const snapshot = buildAgentImageContextSnapshot();
      const draft = buildAgentToneAdjustmentPromptDraft(requestedPrompt, initialState.adjustments);
      if (!draft.supported) {
        const nextResult = {
          error: draft.reason,
          status: 'blocked',
          toneAdjustmentDraft: draft,
        } satisfies LivePromptResult;
        setResult(nextResult);
        onSessionEvent?.(createLiveSessionEvent('assistant', draft.summary, 'dry-run-blocked'));
        return;
      }

      const operationId = `agent_chat_basic_tone_${Date.now()}`;
      const requestId = `agent-live-basic-tone-${Date.now()}`;
      const dryRun = await dryRunAgentToneAdjustment({
        adjustments: draft.requestedAdjustments,
        expectedGraphRevision: snapshot.graphRevision,
        expectedRecipeHash: snapshot.initialPreview.recipeHash,
        operationId,
        requestId,
        sessionId: 'agent-chat-shell',
      });
      const previewAfterUrl = await renderAgentToneDryRunPreview({
        baseAdjustments: initialState.adjustments,
        path: selectedImagePath,
        patch: draft.requestedAdjustments,
      });
      const currentSnapshot = buildAgentImageContextSnapshot();
      const previewIsCurrent =
        previewRequest === previewRequestRef.current &&
        currentSnapshot.activeImagePath === selectedImagePath &&
        currentSnapshot.graphRevision === snapshot.graphRevision &&
        currentSnapshot.initialPreview.recipeHash === snapshot.initialPreview.recipeHash;
      if (!previewIsCurrent) {
        URL.revokeObjectURL(previewAfterUrl);
        return;
      }
      setToneAdjustmentDraft(draft);

      const nextResult = {
        dryRunReceipt: dryRun.receipt,
        previewAfterUrl,
        recipeName: dryRun.receipt.dryRunPlanHash,
        status: 'dry_run_ready',
        toneAdjustmentDraft: draft,
      } satisfies LivePromptResult;
      setResult(nextResult);
      onSessionEvent?.(
        createLiveSessionEvent(
          'assistant',
          `${t('editor.ai.agent.composer.status.dry_run_ready')}: ${draft.summary}`,
          'dry-run-ready',
        ),
      );
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : t('editor.ai.agent.composer.unknownError');

      const nextResult = {
        error: errorMessage,
        status: 'failed',
      } satisfies LivePromptResult;
      setResult(nextResult);
      onSessionEvent?.(
        createLiveSessionEvent(
          'assistant',
          `${t('editor.ai.agent.composer.status.failed')}: ${errorMessage}`,
          'failed',
        ),
      );
    }
  };

  const cancelActiveOperation = () => {
    const operation = activeOperationRef.current;
    if (operation === null) return;
    operation.cancelled = true;

    const nextResult = { ...result, status: 'cancelling' } satisfies LivePromptResult;
    setResult(nextResult);
    onSessionEvent?.(createLiveSessionEvent('assistant', 'Edit preview cancellation requested.', 'cancel'));
  };

  const applyDryRun = async () => {
    if (!canApply || toneAdjustmentDraft?.supported !== true) return;

    const operation = { cancelled: false, id: `agent-chat-apply-${Date.now()}` };
    activeOperationRef.current = operation;
    try {
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

      const nextResult = {
        ...applyingResult,
        dryRunReceipt,
        recipeName: previewRefresh.preview.recipeHash,
        status: 'applied',
        toneAdjustmentDraft,
      } satisfies LivePromptResult;
      setResult(nextResult);
      onSessionEvent?.(createLiveSessionEvent('assistant', 'Edit applied. Preview refreshed.', 'applied'));
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : t('editor.ai.agent.composer.unknownError');

      const nextResult = {
        ...result,
        error: errorMessage,
        status: 'failed',
      } satisfies LivePromptResult;
      setResult(nextResult);
      onSessionEvent?.(
        createLiveSessionEvent(
          'assistant',
          `${t('editor.ai.agent.composer.status.failed')}: ${errorMessage}`,
          'apply-failed',
        ),
      );
    } finally {
      if (activeOperationRef.current?.id === operation.id) activeOperationRef.current = null;
    }
  };

  const rollbackApply = async () => {
    if (rollbackSnapshot === null) return;
    const validation = validateAgentRollbackSnapshot(rollbackSnapshot);
    if (validation.state === 'invalidated') {
      onSessionEvent?.(
        createLiveSessionEvent('assistant', 'The image changed, so this edit cannot be reverted.', 'rollback-blocked'),
      );
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
    if (result.previewAfterUrl?.startsWith('blob:')) URL.revokeObjectURL(result.previewAfterUrl);
    setRollbackSnapshot(null);
    const nextResult = { status: 'rolled_back' } satisfies LivePromptResult;
    setResult(nextResult);
    onSessionEvent?.(
      createLiveSessionEvent('assistant', t('editor.ai.agent.composer.status.rolled_back'), 'rolled-back'),
    );
  };

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
      {result.status === 'idle' || result.status === 'rolled_back' ? null : (
        <section
          aria-live="polite"
          className="rounded-md border border-editor-border bg-editor-panel-well p-2"
          data-testid="agent-photographer-result"
        >
          {result.status === 'dry_run_ready' || result.status === 'applied' ? null : (
            <span className="text-[12px] font-semibold text-text-primary">{statusLabel}</span>
          )}
          {result.dryRunReceipt ? (
            <div className="grid grid-cols-2 gap-2" data-testid="agent-photographer-before-after">
              <figure className="min-w-0">
                <figcaption className="mb-1 text-[10px] font-medium uppercase text-text-tertiary">
                  {t('editor.ai.agent.previewLineage.role.before')}
                </figcaption>
                <img
                  alt={t('editor.ai.agent.previewLineage.role.before')}
                  className="aspect-[4/3] w-full rounded border border-editor-border object-cover"
                  src={initialPromptPreviewContext?.previewRef}
                />
              </figure>
              <figure className="min-w-0">
                <figcaption className="mb-1 text-[10px] font-medium uppercase text-text-tertiary">
                  {t('editor.ai.agent.proposal.after')}
                </figcaption>
                <img
                  alt={t('editor.ai.agent.proposal.after')}
                  className="aspect-[4/3] w-full rounded border border-editor-border object-cover"
                  src={result.previewAfterUrl}
                />
              </figure>
            </div>
          ) : null}
          {result.error ? <p className="mt-1 text-[11px] leading-4 text-editor-danger">{result.error}</p> : null}
        </section>
      )}

      <div className="rounded-md border border-editor-border bg-editor-panel-well p-2">
        <label className="sr-only" htmlFor="agent-live-prompt-input">
          {t('editor.ai.agent.composer.label')}
        </label>
        <textarea
          className="min-h-16 w-full resize-y bg-transparent px-1 py-1 text-[12px] leading-5 text-text-primary outline-none placeholder:text-text-tertiary"
          data-testid="agent-live-prompt-input"
          id="agent-live-prompt-input"
          disabled={!isContextReady}
          onChange={(event) => {
            setPrompt(event.target.value);
          }}
          onMouseDown={() => {
            promptInputRef.current?.focus();
          }}
          placeholder={t('editor.ai.agent.composer.placeholder')}
          ref={promptInputRef}
          value={prompt}
        />

        <div className="mt-2 flex items-center justify-between gap-2 border-t border-editor-border pt-2">
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

          <div className="flex shrink-0 items-center gap-1.5">
            <button
              className="inline-flex h-8 items-center gap-1.5 rounded-md bg-editor-primary-active px-2.5 text-[11px] font-semibold text-editor-primary-active-text disabled:bg-editor-panel-raised disabled:text-text-tertiary"
              data-testid="agent-live-prompt-run"
              data-native-accessibility-input="reads-textarea-dom-value"
              disabled={!canRun}
              onClick={() => {
                void runDryRun();
              }}
              type="button"
            >
              <Send size={14} />
              {t('editor.ai.agent.composer.previewEdit')}
            </button>
            {canApply ? (
              <button
                className="h-8 rounded-md border border-editor-primary-active/40 bg-editor-primary-active px-2.5 text-[11px] font-semibold text-editor-primary-active-text"
                data-testid="agent-live-prompt-apply"
                disabled={!canApply}
                onClick={() => {
                  void applyDryRun();
                }}
                type="button"
              >
                {result.status === 'applying'
                  ? t('editor.ai.agent.composer.applying')
                  : t('editor.ai.agent.composer.apply')}
              </button>
            ) : null}
            {canCancel ? (
              <button
                className="h-8 rounded-md border border-editor-danger/40 px-2.5 text-[11px] font-medium text-editor-danger"
                data-cancel-boundary="late-result-guard"
                data-testid="agent-live-prompt-cancel"
                disabled={!canCancel}
                onClick={cancelActiveOperation}
                type="button"
              >
                {t('editor.ai.agent.composer.cancel')}
              </button>
            ) : null}
            {canRollback ? (
              <button
                className="inline-flex h-8 items-center gap-1.5 rounded-md px-2 text-[11px] font-medium text-text-secondary transition-colors hover:bg-editor-panel-raised hover:text-text-primary"
                data-discard-control="rollback-session"
                data-testid="agent-live-prompt-rollback"
                disabled={!canRollback}
                onClick={rollbackApply}
                type="button"
              >
                <RotateCcw size={14} />
                {t('editor.ai.agent.composer.revertEdit')}
              </button>
            ) : null}
          </div>
        </div>
      </div>
    </form>
  );
}

export default function AgentChatShell({ transcript }: AgentChatShellProps) {
  const [liveSessionEvents, setLiveSessionEvents] = useState<LiveSessionEvent[]>([]);
  const isContextReady = transcript.toolCalls.some(
    (toolCall) => toolCall.toolName === 'rawengine.live_context' && toolCall.status === 'succeeded',
  );
  return (
    <section
      className="flex h-full min-h-0 flex-col overflow-hidden"
      data-live-session-event-count={liveSessionEvents.length}
      data-live-session-state={isContextReady ? 'ready' : 'blocked'}
      data-testid="agent-chat-shell"
    >
      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto pr-0.5" data-testid="agent-chat-messages">
        {liveSessionEvents.map((message) => (
          <MessageBubble key={message.id} message={message} />
        ))}
        {transcript.messages
          .filter((message) => message.role !== 'system')
          .map((message) => (
            <MessageBubble key={message.id} message={message} />
          ))}
      </div>

      <LivePromptComposer
        initialPromptPreviewContext={transcript.initialPromptPreviewContext}
        isContextReady={isContextReady}
        onSessionEvent={(event) => {
          setLiveSessionEvents((events) => [...events, event]);
        }}
      />
    </section>
  );
}
