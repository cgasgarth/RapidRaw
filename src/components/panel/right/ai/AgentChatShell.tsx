import {
  AlertTriangle,
  CheckCircle2,
  CircleDashed,
  Eye,
  FileCheck2,
  RotateCcw,
  Send,
  Server,
  Sparkles,
} from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type {
  AgentArtifactReview,
  AgentAuditTranscript,
  AgentChatDryRunReview,
  AgentChatMessage,
  AgentChatToolCall,
  AgentChatTranscript,
  AgentE2eClosure,
  AgentFailureRecovery,
  AgentInitialPromptPreviewContext,
  AgentLivePromptWalkthrough,
  AgentLongEditProgress,
  AgentPrivateRawArtifacts,
  AgentReviewHandoff,
  AgentSelectedFrameScope,
  AgentSelectedImagePreviewLoopReview,
} from '../../../../schemas/agent/agentChatTranscriptSchemas';
import { useEditorStore } from '../../../../store/useEditorStore';
import { buildAgentAppServerToolReadinessSummary } from '../../../../utils/agent/context/agentAppServerToolReadiness';
import {
  AGENT_CURRENT_IMAGE_PREVIEW_LOOP_TOOL_NAME,
  type AgentCurrentImagePreviewLoopRequest,
  type AgentCurrentImagePreviewLoopResult,
  agentCurrentImagePreviewLoopResultSchema,
} from '../../../../utils/agent/context/agentCurrentImagePreviewLoop';
import {
  agentImageContextSnapshotSchema,
  buildAgentImageContextSnapshot,
} from '../../../../utils/agent/context/agentImageContextSnapshot';
import {
  AGENT_PREVIEW_RENDER_TOOL_NAME,
  AGENT_STATE_GET_TOOL_NAME,
  getAgentReadOnlyState,
  RAW_ENGINE_IMAGE_GET_PREVIEW_TOOL_NAME,
  renderAgentReadOnlyPreview,
} from '../../../../utils/agent/context/agentReadOnlyAppServerTools';
import {
  AGENT_LAYER_CREATE_TOOL_NAME,
  AGENT_LAYER_SCOPED_ADJUST_TOOL_NAME,
  AGENT_MASK_CREATE_OR_UPDATE_TOOL_NAME,
} from '../../../../utils/agent/layers/agentLayerMaskTools';
import { runAgentBoundedEditPlannerLoop } from '../../../../utils/agent/planning/agentBoundedEditPlannerLoop';
import { planAgentEditRecipe } from '../../../../utils/agent/planning/agentEditRecipePlanner';
import {
  AGENT_EXPORT_PROOF_TOOL_NAME,
  AGENT_FINAL_EXPORT_TOOL_NAME,
  agentExportProofResponseSchema,
  agentFinalExportResponseSchema,
} from '../../../../utils/agent/safety/agentExportProofTool';
import {
  type AgentSafetyPolicyDecision,
  evaluateAgentSafetyPolicy,
  inferAgentSafetyOperationKind,
} from '../../../../utils/agent/safety/agentSafetyPolicy';
import { dispatchAgentLiveEditorTool } from '../../../../utils/agent/session/agentLiveToolDispatch';
import {
  type AgentMultiTurnAppServerSessionRequest,
  type AgentMultiTurnAppServerSessionResult,
  runAgentMultiTurnAppServerSession,
} from '../../../../utils/agent/session/agentMultiTurnAppServerSession';
import {
  type AgentSelectedImageLiveSessionAuditRecord,
  applyAgentSelectedImageLiveSession,
  approveAgentSelectedImageLiveSession,
  replayAgentSelectedImageLiveSessionAudit,
  startAgentSelectedImageLiveSessionDryRun,
} from '../../../../utils/agent/session/agentSelectedImageLiveSession';
import {
  type AgentSelectedImageExportReceipt,
  type AgentSessionAuditRecord,
  type AgentSessionAuditStorageAdapter,
  appendAgentSelectedImageExportReceipt,
  appendAgentSessionAuditRecord,
} from '../../../../utils/agent/session/agentSessionAuditStore';
import {
  AGENT_HISTORY_ROLLBACK_TOOL_NAME,
  agentHistoryRollbackResponseSchema,
} from '../../../../utils/agent/session/agentSessionHistory';
import {
  AGENT_ADJUSTMENTS_APPLY_TOOL_NAME,
  AGENT_ADJUSTMENTS_DRY_RUN_TOOL_NAME,
  type AgentAdjustmentsApplyRequest,
  agentAdjustmentsApplyResponseSchema,
  agentAdjustmentsDryRunResponseSchema,
} from '../../../../utils/agent/tools/agentAdjustmentApplyTool';
import { AGENT_COLOR_APPLY_TOOL_NAME } from '../../../../utils/agent/tools/agentColorApplyTool';
import { AGENT_DETAIL_EFFECTS_APPLY_TOOL_NAME } from '../../../../utils/agent/tools/agentDetailEffectsApplyTool';

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

const selectedImageLoopControlStyles = {
  available: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-100',
  disabled: 'border-white/10 bg-white/5 text-text-secondary',
  dispatched: 'border-sky-500/30 bg-sky-500/10 text-sky-100',
  rejected: 'border-red-500/30 bg-red-500/10 text-red-100',
  unavailable: 'border-amber-500/30 bg-amber-500/10 text-amber-100',
} satisfies Record<AgentSelectedImagePreviewLoopReview['controls']['acceptApply']['state'], string>;

const scopePolicyStateStyles = {
  passed: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-100',
  review_required: 'border-amber-500/30 bg-amber-500/10 text-amber-100',
} satisfies Record<AgentSelectedFrameScope['policyChecks'][number]['state'], string>;

const walkthroughStageStyles = {
  completed: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-100',
  current: 'border-sky-500/30 bg-sky-500/10 text-sky-100',
  pending: 'border-white/10 bg-white/5 text-text-secondary',
} satisfies Record<AgentLivePromptWalkthrough['stages'][number]['state'], string>;

const longEditProgressStageStyles = {
  completed: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-100',
  current: 'border-sky-500/30 bg-sky-500/10 text-sky-100',
  pending: 'border-white/10 bg-white/5 text-text-secondary',
} satisfies Record<AgentLongEditProgress['stages'][number]['state'], string>;

type LocalReviewDecision = 'approved' | 'pending' | 'rejected';
type AgentProposalReviewState = 'applied' | 'applying' | 'approval_required' | 'failed' | 'preview_ready' | 'rejected';
type AgentSessionTurn = AgentMultiTurnAppServerSessionRequest['turns'][number];
type AgentSessionAdjustmentPatch = NonNullable<AgentSessionTurn['adjustment']>;
type AgentSelectedImageLoopStep = AgentCurrentImagePreviewLoopRequest['steps'][number];
type LivePromptStatus =
  | 'applied'
  | 'applying'
  | 'approval_required'
  | 'blocked'
  | 'cancelling'
  | 'dry_run_ready'
  | 'failed'
  | 'idle'
  | 'rolled_back';

interface LivePromptResult {
  appliedGraphRevision?: string;
  changedPixelCount?: number;
  changedPixelPercent?: number;
  error?: string;
  exportHash?: string;
  exportHeight?: number;
  exportPreviewRef?: string;
  exportReceiptGraphRevision?: string;
  exportReceiptPreviewHash?: string;
  exportWidth?: number;
  maxChannelDelta?: number;
  meanLuminanceDelta?: number;
  previewAfterHash?: string;
  previewBeforeHash?: string;
  previewStaleRecipeHash?: boolean;
  recipeName?: string;
  safetyDecision?: AgentSafetyPolicyDecision;
  sampledPixelCount?: number;
  stateAdjustmentCount?: number;
  stateGraphRevision?: string;
  stateImagePath?: string;
  stateMaskCount?: number;
  stateMetadataCount?: number;
  stateRecipeHash?: string;
  stateStaleRecipeHash?: boolean;
  status: LivePromptStatus;
  summary?: string;
}

interface LiveSessionReviewState {
  applyState: 'applied' | 'pending';
  finalGraphRevision: string;
  finalRecipeHash: string;
  initialPreviewReceipt?: AgentMultiTurnAppServerSessionResult['initialPreviewReceipt'];
  previewLineage: AgentMultiTurnAppServerSessionResult['previewLineage'];
  rollbackGraphRevision: string;
  rollbackState: 'available' | 'invalidated' | 'restored';
  toolCallCount: number;
}

interface LiveAuditArtifactState {
  artifactId: string;
  finalGraphRevision: string;
  persistedRecordCount: number;
  previewCount: number;
  rollbackGraphRevision: string;
  sessionId: string;
  toolCallCount: number;
}

type LiveActivityKind = 'approval' | 'error' | 'export' | 'preview' | 'prompt' | 'rollback' | 'state' | 'tool_call';

interface LiveActivityEntry {
  acceptedPreviewArtifactId?: string;
  approvalId?: string;
  body: string;
  exportArtifactId?: string;
  graphRevision?: string;
  id: string;
  kind: LiveActivityKind;
  previewAfterHash?: string;
  previewBeforeHash?: string;
  recipeHash?: string;
  status: 'blocked' | 'completed' | 'pending' | 'rolled_back';
  toolName?: string;
}

type LiveActivityEntryInput = Omit<
  LiveActivityEntry,
  | 'approvalId'
  | 'acceptedPreviewArtifactId'
  | 'exportArtifactId'
  | 'graphRevision'
  | 'id'
  | 'previewAfterHash'
  | 'previewBeforeHash'
  | 'recipeHash'
  | 'toolName'
> & {
  acceptedPreviewArtifactId?: string | undefined;
  approvalId?: string | undefined;
  exportArtifactId?: string | undefined;
  graphRevision?: string | undefined;
  previewAfterHash?: string | undefined;
  previewBeforeHash?: string | undefined;
  recipeHash?: string | undefined;
  toolName?: string | undefined;
};

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

type AgentRollbackSnapshot = ReturnType<typeof createAgentRollbackSnapshot>;
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
    if (current.currentGraphRevision !== snapshot.graphRevision) {
      return { ...current, reason: 'graph_revision_changed', state: 'invalidated' };
    }
    if (current.currentRecipeHash !== snapshot.recipeHash) {
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

const formatRouteFamily = (family: string): string => family.replaceAll('_', ' ');

const agentRuntimeBadge = {
  runtime_apply_demo: {
    className: 'border-emerald-500/25 bg-emerald-500/10 text-emerald-100',
  },
  ui_only_demo: {
    className: 'border-amber-500/25 bg-amber-500/10 text-amber-100',
  },
} satisfies Record<AgentChatTranscript['runtimeStatus'], { className: string }>;

const pickSessionAdjustments = (
  source: AgentSessionAdjustmentPatch,
  keys: readonly (keyof AgentSessionAdjustmentPatch)[],
): AgentSessionAdjustmentPatch => {
  const patch: AgentSessionAdjustmentPatch = {};
  for (const key of keys) {
    patch[key] = source[key];
  }
  return patch;
};

const buildLiveMultiTurnSessionRequest = ({
  operationId,
  plan,
  prompt,
  requestId,
  sessionId,
}: {
  operationId: string;
  plan: ReturnType<typeof planAgentEditRecipe>;
  prompt: string;
  requestId: string;
  sessionId: string;
}): AgentMultiTurnAppServerSessionRequest => {
  const basicToneStep = plan.steps.find((step) => step.kind === 'basic_tone');
  if (basicToneStep?.kind !== 'basic_tone') throw new Error('Agent session needs a basic-tone apply step.');
  const selectiveColorStep = plan.steps.find((step) => step.kind === 'selective_color');
  const needsDetailEffects =
    plan.recipeKind === 'cool_landscape_detail' || /\b(detail|sharp|crisp|texture)\b/iu.test(prompt);

  const firstPass = pickSessionAdjustments(basicToneStep.payload, [
    'exposure',
    'highlights',
    'whites',
    'blacks',
    'brightness',
  ]);
  const secondPass = pickSessionAdjustments(basicToneStep.payload, [
    'shadows',
    'contrast',
    'clarity',
    'saturation',
    'vibrance',
    'temperature',
    'tint',
  ]);
  const secondTurn: AgentSessionTurn = {
    adjustment: secondPass,
    assistantRationale: 'Second pass: inspect the preview and refine contrast, color, and shadow balance.',
    preview: { longEdgePx: 1536, purpose: 'detail_review', quality: 0.86 },
    userFollowUp: 'Inspect the medium preview and refine the image before final review.',
  };
  if (selectiveColorStep?.kind === 'selective_color') {
    secondTurn.color = { hsl: { [selectiveColorStep.payload.rangeKey]: selectiveColorStep.payload.adjustment } };
  }
  if (needsDetailEffects) {
    secondTurn.detailEffects = { clarity: 18, dehaze: 8, sharpness: 12, structure: 10 };
  }

  return {
    modelId: 'gpt-5.1-codex-app-server',
    operationId,
    prompt,
    requestId,
    sessionId,
    turns: [
      {
        adjustment: firstPass,
        assistantRationale: 'First pass: establish global exposure and highlight protection.',
        preview: { purpose: 'refresh' },
      },
      secondTurn,
    ],
  };
};

const restoreAgentRollbackSnapshot = (snapshot: AgentRollbackSnapshot) => {
  useEditorStore.setState({
    adjustments: snapshot.adjustments,
    finalPreviewUrl: snapshot.finalPreviewUrl,
    history: snapshot.history,
    historyIndex: snapshot.historyIndex,
    lastBasicToneCommand: snapshot.lastBasicToneCommand,
    uncroppedAdjustedPreviewUrl: snapshot.uncroppedAdjustedPreviewUrl,
  });
};

const pickSelectedImageLoopAdjustments = (source: AgentSessionAdjustmentPatch): AgentSelectedImageLoopStep => {
  const patch = Object.fromEntries(
    Object.entries(pickSessionAdjustments(source, ['exposure', 'highlights', 'shadows'])).filter(
      ([, value]) => value !== undefined,
    ),
  ) as AgentSelectedImageLoopStep;
  if (Object.keys(patch).length > 0) return patch;
  return { shadows: 12 };
};

const buildSelectedImageLoopSteps = ({
  plan,
  prompt,
}: {
  plan: ReturnType<typeof planAgentEditRecipe>;
  prompt: string;
}): AgentCurrentImagePreviewLoopRequest['steps'] => {
  const sessionRequest = buildLiveMultiTurnSessionRequest({
    operationId: 'agent-selected-image-preview-loop-plan',
    plan,
    prompt,
    requestId: 'agent-selected-image-preview-loop-plan',
    sessionId: 'agent-chat-shell',
  });
  const firstTurn = sessionRequest.turns[0];
  const secondTurn = sessionRequest.turns[1];
  if (firstTurn === undefined || secondTurn === undefined) {
    throw new Error('Selected-image preview loop needs two adjustment turns.');
  }
  const firstAdjustment = firstTurn?.adjustment;
  const secondAdjustment = secondTurn?.adjustment;
  if (firstAdjustment === undefined || secondAdjustment === undefined) {
    throw new Error('Selected-image preview loop needs two adjustment turns.');
  }

  return [
    {
      ...pickSelectedImageLoopAdjustments(firstAdjustment),
      assistantRationale: firstTurn.assistantRationale,
      preview: { purpose: 'refresh' },
    },
    {
      ...pickSelectedImageLoopAdjustments(secondAdjustment),
      assistantRationale:
        secondTurn.assistantRationale ?? 'Second pass: inspect selected-image preview feedback before review.',
      preview: {
        longEdgePx: 1536,
        purpose: 'detail_review',
        quality: 0.86,
        zoom: { centerX: 0.5, centerY: 0.5, scale: 2 },
      },
      userFollowUp:
        secondTurn.userFollowUp ?? 'Inspect the selected-image preview and refine the image before final review.',
    },
  ];
};

const buildSelectedImageLoopReview = ({
  prompt,
  request,
  result,
}: {
  prompt: string;
  request: AgentCurrentImagePreviewLoopRequest;
  result: AgentCurrentImagePreviewLoopResult;
}): AgentSelectedImagePreviewLoopReview => ({
  acceptedDryRunPlanCount: result.acceptedDryRunPlanCount,
  applyReceipts: result.applyReceipts,
  auditEventSummary: result.auditEventSummary,
  blockers: [],
  command: {
    operationId: request.operationId,
    requestId: request.requestId,
    sessionId: request.sessionId,
    toolName: result.toolName,
  },
  compareArtifacts: result.compareArtifactIds,
  controls: {
    acceptApply: {
      label: 'Accepted apply',
      reason: 'Selected-image preview-loop command completed through typed live-tool dispatch.',
      state: 'dispatched',
    },
    reviseWithFeedback: {
      feedback: 'Review the current selected-image compare artifacts before requesting another loop.',
      label: 'Revise with feedback',
      reason: 'Review is available after the completed selected-image loop.',
      state: 'disabled',
    },
    rollback: {
      label: 'Rollback',
      reason:
        result.rollbackReceipt === undefined
          ? 'Rollback is available from the command checkpoint when enabled.'
          : 'Rollback-after-review restored the checkpoint from the command receipt.',
      state: result.rollbackReceipt === undefined ? 'available' : 'dispatched',
      toolName: AGENT_HISTORY_ROLLBACK_TOOL_NAME,
    },
    exportReviewed: {
      label: 'Export reviewed edit',
      reason: 'Exports only after selected-image preview-loop review evidence is available.',
      state: result.reviewStatus === 'needs_user_review' ? 'available' : 'disabled',
      toolName: AGENT_FINAL_EXPORT_TOOL_NAME,
    },
  },
  editCount: result.editCount,
  finalGraphRevision: result.finalGraphRevision,
  finalRecipeHash: result.finalRecipeHash,
  id: `${request.requestId}-review`,
  initialGraphRevision: result.initialGraphRevision,
  initialPreviewArtifactId: result.initialPreviewArtifactId,
  initialRecipeHash: result.initialRecipeHash,
  previewIdentity: result.previewIdentity,
  previewLineage: result.previewLineage,
  previewRefreshCount: result.previewRefreshCount,
  prompt,
  reviewStatus: result.reviewStatus,
  rollbackCheckpoint: result.rollbackCheckpoint,
  rollbackReceipt: result.rollbackReceipt,
  selectedImage: result.selectedImage,
  status: result.status,
  title: 'Selected-image preview loop',
  warnings: [],
});

function MessageBubble({ message }: { message: AgentChatMessage }) {
  const isUser = message.role === 'user';

  return (
    <div
      className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}
      data-testid={`agent-chat-message-${message.id}`}
    >
      {/* i18next-instrument-ignore */}
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

interface LivePromptComposerProps {
  initialPromptPreviewContext: AgentInitialPromptPreviewContext | undefined;
  isContextReady: boolean;
  onResultChange?: (result: LivePromptResult) => void;
  onSessionEvent?: (event: LiveSessionEvent) => void;
}

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

const LIVE_AGENT_AUDIT_STORE_KEY = 'rawengine.agent.liveSessionAudit.v1';
const LIVE_AGENT_SELECTED_IMAGE_SESSION_AUDIT_KEY = 'rawengine.agent.selectedImageLiveSessionAudit.v1';
const LIVE_AGENT_SELECTED_IMAGE_EXPORT_RECEIPTS_KEY = 'rawengine.agent.selectedImageExportReceipts.v1';

const createLocalAgentAuditStorageAdapter = (): AgentSessionAuditStorageAdapter | null => {
  if (typeof globalThis.localStorage === 'undefined') return null;

  return {
    readText: () => globalThis.localStorage.getItem(LIVE_AGENT_AUDIT_STORE_KEY),
    writeText: (value) => {
      globalThis.localStorage.setItem(LIVE_AGENT_AUDIT_STORE_KEY, value);
    },
  };
};

const appendSelectedImageLiveSessionAuditRecord = (record: AgentSelectedImageLiveSessionAuditRecord): number => {
  if (typeof window === 'undefined' || window.localStorage === undefined) return 1;
  const existing = window.localStorage.getItem(LIVE_AGENT_SELECTED_IMAGE_SESSION_AUDIT_KEY);
  const records = existing === null ? [] : (JSON.parse(existing) as AgentSelectedImageLiveSessionAuditRecord[]);
  const nextRecords = [...records, record];
  window.localStorage.setItem(LIVE_AGENT_SELECTED_IMAGE_SESSION_AUDIT_KEY, JSON.stringify(nextRecords));
  return nextRecords.length;
};

const createLocalAgentSelectedImageExportReceiptStorageAdapter = (): AgentSessionAuditStorageAdapter | null => {
  if (typeof globalThis.localStorage === 'undefined') return null;

  return {
    readText: () => globalThis.localStorage.getItem(LIVE_AGENT_SELECTED_IMAGE_EXPORT_RECEIPTS_KEY),
    writeText: (value) => {
      globalThis.localStorage.setItem(LIVE_AGENT_SELECTED_IMAGE_EXPORT_RECEIPTS_KEY, value);
    },
  };
};

const buildLiveAgentAuditRecord = ({
  acceptedPrompt,
  approvalId,
  sessionResult,
}: {
  acceptedPrompt: string;
  approvalId: string;
  sessionResult: AgentMultiTurnAppServerSessionResult;
}): AgentSessionAuditRecord => ({
  approvalId,
  artifactLineage: sessionResult.previewLineage.map((preview) => ({
    artifactId: preview.artifactId,
    contentHash: `sha256:${preview.renderHash}`,
    graphRevision: preview.graphRevision,
    sourceToolCallId: preview.toolCallId,
  })),
  finalGraphRevision: sessionResult.finalGraphRevision,
  initialGraphRevision: sessionResult.initialContext.imageContext.graphRevision,
  modelId: sessionResult.modelId,
  planSummary: sessionResult.editReview.finalRationale,
  prompt: acceptedPrompt,
  rollbackGraphRevision: sessionResult.rollbackGraphRevision,
  sessionId: sessionResult.sessionId,
  toolCalls: sessionResult.toolCalls.map((toolCall) => ({
    id: toolCall.id,
    name: toolCall.name,
    resultSummary:
      toolCall.contentHash ??
      toolCall.receiptGraphRevision ??
      toolCall.previewArtifactId ??
      `${toolCall.name} succeeded`,
    status: toolCall.status,
  })),
  traceEvents: [
    {
      id: `${sessionResult.sessionId}-prompt`,
      kind: 'prompt',
      message: acceptedPrompt,
      timestamp: new Date(0).toISOString(),
    },
    ...sessionResult.previewLineage.map((preview, index) => ({
      graphRevision: preview.graphRevision,
      id: `${sessionResult.sessionId}-preview-${index}`,
      kind: 'preview' as const,
      previewRef: preview.artifactId,
      recipeHash: preview.recipeHash,
      renderHash: preview.renderHash,
      timestamp: new Date(index + 1).toISOString(),
      toolCallId: preview.toolCallId,
    })),
    {
      approvalId,
      id: `${sessionResult.sessionId}-approval`,
      kind: 'approval',
      message: approvalId,
      timestamp: new Date(sessionResult.previewLineage.length + 1).toISOString(),
    },
    {
      graphRevision: sessionResult.rollbackGraphRevision,
      id: `${sessionResult.sessionId}-rollback`,
      kind: 'rollback',
      message: 'Rollback checkpoint available.',
      timestamp: new Date(sessionResult.previewLineage.length + 2).toISOString(),
    },
  ],
});

function LiveActivityTimeline({ entries }: { entries: LiveActivityEntry[] }) {
  const { t } = useTranslation();

  return (
    <div
      className="space-y-2 rounded-md border border-white/10 bg-black/15 p-3"
      data-testid="agent-live-activity-timeline"
      data-timeline-entry-count={entries.length}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-semibold text-text-primary">{t('editor.ai.agent.timeline.title')}</span>
        <span className="text-[11px] text-text-secondary">{t('editor.ai.agent.timeline.subtitle')}</span>
      </div>
      <div className="space-y-1.5" data-testid="agent-live-activity-timeline-entries">
        {entries.length === 0 ? (
          <div className="rounded border border-white/10 bg-white/[0.03] p-2 text-[11px] text-text-secondary">
            {t('editor.ai.agent.timeline.empty')}
          </div>
        ) : (
          entries.map((entry) => (
            <div
              className="rounded border border-white/10 bg-white/[0.03] p-2 text-[11px]"
              data-accepted-preview-artifact-id={entry.acceptedPreviewArtifactId ?? ''}
              data-approval-id={entry.approvalId ?? ''}
              data-export-artifact-id={entry.exportArtifactId ?? ''}
              data-graph-revision={entry.graphRevision ?? ''}
              data-kind={entry.kind}
              data-preview-after-hash={entry.previewAfterHash ?? ''}
              data-preview-before-hash={entry.previewBeforeHash ?? ''}
              data-recipe-hash={entry.recipeHash ?? ''}
              data-status={entry.status}
              data-testid={`agent-live-activity-${entry.kind}`}
              data-tool-name={entry.toolName ?? ''}
              key={entry.id}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-semibold text-text-primary">
                  {t(`editor.ai.agent.timeline.kind.${entry.kind}`)}
                </span>
                <span className="rounded border border-white/10 bg-white/5 px-1.5 py-0.5 text-text-secondary">
                  {entry.status}
                </span>
              </div>
              <p className="mt-1 leading-4 text-text-secondary">{entry.body}</p>
              {entry.previewAfterHash ? (
                <div
                  className="mt-1 truncate font-mono text-[10px] text-sky-100"
                  data-testid="agent-live-activity-preview-hash"
                >
                  {entry.previewBeforeHash} → {entry.previewAfterHash}
                </div>
              ) : null}
              {entry.graphRevision ? (
                <div className="mt-1 truncate font-mono text-[10px] text-emerald-100">{entry.graphRevision}</div>
              ) : null}
              <div
                className="mt-2 flex flex-wrap gap-1.5"
                data-testid="agent-live-activity-review-controls"
                data-timeline-review-state={entry.status}
              >
                <span className="rounded border border-white/10 bg-black/20 px-1.5 py-0.5 text-text-secondary">
                  {entry.kind === 'rollback'
                    ? t('editor.ai.agent.timeline.control.rollback')
                    : entry.kind === 'approval'
                      ? t('editor.ai.agent.timeline.control.approval')
                      : entry.kind === 'preview'
                        ? t('editor.ai.agent.timeline.control.compare')
                        : t('editor.ai.agent.timeline.control.inspect')}
                </span>
                {entry.toolName ? (
                  <span className="rounded border border-white/10 bg-black/20 px-1.5 py-0.5 font-mono text-text-secondary">
                    {entry.toolName}
                  </span>
                ) : null}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function LiveSessionReviewPanel({ review }: { review: LiveSessionReviewState | null }) {
  const { t } = useTranslation();
  if (review === null) return null;

  const firstPreview = review.previewLineage[0];
  const finalPreview = review.previewLineage.at(-1);
  const purposeLabel = (purpose: AgentMultiTurnAppServerSessionResult['previewLineage'][number]['purpose']) =>
    t(`editor.ai.agent.previewLineage.purpose.${purpose}`);
  const roleLabel = (
    preview: AgentMultiTurnAppServerSessionResult['previewLineage'][number],
    index: number,
    count: number,
  ) => {
    if (index === 0 || preview.purpose === 'initial_context') return t('editor.ai.agent.previewLineage.role.before');
    if (index === count - 1) return t('editor.ai.agent.previewLineage.role.final');
    if (preview.purpose === 'detail_review') return t('editor.ai.agent.previewLineage.role.detail');
    return t('editor.ai.agent.previewLineage.role.refresh');
  };

  return (
    <div
      className="space-y-2 rounded-md border border-emerald-500/20 bg-emerald-500/5 p-3 text-[11px]"
      data-apply-state={review.applyState}
      data-final-graph-revision={review.finalGraphRevision}
      data-final-preview-artifact-id={finalPreview?.artifactId ?? ''}
      data-final-recipe-hash={review.finalRecipeHash}
      data-initial-preview-content-hash={review.initialPreviewReceipt?.contentHash ?? ''}
      data-initial-preview-artifact-id={firstPreview?.artifactId ?? ''}
      data-initial-preview-image-path={review.initialPreviewReceipt?.imagePath ?? ''}
      data-initial-preview-long-edge-px={review.initialPreviewReceipt?.preview.longEdgePx ?? ''}
      data-initial-preview-quality={review.initialPreviewReceipt?.preview.quality ?? ''}
      data-initial-preview-stale={review.initialPreviewReceipt?.proofContext.stale ?? ''}
      data-initial-preview-tool-name={review.initialPreviewReceipt?.toolName ?? ''}
      data-preview-lineage-count={review.previewLineage.length}
      data-rollback-graph-revision={review.rollbackGraphRevision}
      data-rollback-state={review.rollbackState}
      data-testid="agent-live-session-review"
      data-tool-call-count={review.toolCallCount}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="font-semibold text-text-primary">{t('editor.ai.agent.review.title')}</span>
        <span className="rounded border border-white/10 bg-black/20 px-1.5 py-0.5 text-text-secondary">
          {review.applyState}
        </span>
      </div>
      {review.initialPreviewReceipt === undefined ? null : (
        <div
          className="rounded border border-sky-500/20 bg-sky-500/10 p-2"
          data-artifact-id={review.initialPreviewReceipt.preview.artifactId}
          data-content-hash={review.initialPreviewReceipt.contentHash}
          data-height={review.initialPreviewReceipt.preview.height}
          data-image-path={review.initialPreviewReceipt.imagePath}
          data-long-edge-px={review.initialPreviewReceipt.preview.longEdgePx}
          data-quality={review.initialPreviewReceipt.preview.quality}
          data-recipe-hash={review.initialPreviewReceipt.preview.recipeHash}
          data-render-hash={review.initialPreviewReceipt.preview.renderHash}
          data-stale={String(review.initialPreviewReceipt.proofContext.stale)}
          data-testid="agent-live-session-initial-preview-receipt"
          data-tool-name={review.initialPreviewReceipt.toolName}
          data-width={review.initialPreviewReceipt.preview.width}
        >
          <div className="flex items-center justify-between gap-2">
            <span className="font-semibold text-text-primary">{t('editor.ai.agent.initialPreviewContext.title')}</span>
            <span className="font-mono text-sky-100">{review.initialPreviewReceipt.toolName}</span>
          </div>
          <dl className="mt-2 grid grid-cols-[auto_minmax(0,1fr)] gap-x-2 gap-y-1 font-mono text-[10px]">
            <dt className="text-text-tertiary">{t('editor.ai.agent.previewLineage.meta.artifact')}</dt>
            <dd className="truncate text-text-secondary">{review.initialPreviewReceipt.preview.artifactId}</dd>
            <dt className="text-text-tertiary">{t('editor.ai.agent.previewLineage.meta.renderHash')}</dt>
            <dd className="truncate text-sky-100">{review.initialPreviewReceipt.contentHash}</dd>
            <dt className="text-text-tertiary">{t('editor.ai.agent.previewLineage.meta.recipeHash')}</dt>
            <dd className="truncate text-text-secondary">{review.initialPreviewReceipt.preview.recipeHash}</dd>
          </dl>
        </div>
      )}
      <div
        className="grid gap-1.5"
        data-testid="agent-live-session-preview-lineage"
        data-validation-mode="runtime-preview-lineage-compare-strip"
      >
        {review.previewLineage.map((preview, index) => (
          <div
            className="rounded border border-white/10 bg-white/[0.03] p-2"
            data-artifact-id={preview.artifactId}
            data-graph-revision={preview.graphRevision}
            data-lineage-role={roleLabel(preview, index, review.previewLineage.length)}
            data-purpose={preview.purpose}
            data-recipe-hash={preview.recipeHash}
            data-render-hash={preview.renderHash}
            data-testid="agent-live-session-preview-lineage-entry"
            data-tool-name={AGENT_PREVIEW_RENDER_TOOL_NAME}
            data-turn={preview.turn}
            key={`${preview.turn}-${preview.artifactId}`}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-text-primary">{roleLabel(preview, index, review.previewLineage.length)}</span>
              <span className="font-mono text-text-secondary">{purposeLabel(preview.purpose)}</span>
            </div>
            <dl className="mt-2 grid grid-cols-[auto_minmax(0,1fr)] gap-x-2 gap-y-1 font-mono text-[10px]">
              <dt className="text-text-tertiary">{t('editor.ai.agent.previewLineage.meta.tool')}</dt>
              <dd className="truncate text-text-secondary">{AGENT_PREVIEW_RENDER_TOOL_NAME}</dd>
              <dt className="text-text-tertiary">{t('editor.ai.agent.previewLineage.meta.renderHash')}</dt>
              <dd className="truncate text-sky-100">{preview.renderHash}</dd>
              <dt className="text-text-tertiary">{t('editor.ai.agent.previewLineage.meta.recipeHash')}</dt>
              <dd className="truncate text-text-secondary">{preview.recipeHash}</dd>
              <dt className="text-text-tertiary">{t('editor.ai.agent.previewLineage.meta.artifact')}</dt>
              <dd className="truncate text-text-secondary">{preview.artifactId}</dd>
            </dl>
          </div>
        ))}
      </div>
      <div
        className="flex flex-wrap gap-1.5"
        data-testid="agent-live-session-review-actions"
        data-apply-review-state={review.applyState}
        data-rollback-review-state={review.rollbackState}
      >
        <span className="rounded border border-white/10 bg-black/20 px-1.5 py-0.5 text-text-secondary">
          {t('editor.ai.agent.timeline.control.inspect')}
        </span>
        <span className="rounded border border-white/10 bg-black/20 px-1.5 py-0.5 text-text-secondary">
          {t('editor.ai.agent.timeline.control.rollback')}
        </span>
      </div>
    </div>
  );
}

function LiveAuditArtifactPanel({ artifact }: { artifact: LiveAuditArtifactState | null }) {
  const { t } = useTranslation();
  if (artifact === null) return null;

  return (
    <div
      className="space-y-2 rounded-md border border-sky-500/20 bg-sky-500/5 p-3 text-[11px]"
      data-artifact-id={artifact.artifactId}
      data-final-graph-revision={artifact.finalGraphRevision}
      data-persisted-record-count={artifact.persistedRecordCount}
      data-preview-count={artifact.previewCount}
      data-rollback-graph-revision={artifact.rollbackGraphRevision}
      data-session-id={artifact.sessionId}
      data-testid="agent-live-session-audit-artifact"
      data-tool-call-count={artifact.toolCallCount}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="font-semibold text-text-primary">{t('editor.ai.agent.audit.title')}</span>
        <span className="rounded border border-white/10 bg-black/20 px-1.5 py-0.5 font-mono text-text-secondary">
          {artifact.artifactId}
        </span>
      </div>
      <div className="grid grid-cols-3 gap-1.5">
        <span className="rounded border border-white/10 bg-black/20 px-1.5 py-1 text-text-secondary">
          {t('editor.ai.agent.readiness.tools')}: {artifact.toolCallCount}
        </span>
        <span className="rounded border border-white/10 bg-black/20 px-1.5 py-1 text-text-secondary">
          {t('editor.ai.agent.artifacts.title')}: {artifact.previewCount}
        </span>
        <span className="rounded border border-white/10 bg-black/20 px-1.5 py-1 text-text-secondary">
          {t('editor.ai.agent.audit.evidence')}: {artifact.persistedRecordCount}
        </span>
      </div>
    </div>
  );
}

type SelectedImageLoopRuntimeState =
  | {
      error: string;
      status: 'rejected';
    }
  | {
      exportReceipt: AgentSelectedImageExportReceipt;
      status: 'exported';
    }
  | {
      result: AgentCurrentImagePreviewLoopResult | unknown;
      status: 'accepted' | 'revised' | 'rolled_back';
    }
  | {
      status: 'idle' | 'pending';
    };

function SelectedImagePreviewLoopReviewPanel({ review }: { review: AgentSelectedImagePreviewLoopReview }) {
  const { t } = useTranslation();
  const [runtimeState, setRuntimeState] = useState<SelectedImageLoopRuntimeState>({ status: 'idle' });
  const latestResult =
    runtimeState.status === 'accepted' || runtimeState.status === 'revised'
      ? agentCurrentImagePreviewLoopResultSchema.safeParse(runtimeState.result).data
      : undefined;
  const compareArtifacts = latestResult?.compareArtifactIds ?? review.compareArtifacts;
  const previewLineage = latestResult?.previewLineage ?? review.previewLineage;
  const latestApplyReceipt = latestResult?.applyReceipts.at(-1);
  const baseReceipt = review.applyReceipts.at(-1);
  const displayedReceipt = latestApplyReceipt ?? baseReceipt;
  const changedFields = Array.from(new Set(review.applyReceipts.flatMap((receipt) => receipt.adjustedFields)));
  const disabledReason = review.blockers[0] ?? '';
  const exportControl = review.controls.exportReviewed ?? {
    label: 'Export reviewed edit',
    reason: 'Exports only after selected-image preview-loop review evidence is available.',
    state: 'disabled' as const,
    toolName: AGENT_FINAL_EXPORT_TOOL_NAME,
  };
  const acceptEnabled = review.controls.acceptApply.state === 'available' && runtimeState.status !== 'pending';
  const reviseEnabled = review.controls.reviseWithFeedback.state === 'available' && runtimeState.status !== 'pending';
  const rollbackEnabled = review.controls.rollback.state === 'available' && runtimeState.status !== 'pending';
  const exportReceipt = runtimeState.status === 'exported' ? runtimeState.exportReceipt : undefined;
  const hasExportEvidence =
    compareArtifacts.beforeEvidence !== undefined && compareArtifacts.currentEvidence !== undefined;
  const exportEnabled =
    exportControl.state === 'available' &&
    review.reviewStatus === 'needs_user_review' &&
    hasExportEvidence &&
    runtimeState.status !== 'pending' &&
    runtimeState.status !== 'rejected';
  const formatCrop = (crop: (typeof previewLineage)[number]['crop']) =>
    crop === undefined || crop === null
      ? 'full-frame'
      : `${crop.unit} x=${crop.x} y=${crop.y} w=${crop.width} h=${crop.height}`;
  const formatZoom = (zoom: (typeof previewLineage)[number]['zoom']) =>
    zoom === undefined || zoom === null ? 'none' : `${zoom.scale}x @ ${zoom.centerX},${zoom.centerY}`;

  const dispatchLoop = async (
    control: AgentSelectedImagePreviewLoopReview['controls']['acceptApply'],
    status: 'accepted' | 'revised',
  ) => {
    if (control.state !== 'available' || control.commandRequest === undefined) return;
    setRuntimeState({ status: 'pending' });
    try {
      const result = agentCurrentImagePreviewLoopResultSchema.parse(
        await dispatchAgentLiveEditorTool({
          args: control.commandRequest,
          requestId: `${review.command.requestId}-${status}`,
          runtimeToolName: AGENT_CURRENT_IMAGE_PREVIEW_LOOP_TOOL_NAME,
        }),
      );
      setRuntimeState({ result, status });
    } catch (error) {
      setRuntimeState({
        error: error instanceof Error ? error.message : t('editor.ai.agent.composer.unknownError'),
        status: 'rejected',
      });
    }
  };

  const rollback = async () => {
    if (review.controls.rollback.state !== 'available' || review.controls.rollback.commandRequest === undefined) {
      return;
    }
    setRuntimeState({ status: 'pending' });
    try {
      const result = await dispatchAgentLiveEditorTool({
        args: review.controls.rollback.commandRequest,
        requestId: `${review.command.requestId}-rollback`,
        runtimeToolName: AGENT_HISTORY_ROLLBACK_TOOL_NAME,
      });
      setRuntimeState({ result, status: 'rolled_back' });
    } catch (error) {
      setRuntimeState({
        error: error instanceof Error ? error.message : t('editor.ai.agent.composer.unknownError'),
        status: 'rejected',
      });
    }
  };

  const exportReviewedEdit = async () => {
    if (
      !exportEnabled ||
      compareArtifacts.beforeEvidence === undefined ||
      compareArtifacts.currentEvidence === undefined
    ) {
      return;
    }
    setRuntimeState({ status: 'pending' });
    try {
      const snapshot = buildAgentImageContextSnapshot();
      if (snapshot.activeImagePath !== review.selectedImage.path) {
        throw new Error('Selected-image reviewed export rejected a different selected image.');
      }
      if (
        snapshot.graphRevision !== review.finalGraphRevision ||
        snapshot.initialPreview.recipeHash !== review.finalRecipeHash
      ) {
        throw new Error('Selected-image reviewed export requires the reviewed graph revision to be current.');
      }
      const requestId = `${review.command.requestId}-export-reviewed`;
      const finalExport = agentFinalExportResponseSchema.parse(
        await dispatchAgentLiveEditorTool({
          args: {
            approval: {
              approvalId: `approval_selected_image_export_${review.command.requestId}`,
              approvedGraphRevision: snapshot.graphRevision,
              approvedRecipeHash: snapshot.initialPreview.recipeHash,
              approvedSelectedImagePath: snapshot.activeImagePath,
              approvedSessionId: review.command.sessionId,
              status: 'approved',
            },
            colorProfile: 'srgb',
            destinationPolicy: 'local_private_artifact',
            dryRun: false,
            expectedRecipeHash: snapshot.initialPreview.recipeHash,
            fileFormat: 'jpeg',
            jpegQuality: 90,
            longEdgePx: 4096,
            operationId: `${review.command.operationId}-export-reviewed`,
            renderingIntent: 'relativeColorimetric',
            requestId,
            sessionId: review.command.sessionId,
          },
          requestId,
          runtimeToolName: AGENT_FINAL_EXPORT_TOOL_NAME,
        }),
      );
      const receipt: AgentSelectedImageExportReceipt = {
        approvalId: finalExport.receipt.approvalId,
        beforePreviewArtifact: {
          artifactId: compareArtifacts.beforeArtifactId,
          ...compareArtifacts.beforeEvidence,
        },
        currentPreviewArtifact: {
          artifactId: compareArtifacts.currentArtifactId,
          ...compareArtifacts.currentEvidence,
        },
        exportSettings: finalExport.receipt.exportSettings,
        finalGraphRevision: review.finalGraphRevision,
        finalRecipeHash: review.finalRecipeHash,
        initialGraphRevision: review.initialGraphRevision,
        initialRecipeHash: review.initialRecipeHash,
        noOverwritePolicy: finalExport.receipt.noOverwritePolicy,
        outputHash: finalExport.receipt.outputHash,
        outputPath: finalExport.receipt.outputPath,
        prompt: review.prompt,
        requestId: finalExport.requestId,
        rollback: {
          checkpointGraphRevision: review.rollbackCheckpoint.graphRevision,
          receiptGraphRevision: review.rollbackReceipt?.graphRevision,
          status: review.rollbackReceipt === undefined ? 'available' : 'restored',
        },
        selectedRawPath: review.selectedImage.path,
        sessionId: review.command.sessionId,
        toolName: finalExport.toolName,
      };
      const adapter = createLocalAgentSelectedImageExportReceiptStorageAdapter();
      const persistedReceipt = adapter === null ? receipt : appendAgentSelectedImageExportReceipt(adapter, receipt);
      setRuntimeState({ exportReceipt: persistedReceipt, status: 'exported' });
    } catch (error) {
      setRuntimeState({
        error: error instanceof Error ? error.message : t('editor.ai.agent.composer.unknownError'),
        status: 'rejected',
      });
    }
  };

  return (
    <div
      className="space-y-3 rounded-md border border-sky-500/20 bg-sky-500/5 p-3"
      data-accepted-dry-run-plan-count={review.acceptedDryRunPlanCount}
      data-apply-receipt-count={review.applyReceipts.length}
      data-audit-event-count={review.auditEventSummary.length}
      data-blockers={review.blockers.join(',')}
      data-before-artifact-id={review.compareArtifacts.beforeArtifactId}
      data-before-preview-url={compareArtifacts.beforeEvidence?.previewRef ?? ''}
      data-changed-field-count={changedFields.length}
      data-command-request-id={review.command.requestId}
      data-current-artifact-id={compareArtifacts.currentArtifactId}
      data-current-preview-url={compareArtifacts.currentEvidence?.previewRef ?? ''}
      data-final-graph-revision={latestResult?.finalGraphRevision ?? review.finalGraphRevision}
      data-final-recipe-hash={latestResult?.finalRecipeHash ?? review.finalRecipeHash}
      data-initial-graph-revision={review.initialGraphRevision}
      data-initial-preview-artifact-id={review.initialPreviewArtifactId}
      data-initial-recipe-hash={review.initialRecipeHash}
      data-preview-identity={review.previewIdentity ?? ''}
      data-preview-lineage-count={previewLineage.length}
      data-review-status={latestResult?.reviewStatus ?? review.reviewStatus}
      data-rollback-checkpoint-graph-revision={review.rollbackCheckpoint.graphRevision}
      data-rollback-receipt-graph-revision={review.rollbackReceipt?.graphRevision ?? ''}
      data-runtime-state={runtimeState.status}
      data-selected-image-path={review.selectedImage.path}
      data-testid="agent-selected-image-preview-loop-review"
      data-tool-name={review.command.toolName}
      data-warning-count={review.warnings.length}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-xs font-semibold text-text-primary">
            <Eye size={15} />
            <span>{review.title}</span>
          </div>
          <p className="mt-1 text-[11px] leading-4 text-text-secondary">{review.prompt}</p>
        </div>
        <span className="shrink-0 rounded border border-sky-500/25 bg-sky-500/10 px-2 py-0.5 text-[11px] text-sky-100">
          {review.status}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-2" data-testid="agent-selected-image-preview-loop-compare">
        <div
          className="min-h-32 rounded border border-white/10 bg-[#16212b] p-2"
          data-artifact-id={review.compareArtifacts.beforeArtifactId}
          data-content-hash={compareArtifacts.beforeEvidence?.contentHash ?? ''}
          data-graph-revision={compareArtifacts.beforeEvidence?.graphRevision ?? review.initialGraphRevision}
          data-preview-url={compareArtifacts.beforeEvidence?.previewRef ?? ''}
          data-recipe-hash={compareArtifacts.beforeEvidence?.recipeHash ?? review.initialRecipeHash}
          data-render-hash={compareArtifacts.beforeEvidence?.renderHash ?? ''}
          data-testid="agent-selected-image-preview-loop-before"
        >
          <span className="rounded bg-black/35 px-1.5 py-0.5 text-[10px] uppercase text-text-primary">
            {t('editor.ai.agent.selectedImageLoop.before')}
          </span>
          <div className="mt-4 truncate font-mono text-[10px] text-text-primary">
            {review.compareArtifacts.beforeArtifactId}
          </div>
          <div className="mt-1 truncate font-mono text-[10px] text-sky-100">
            {compareArtifacts.beforeEvidence?.previewRef ?? review.previewIdentity ?? 'preview unavailable'}
          </div>
          <div className="mt-2 grid gap-1 font-mono text-[10px] text-text-secondary">
            <span className="truncate">
              {compareArtifacts.beforeEvidence?.graphRevision ?? review.initialGraphRevision}
            </span>
            <span className="truncate">{compareArtifacts.beforeEvidence?.recipeHash ?? review.initialRecipeHash}</span>
            <span className="truncate">{compareArtifacts.beforeEvidence?.renderHash ?? 'render hash unavailable'}</span>
          </div>
        </div>
        <div
          className="min-h-32 rounded border border-sky-500/25 bg-[#1f2d25] p-2"
          data-artifact-id={compareArtifacts.currentArtifactId}
          data-content-hash={compareArtifacts.currentEvidence?.contentHash ?? ''}
          data-graph-revision={
            compareArtifacts.currentEvidence?.graphRevision ??
            latestResult?.finalGraphRevision ??
            review.finalGraphRevision
          }
          data-preview-url={compareArtifacts.currentEvidence?.previewRef ?? ''}
          data-recipe-hash={
            compareArtifacts.currentEvidence?.recipeHash ?? latestResult?.finalRecipeHash ?? review.finalRecipeHash
          }
          data-render-hash={compareArtifacts.currentEvidence?.renderHash ?? ''}
          data-testid="agent-selected-image-preview-loop-current"
        >
          <span className="rounded bg-black/35 px-1.5 py-0.5 text-[10px] uppercase text-text-primary">
            {t('editor.ai.agent.selectedImageLoop.current')}
          </span>
          <div className="mt-4 truncate font-mono text-[10px] text-text-primary">
            {compareArtifacts.currentArtifactId}
          </div>
          <div className="mt-1 truncate font-mono text-[10px] text-emerald-100">
            {compareArtifacts.currentEvidence?.previewRef ?? 'preview unavailable'}
          </div>
          <div className="mt-2 grid gap-1 font-mono text-[10px] text-text-secondary">
            <span className="truncate">
              {compareArtifacts.currentEvidence?.graphRevision ??
                latestResult?.finalGraphRevision ??
                review.finalGraphRevision}
            </span>
            <span className="truncate">
              {compareArtifacts.currentEvidence?.recipeHash ?? latestResult?.finalRecipeHash ?? review.finalRecipeHash}
            </span>
            <span className="truncate">
              {compareArtifacts.currentEvidence?.renderHash ?? 'render hash unavailable'}
            </span>
          </div>
        </div>
      </div>

      <div
        className="grid gap-2 text-[11px] md:grid-cols-4"
        data-max-channel-delta={displayedReceipt?.maxChannelDelta ?? ''}
        data-mean-luminance-delta={displayedReceipt?.meanLuminanceDelta ?? ''}
        data-testid="agent-selected-image-preview-loop-metrics"
      >
        <div className="rounded border border-white/10 bg-black/15 p-2">
          <div className="text-[10px] uppercase text-text-secondary">
            {t('editor.ai.agent.selectedImageLoop.changedPixels')}
          </div>
          <div
            className="mt-1 font-mono text-emerald-100"
            data-testid="agent-selected-image-preview-loop-changed-pixels"
          >
            {displayedReceipt?.changedPixelCount}
          </div>
          <div className="font-mono text-[10px] text-text-secondary">
            {t('editor.ai.agent.selectedImageLoop.changedPixelSummary', {
              percent: displayedReceipt?.changedPixelPercent ?? 'n/a',
              sampled: displayedReceipt?.sampledPixelCount ?? 'n/a',
            })}
          </div>
        </div>
        <div className="rounded border border-white/10 bg-black/15 p-2">
          <div className="text-[10px] uppercase text-text-secondary">
            {t('editor.ai.agent.selectedImageLoop.luminanceChannel')}
          </div>
          <div className="mt-1 font-mono text-text-primary" data-testid="agent-selected-image-preview-loop-deltas">
            {displayedReceipt?.meanLuminanceDelta ?? 'n/a'} / {displayedReceipt?.maxChannelDelta ?? 'n/a'}
          </div>
          <div className="font-mono text-[10px] text-text-secondary">
            {t('editor.ai.agent.selectedImageLoop.deltaHelp')}
          </div>
        </div>
        <div className="rounded border border-white/10 bg-black/15 p-2">
          <div className="text-[10px] uppercase text-text-secondary">
            {t('editor.ai.agent.selectedImageLoop.graphRevision')}
          </div>
          <div className="mt-1 truncate font-mono text-text-primary">
            {latestResult?.finalGraphRevision ?? review.finalGraphRevision}
          </div>
          <div className="truncate font-mono text-[10px] text-text-secondary">{review.initialGraphRevision}</div>
        </div>
        <div className="rounded border border-white/10 bg-black/15 p-2">
          <div className="text-[10px] uppercase text-text-secondary">
            {t('editor.ai.agent.selectedImageLoop.recipeHash')}
          </div>
          <div className="mt-1 truncate font-mono text-text-primary">
            {latestResult?.finalRecipeHash ?? review.finalRecipeHash}
          </div>
          <div className="truncate font-mono text-[10px] text-text-secondary">{review.initialRecipeHash}</div>
        </div>
      </div>

      <div
        className="grid gap-2 rounded border border-white/10 bg-black/15 p-2 text-[11px] md:grid-cols-3"
        data-before-graph-revision={compareArtifacts.lineage?.beforeGraphRevision ?? ''}
        data-current-graph-revision={compareArtifacts.lineage?.currentGraphRevision ?? ''}
        data-medium-preview-artifact-id={compareArtifacts.mediumPreview?.artifactId ?? ''}
        data-medium-preview-content-hash={compareArtifacts.mediumPreview?.contentHash ?? ''}
        data-medium-preview-graph-revision={compareArtifacts.mediumPreview?.graphRevision ?? ''}
        data-medium-preview-height={compareArtifacts.mediumPreview?.dimensions.height ?? ''}
        data-long-edge-px={compareArtifacts.mediumPreview?.longEdgePx ?? ''}
        data-max-pixel-count={compareArtifacts.mediumPreview?.maxPixelCount ?? ''}
        data-medium-preview-url={compareArtifacts.mediumPreview?.previewRef ?? ''}
        data-quality={compareArtifacts.mediumPreview?.quality ?? ''}
        data-medium-preview-recipe-hash={compareArtifacts.mediumPreview?.recipeHash ?? ''}
        data-medium-preview-render-hash={compareArtifacts.mediumPreview?.renderHash ?? ''}
        data-medium-preview-stale={compareArtifacts.mediumPreview?.staleRecipeHash ?? ''}
        data-medium-preview-width={compareArtifacts.mediumPreview?.dimensions.width ?? ''}
        data-stale-recipe-hash={compareArtifacts.lineage?.staleRecipeHash ?? ''}
        data-testid="agent-selected-image-preview-loop-compare-lineage"
      >
        <div className="min-w-0">
          <div className="text-[10px] uppercase text-text-secondary">
            {t('editor.ai.agent.selectedImageLoop.compareLineage')}
          </div>
          <div className="mt-1 truncate font-mono text-text-primary">
            {compareArtifacts.lineage?.beforeGraphRevision ?? review.initialGraphRevision}
          </div>
          <div className="truncate font-mono text-text-secondary">
            {compareArtifacts.lineage?.currentGraphRevision ??
              latestResult?.finalGraphRevision ??
              review.finalGraphRevision}
          </div>
        </div>
        <div className="min-w-0">
          <div className="text-[10px] uppercase text-text-secondary">
            {t('editor.ai.agent.selectedImageLoop.compareRecipes')}
          </div>
          <div className="mt-1 truncate font-mono text-text-primary">
            {compareArtifacts.lineage?.beforeRecipeHash ?? review.initialRecipeHash}
          </div>
          <div className="truncate font-mono text-text-secondary">
            {compareArtifacts.lineage?.currentRecipeHash ?? latestResult?.finalRecipeHash ?? review.finalRecipeHash}
          </div>
        </div>
        <div>
          <div className="text-[10px] uppercase text-text-secondary">
            {t('editor.ai.agent.selectedImageLoop.previewRender')}
          </div>
          <div className="mt-1 font-mono text-text-primary">
            {t('editor.ai.agent.selectedImageLoop.previewRenderValue', {
              longEdge: compareArtifacts.mediumPreview?.longEdgePx ?? 'n/a',
              quality: compareArtifacts.mediumPreview?.quality ?? 'n/a',
            })}
          </div>
          <div className="font-mono text-text-secondary">
            {t('editor.ai.agent.selectedImageLoop.maxPixelCountValue', {
              pixelCount: compareArtifacts.mediumPreview?.maxPixelCount ?? 'n/a',
            })}
          </div>
        </div>
      </div>

      <div className="space-y-1" data-testid="agent-selected-image-preview-loop-lineage">
        {previewLineage.map((lineage) => (
          <div
            className="grid gap-2 rounded border border-white/10 bg-white/[0.03] p-2 text-[11px] md:grid-cols-[1fr_auto]"
            data-applied-graph-revision={lineage.appliedGraphRevision}
            data-artifact-id={lineage.previewArtifactId}
            data-crop={formatCrop(lineage.crop)}
            data-height={lineage.height ?? ''}
            data-long-edge-px={lineage.longEdgePx ?? ''}
            data-preview-url={lineage.previewRef ?? ''}
            data-purpose={lineage.previewPurpose}
            data-quality={lineage.quality ?? ''}
            data-recipe-hash={lineage.recipeHash}
            data-render-hash={lineage.renderHash ?? ''}
            data-testid="agent-selected-image-preview-loop-lineage-entry"
            data-tool-name={lineage.sourceToolName}
            data-turn={lineage.turn}
            data-width={lineage.width ?? ''}
            data-zoom={formatZoom(lineage.zoom)}
            key={`${lineage.turn}-${lineage.previewArtifactId}`}
          >
            <div className="min-w-0">
              <div className="truncate font-mono text-text-primary">{lineage.previewArtifactId}</div>
              <div className="mt-1 truncate font-mono text-text-secondary">{lineage.recipeHash}</div>
              <div className="mt-1 truncate font-mono text-text-secondary">
                {lineage.previewRef ?? 'preview ref unavailable'}
              </div>
              <div className="mt-1 truncate font-mono text-text-secondary">
                {formatCrop(lineage.crop)} / {formatZoom(lineage.zoom)}
              </div>
            </div>
            <span className="rounded border border-white/10 bg-black/20 px-1.5 py-0.5 text-text-secondary">
              {lineage.previewPurpose}
            </span>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap gap-1.5" data-testid="agent-selected-image-preview-loop-changed-fields">
        {changedFields.map((field) => (
          <span
            className="rounded border border-white/10 bg-black/20 px-1.5 py-0.5 text-[11px] text-text-secondary"
            key={field}
          >
            {field}
          </span>
        ))}
      </div>

      {review.warnings.length > 0 || review.blockers.length > 0 ? (
        <div className="space-y-1" data-testid="agent-selected-image-preview-loop-warnings">
          {[...review.warnings, ...review.blockers].map((warning) => (
            <div
              className="rounded border border-amber-500/25 bg-amber-500/10 px-2 py-1 text-[11px] text-amber-100"
              key={warning}
            >
              {warning}
            </div>
          ))}
        </div>
      ) : null}

      <div className="grid gap-2 text-[11px] md:grid-cols-2">
        <div
          className="rounded border border-white/10 bg-black/15 p-2"
          data-rollback-checkpoint-graph-revision={review.rollbackCheckpoint.graphRevision}
          data-rollback-checkpoint-recipe-hash={review.rollbackCheckpoint.previewRecipeHash}
          data-rollback-receipt-graph-revision={review.rollbackReceipt?.graphRevision ?? ''}
          data-testid="agent-selected-image-preview-loop-rollback-receipt"
        >
          <div className="font-semibold text-text-primary">{t('editor.ai.agent.selectedImageLoop.rollback')}</div>
          <div className="mt-1 truncate font-mono text-text-secondary">{review.rollbackCheckpoint.graphRevision}</div>
          <div className="mt-1 truncate font-mono text-emerald-100">{review.rollbackReceipt?.graphRevision}</div>
        </div>
        <div
          className="rounded border border-white/10 bg-black/15 p-2"
          data-audit-event-count={review.auditEventSummary.length}
          data-testid="agent-selected-image-preview-loop-audit-summary"
        >
          <div className="font-semibold text-text-primary">{t('editor.ai.agent.selectedImageLoop.audit')}</div>
          <div className="mt-1 font-mono text-text-secondary">
            {review.auditEventSummary.length} {t('editor.ai.agent.readiness.tools')}
          </div>
          <div className="mt-1 truncate font-mono text-[10px] text-text-secondary">
            {review.auditEventSummary.map((event) => event.toolName).join(' -> ')}
          </div>
        </div>
      </div>

      <div
        className="grid gap-2 md:grid-cols-4"
        data-disabled-reason={disabledReason}
        data-testid="agent-selected-image-preview-loop-controls"
      >
        <button
          className={`rounded-md border px-2 py-1.5 text-left text-[11px] ${selectedImageLoopControlStyles[review.controls.acceptApply.state]}`}
          data-control-state={review.controls.acceptApply.state}
          data-dispatch-path={AGENT_CURRENT_IMAGE_PREVIEW_LOOP_TOOL_NAME}
          data-testid="agent-selected-image-preview-loop-accept-apply"
          disabled={!acceptEnabled}
          onClick={() => {
            void dispatchLoop(review.controls.acceptApply, 'accepted');
          }}
          type="button"
        >
          <span className="block font-semibold">{review.controls.acceptApply.label}</span>
          <span className="mt-1 block leading-4 opacity-80">{review.controls.acceptApply.reason}</span>
        </button>
        <button
          className={`rounded-md border px-2 py-1.5 text-left text-[11px] ${selectedImageLoopControlStyles[review.controls.reviseWithFeedback.state]}`}
          data-control-state={review.controls.reviseWithFeedback.state}
          data-dispatch-path={AGENT_CURRENT_IMAGE_PREVIEW_LOOP_TOOL_NAME}
          data-feedback={review.controls.reviseWithFeedback.feedback}
          data-testid="agent-selected-image-preview-loop-revise"
          disabled={!reviseEnabled}
          onClick={() => {
            void dispatchLoop(review.controls.reviseWithFeedback, 'revised');
          }}
          type="button"
        >
          <span className="block font-semibold">{review.controls.reviseWithFeedback.label}</span>
          <span className="mt-1 block leading-4 opacity-80">{review.controls.reviseWithFeedback.reason}</span>
        </button>
        <button
          className={`rounded-md border px-2 py-1.5 text-left text-[11px] ${selectedImageLoopControlStyles[review.controls.rollback.state]}`}
          data-control-state={review.controls.rollback.state}
          data-dispatch-path={review.controls.rollback.toolName}
          data-testid="agent-selected-image-preview-loop-rollback"
          disabled={!rollbackEnabled}
          onClick={() => {
            void rollback();
          }}
          type="button"
        >
          <span className="block font-semibold">{review.controls.rollback.label}</span>
          <span className="mt-1 block leading-4 opacity-80">{review.controls.rollback.reason}</span>
        </button>
        <button
          className={`rounded-md border px-2 py-1.5 text-left text-[11px] ${selectedImageLoopControlStyles[exportControl.state]}`}
          data-control-state={exportControl.state}
          data-dispatch-path={exportControl.toolName}
          data-export-evidence-ready={String(hasExportEvidence)}
          data-testid="agent-selected-image-preview-loop-export-reviewed"
          disabled={!exportEnabled}
          onClick={() => {
            void exportReviewedEdit();
          }}
          type="button"
        >
          <span className="block font-semibold">{exportControl.label}</span>
          <span className="mt-1 block leading-4 opacity-80">{exportControl.reason}</span>
        </button>
      </div>

      {exportReceipt === undefined ? null : (
        <div
          className="grid gap-1 rounded border border-teal-500/25 bg-teal-500/10 p-2 text-[11px]"
          data-before-artifact-id={exportReceipt.beforePreviewArtifact.artifactId}
          data-current-artifact-id={exportReceipt.currentPreviewArtifact.artifactId}
          data-final-graph-revision={exportReceipt.finalGraphRevision}
          data-final-recipe-hash={exportReceipt.finalRecipeHash}
          data-no-overwrite-policy={exportReceipt.noOverwritePolicy}
          data-output-hash={exportReceipt.outputHash}
          data-output-path={exportReceipt.outputPath}
          data-rollback-status={exportReceipt.rollback.status}
          data-selected-raw-path={exportReceipt.selectedRawPath}
          data-testid="agent-selected-image-preview-loop-export-receipt"
        >
          <div className="font-semibold text-teal-100">{t('editor.ai.agent.selectedImageLoop.exportReceipt')}</div>
          <div className="truncate font-mono text-teal-100">{exportReceipt.outputHash}</div>
          <div className="truncate font-mono text-text-secondary">{exportReceipt.outputPath}</div>
        </div>
      )}

      {runtimeState.status === 'rejected' ? (
        <div
          className="rounded border border-red-500/25 bg-red-500/10 px-2 py-1 text-[11px] text-red-100"
          data-testid="agent-selected-image-preview-loop-error"
        >
          {runtimeState.error}
        </div>
      ) : null}
    </div>
  );
}

function LivePromptComposer({
  initialPromptPreviewContext,
  isContextReady,
  onResultChange,
  onSessionEvent,
}: LivePromptComposerProps) {
  const { t } = useTranslation();
  const promptInputRef = useRef<HTMLTextAreaElement | null>(null);
  const activeOperationRef = useRef<{ cancelled: boolean; id: string } | null>(null);
  const [prompt, setPrompt] = useState('');
  const [acceptedPrompt, setAcceptedPrompt] = useState('');
  const [activityEntries, setActivityEntries] = useState<LiveActivityEntry[]>([]);
  const [auditArtifact, setAuditArtifact] = useState<LiveAuditArtifactState | null>(null);
  const [result, setResult] = useState<LivePromptResult>({ status: 'idle' });
  const [rollbackSnapshot, setRollbackSnapshot] = useState<AgentRollbackSnapshot | null>(null);
  const [selectedImageLoopReview, setSelectedImageLoopReview] = useState<AgentSelectedImagePreviewLoopReview | null>(
    null,
  );
  const [sessionReview, setSessionReview] = useState<LiveSessionReviewState | null>(null);
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
  const effectiveSessionReview =
    sessionReview !== null && rollbackValidation?.state === 'invalidated' && sessionReview.rollbackState === 'available'
      ? { ...sessionReview, rollbackState: 'invalidated' as const }
      : sessionReview;
  const canRun = isContextReady && result.status !== 'applying' && result.status !== 'cancelling';
  const canApply = isContextReady && acceptedPrompt.length > 0 && result.status === 'dry_run_ready';
  const canRunSelectedImageLoop = canApply;
  const canCancel = result.status === 'applying' && activeOperationRef.current !== null;
  const canRequestDetailPreview = isContextReady && result.status !== 'applying' && result.status !== 'cancelling';
  const canInspectState = isContextReady && result.status !== 'applying' && result.status !== 'cancelling';
  const canRefreshPreview = isContextReady && result.status !== 'applying' && result.status !== 'cancelling';
  const canRequestExportProof = isContextReady && result.status === 'applied' && result.recipeName !== undefined;
  const canRollback =
    rollbackSnapshot !== null && rollbackValidation?.state === 'available' && result.status === 'applied';
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
      statusLabel = 'Cancelling selected-image session';
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
  }

  const pushActivityEntry = (entry: LiveActivityEntryInput) => {
    setActivityEntries((entries) => {
      const nextEntry: LiveActivityEntry = {
        body: entry.body,
        id: `live-activity-${Date.now()}-${entries.length}`,
        kind: entry.kind,
        status: entry.status,
      };

      if (entry.acceptedPreviewArtifactId !== undefined) {
        nextEntry.acceptedPreviewArtifactId = entry.acceptedPreviewArtifactId;
      }
      if (entry.graphRevision !== undefined) nextEntry.graphRevision = entry.graphRevision;
      if (entry.approvalId !== undefined) nextEntry.approvalId = entry.approvalId;
      if (entry.exportArtifactId !== undefined) nextEntry.exportArtifactId = entry.exportArtifactId;
      if (entry.previewAfterHash !== undefined) nextEntry.previewAfterHash = entry.previewAfterHash;
      if (entry.previewBeforeHash !== undefined) nextEntry.previewBeforeHash = entry.previewBeforeHash;
      if (entry.recipeHash !== undefined) nextEntry.recipeHash = entry.recipeHash;
      if (entry.toolName !== undefined) nextEntry.toolName = entry.toolName;

      return [...entries, nextEntry];
    });
  };

  const runDryRun = async () => {
    const requestedPrompt = (promptInputRef.current?.value ?? prompt).trim();
    if (!isContextReady || requestedPrompt.length === 0) return;

    try {
      if (initialPromptPreviewContext !== undefined) {
        pushActivityEntry({
          body: `${initialPromptPreviewContext.purpose} ${initialPromptPreviewContext.artifactId}`,
          graphRevision: initialPromptPreviewContext.graphRevision,
          kind: 'preview',
          previewAfterHash: initialPromptPreviewContext.renderHash,
          recipeHash: initialPromptPreviewContext.recipeHash,
          status: 'completed',
          toolName: RAW_ENGINE_IMAGE_GET_PREVIEW_TOOL_NAME,
        });
      }
      pushActivityEntry({
        body: requestedPrompt,
        kind: 'prompt',
        status: 'completed',
        toolName: 'rawengine.agent.session.prompt',
      });
      onSessionEvent?.(createLiveSessionEvent('user', requestedPrompt, 'prompt'));
      const plan = planAgentEditRecipe(requestedPrompt);
      const safetyDecision = evaluateAgentSafetyPolicy({
        operationKind: inferAgentSafetyOperationKind(requestedPrompt),
        prompt: requestedPrompt,
      });
      const preview = await runAgentBoundedEditPlannerLoop({
        maxSteps: 5,
        operationId: `agent_chat_${Date.now()}`,
        prompt: requestedPrompt,
        sessionId: 'agent-chat-shell',
      });
      pushActivityEntry({
        body: plan.summary,
        kind: 'preview',
        previewAfterHash: preview.dryRunAfterHash,
        previewBeforeHash: preview.dryRunBeforeHash,
        recipeHash: plan.recipeName,
        status: 'completed',
        toolName: 'rawengine.agent.preview.render',
      });
      if (safetyDecision.blocked || safetyDecision.approvalRequired) {
        pushActivityEntry({
          approvalId: safetyDecision.decisionId,
          body: safetyDecision.reason,
          kind: 'approval',
          recipeHash: safetyDecision.decisionId,
          status: safetyDecision.blocked ? 'blocked' : 'pending',
          toolName: 'rawengine.agent.safety_policy',
        });
      }
      setAcceptedPrompt(requestedPrompt);
      const nextResult = {
        previewAfterHash: preview.dryRunAfterHash,
        previewBeforeHash: preview.dryRunBeforeHash,
        recipeName: plan.recipeName,
        safetyDecision,
        status: safetyDecision.blocked
          ? 'blocked'
          : safetyDecision.approvalRequired
            ? 'approval_required'
            : 'dry_run_ready',
        summary: plan.summary,
      } satisfies LivePromptResult;
      setResult(nextResult);
      onResultChange?.(nextResult);
      onSessionEvent?.(
        createLiveSessionEvent(
          'assistant',
          `${t('editor.ai.agent.composer.status.dry_run_ready')}: ${plan.summary}`,
          'dry-run-ready',
        ),
      );
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : t('editor.ai.agent.composer.unknownError');
      pushActivityEntry({
        body: errorMessage,
        kind: 'error',
        status: 'blocked',
        toolName: 'rawengine.agent.session.prompt',
      });
      const nextResult = {
        error: errorMessage,
        status: 'failed',
      } satisfies LivePromptResult;
      setResult(nextResult);
      onResultChange?.(nextResult);
      onSessionEvent?.(
        createLiveSessionEvent(
          'assistant',
          `${t('editor.ai.agent.composer.status.failed')}: ${errorMessage}`,
          'failed',
        ),
      );
    }
  };

  const approveSafetyGate = () => {
    if (result.status !== 'approval_required') return;
    pushActivityEntry({
      approvalId: result.safetyDecision?.decisionId,
      body: t('editor.ai.agent.composer.policy.approved'),
      kind: 'approval',
      recipeHash: result.safetyDecision?.decisionId,
      status: 'completed',
      toolName: 'rawengine.agent.safety_policy',
    });
    const nextResult = { ...result, status: 'dry_run_ready' } satisfies LivePromptResult;
    setResult(nextResult);
    onResultChange?.(nextResult);
    onSessionEvent?.(
      createLiveSessionEvent('assistant', t('editor.ai.agent.composer.policy.approved'), 'approval-granted'),
    );
  };

  const inspectState = () => {
    if (!canInspectState) return;

    try {
      const stateResult = getAgentReadOnlyState({
        expectedRecipeHash: result.recipeName ?? initialPromptPreviewContext?.recipeHash,
        requestId: `agent-live-state-inspect-${Date.now()}`,
      });
      const snapshot = agentImageContextSnapshotSchema.parse(stateResult.snapshot);
      pushActivityEntry({
        body: `${snapshot.graphRevision} · ${snapshot.activeImagePath}`,
        graphRevision: snapshot.graphRevision,
        kind: 'state',
        previewAfterHash: snapshot.initialPreview.renderHash,
        recipeHash: snapshot.initialPreview.recipeHash,
        status: stateResult.staleRecipeHash ? 'pending' : 'completed',
        toolName: AGENT_STATE_GET_TOOL_NAME,
      });
      const nextResult = {
        ...result,
        previewAfterHash: snapshot.initialPreview.renderHash,
        previewStaleRecipeHash: stateResult.staleRecipeHash,
        recipeName: snapshot.initialPreview.recipeHash,
        stateAdjustmentCount: snapshot.adjustmentSummary.length,
        stateGraphRevision: snapshot.graphRevision,
        stateImagePath: snapshot.activeImagePath,
        stateMaskCount: snapshot.subjectHint.maskCount,
        stateMetadataCount: snapshot.metadataSummary.length,
        stateRecipeHash: snapshot.initialPreview.recipeHash,
        stateStaleRecipeHash: stateResult.staleRecipeHash,
      } satisfies LivePromptResult;
      setResult(nextResult);
      onResultChange?.(nextResult);
      onSessionEvent?.(
        createLiveSessionEvent('assistant', `${AGENT_STATE_GET_TOOL_NAME}: ${snapshot.graphRevision}`, 'state-inspect'),
      );
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : t('editor.ai.agent.composer.unknownError');
      pushActivityEntry({
        body: errorMessage,
        kind: 'error',
        status: 'blocked',
        toolName: AGENT_STATE_GET_TOOL_NAME,
      });
    }
  };

  const refreshPreview = () => {
    if (!canRefreshPreview) return;

    try {
      const previewResult = renderAgentReadOnlyPreview({
        expectedRecipeHash: result.recipeName ?? initialPromptPreviewContext?.recipeHash,
        longEdgePx: initialPromptPreviewContext?.longEdgePx ?? 1536,
        purpose: 'refresh',
        quality: initialPromptPreviewContext?.quality ?? 0.86,
        requestId: `agent-live-preview-refresh-${Date.now()}`,
      });
      pushActivityEntry({
        body: `${previewResult.preview.purpose} ${previewResult.preview.artifactId}`,
        graphRevision: initialPromptPreviewContext?.graphRevision,
        kind: 'preview',
        previewAfterHash: previewResult.preview.renderHash,
        recipeHash: previewResult.preview.recipeHash,
        status: previewResult.staleRecipeHash ? 'pending' : 'completed',
        toolName: AGENT_PREVIEW_RENDER_TOOL_NAME,
      });
      const nextResult = {
        ...result,
        previewAfterHash: previewResult.preview.renderHash,
        previewStaleRecipeHash: previewResult.staleRecipeHash,
        recipeName: previewResult.preview.recipeHash,
      } satisfies LivePromptResult;
      setResult(nextResult);
      onResultChange?.(nextResult);
      onSessionEvent?.(
        createLiveSessionEvent(
          'assistant',
          `${AGENT_PREVIEW_RENDER_TOOL_NAME}: ${previewResult.preview.artifactId}`,
          'preview-refresh',
        ),
      );
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : t('editor.ai.agent.composer.unknownError');
      pushActivityEntry({
        body: errorMessage,
        kind: 'error',
        status: 'blocked',
        toolName: AGENT_PREVIEW_RENDER_TOOL_NAME,
      });
    }
  };

  const requestDetailPreview = () => {
    if (!canRequestDetailPreview) return;

    try {
      const previewResult = renderAgentReadOnlyPreview({
        expectedRecipeHash: result.recipeName ?? initialPromptPreviewContext?.recipeHash,
        longEdgePx: initialPromptPreviewContext?.longEdgePx ?? 1536,
        purpose: 'detail_review',
        quality: initialPromptPreviewContext?.quality ?? 0.86,
        requestId: `agent-live-detail-preview-${Date.now()}`,
        zoom: {
          centerX: 0.5,
          centerY: 0.5,
          scale: 2,
        },
      });
      pushActivityEntry({
        body: `${previewResult.preview.purpose} ${previewResult.preview.artifactId}`,
        graphRevision: initialPromptPreviewContext?.graphRevision,
        kind: 'preview',
        previewAfterHash: previewResult.preview.renderHash,
        previewBeforeHash: result.previewAfterHash,
        recipeHash: previewResult.preview.recipeHash,
        status: previewResult.staleRecipeHash ? 'pending' : 'completed',
        toolName: AGENT_PREVIEW_RENDER_TOOL_NAME,
      });
      const nextResult = {
        ...result,
        previewAfterHash: previewResult.preview.renderHash,
        previewStaleRecipeHash: previewResult.staleRecipeHash,
        recipeName: previewResult.preview.recipeHash,
      } satisfies LivePromptResult;
      if (result.previewAfterHash !== undefined) nextResult.previewBeforeHash = result.previewAfterHash;
      setResult(nextResult);
      onResultChange?.(nextResult);
      onSessionEvent?.(
        createLiveSessionEvent(
          'assistant',
          `${AGENT_PREVIEW_RENDER_TOOL_NAME}: ${previewResult.preview.artifactId}`,
          'detail-preview',
        ),
      );
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : t('editor.ai.agent.composer.unknownError');
      pushActivityEntry({
        body: errorMessage,
        kind: 'error',
        status: 'blocked',
        toolName: AGENT_PREVIEW_RENDER_TOOL_NAME,
      });
    }
  };

  const cancelActiveOperation = () => {
    const operation = activeOperationRef.current;
    if (operation === null) return;
    operation.cancelled = true;
    pushActivityEntry({
      body: `Cancellation requested for ${operation.id}. Late results will be rejected at the session boundary.`,
      kind: 'approval',
      status: 'pending',
      toolName: 'rawengine.agent.session.cancel',
    });
    const nextResult = { ...result, status: 'cancelling' } satisfies LivePromptResult;
    setResult(nextResult);
    onResultChange?.(nextResult);
    onSessionEvent?.(createLiveSessionEvent('assistant', 'Selected-image session cancellation requested.', 'cancel'));
  };

  const applyDryRun = async () => {
    if (!canApply) return;

    const operation = { cancelled: false, id: `agent-chat-apply-${Date.now()}` };
    activeOperationRef.current = operation;
    try {
      setRollbackSnapshot(createAgentRollbackSnapshot());
      pushActivityEntry({
        body: t('editor.ai.agent.composer.status.applying'),
        kind: 'tool_call',
        previewAfterHash: result.previewAfterHash,
        previewBeforeHash: result.previewBeforeHash,
        recipeHash: result.recipeName,
        status: 'pending',
        toolName: 'rawengine.live_basic_tone.apply',
      });
      const applyingResult = { ...result, status: 'applying' } satisfies LivePromptResult;
      setResult(applyingResult);
      onResultChange?.(applyingResult);
      onSessionEvent?.(createLiveSessionEvent('assistant', t('editor.ai.agent.composer.status.applying'), 'applying'));
      const plan = planAgentEditRecipe(acceptedPrompt);
      const requestId = operation.id;
      const sessionRequest = buildLiveMultiTurnSessionRequest({
        operationId: `agent_chat_apply_${Date.now()}`,
        plan,
        prompt: acceptedPrompt,
        requestId,
        sessionId: 'agent-chat-shell',
      });
      const firstTurnAdjustment = sessionRequest.turns[0]?.adjustment;
      if (firstTurnAdjustment === undefined) throw new Error(t('editor.ai.agent.composer.noApplyStep'));
      const selectedImageDraft = approveAgentSelectedImageLiveSession(
        await startAgentSelectedImageLiveSessionDryRun({
          adjustments: firstTurnAdjustment,
          operationId: sessionRequest.operationId,
          prompt: acceptedPrompt,
          requestId,
          sessionId: sessionRequest.sessionId,
        }),
      );
      const selectedImageApply = await applyAgentSelectedImageLiveSession(selectedImageDraft);
      const selectedImageReceipt = replayAgentSelectedImageLiveSessionAudit(selectedImageApply.audit);
      const selectedImageFinalRecipeHash =
        selectedImageReceipt.finalRecipeHash ?? selectedImageDraft.snapshot.recipeHash;
      if (operation.cancelled || activeOperationRef.current?.id !== operation.id) {
        pushActivityEntry({
          body: `Late apply result ${selectedImageReceipt.finalGraphRevision ?? selectedImageDraft.snapshot.graphRevision} blocked after cancellation.`,
          graphRevision: selectedImageReceipt.finalGraphRevision,
          kind: 'error',
          recipeHash: selectedImageReceipt.finalRecipeHash,
          status: 'blocked',
          toolName: 'rawengine.agent.session.cancel',
        });
        return;
      }

      const nextResult = {
        ...applyingResult,
        appliedGraphRevision: selectedImageApply.apply.appliedGraphRevision,
        changedPixelCount: selectedImageApply.apply.changedPixelCount,
        changedPixelPercent: selectedImageApply.apply.changedPixelPercent,
        maxChannelDelta: selectedImageApply.apply.maxChannelDelta,
        meanLuminanceDelta: selectedImageApply.apply.meanLuminanceDelta,
        previewAfterHash: selectedImageApply.previewAfterHash,
        previewBeforeHash: selectedImageApply.previewBeforeHash,
        recipeName: selectedImageFinalRecipeHash,
        sampledPixelCount: selectedImageApply.apply.sampledPixelCount,
        status: 'applied',
      } satisfies LivePromptResult;
      const previewLineage: AgentMultiTurnAppServerSessionResult['previewLineage'] = [
        {
          artifactId: initialPromptPreviewContext?.artifactId ?? `${requestId}-before-preview`,
          graphRevision: selectedImageReceipt.initialGraphRevision,
          purpose: 'initial_context',
          recipeHash: selectedImageReceipt.initialRecipeHash,
          renderHash: selectedImageReceipt.beforePreviewHash,
          toolCallId: `${requestId}-dry-run`,
          turn: 0,
        },
        {
          artifactId: `${requestId}-after-preview`,
          graphRevision: selectedImageReceipt.finalGraphRevision ?? selectedImageApply.apply.appliedGraphRevision,
          purpose: 'refresh',
          recipeHash: selectedImageFinalRecipeHash,
          renderHash: selectedImageReceipt.afterPreviewHash ?? selectedImageApply.previewAfterHash,
          toolCallId: `${requestId}-after-preview`,
          turn: 1,
        },
      ];
      const initialPreviewReceipt =
        initialPromptPreviewContext === undefined
          ? undefined
          : ({
              colorPipeline: {
                encodedProfile: 'srgb-preview',
                outputProfile: 'srgb',
                previewTransform: 'editor-preview-to-srgb-jpeg',
                workingSpace: 'rawengine-scene-linear',
              },
              contentHash: `sha256:${initialPromptPreviewContext.renderHash
                .replace(/^render:/u, '')
                .padEnd(16, '0')
                .slice(0, 64)}`,
              graphRevision: selectedImageReceipt.initialGraphRevision,
              imagePath: selectedImageReceipt.selectedImagePath,
              preview: {
                accessScope: initialPromptPreviewContext.accessScope,
                artifactId: initialPromptPreviewContext.artifactId,
                encodedFormat: initialPromptPreviewContext.encodedFormat,
                height: initialPromptPreviewContext.height,
                includesOriginalRaw: initialPromptPreviewContext.includesOriginalRaw,
                longEdgePx: initialPromptPreviewContext.longEdgePx,
                mediaType: initialPromptPreviewContext.mediaType,
                previewRef: initialPromptPreviewContext.previewRef,
                purpose: initialPromptPreviewContext.purpose,
                quality: initialPromptPreviewContext.quality,
                recipeHash: initialPromptPreviewContext.recipeHash,
                renderHash: initialPromptPreviewContext.renderHash,
                width: initialPromptPreviewContext.width,
              },
              proofContext: {
                stale: initialPromptPreviewContext.recipeHash !== selectedImageReceipt.initialRecipeHash,
                transport: initialPromptPreviewContext.transport,
              },
              requestId: `${requestId}-initial-preview`,
              schemaVersion: 1,
              sessionId: selectedImageReceipt.sessionId,
              toolName: RAW_ENGINE_IMAGE_GET_PREVIEW_TOOL_NAME,
            } satisfies AgentMultiTurnAppServerSessionResult['initialPreviewReceipt']);
      setSessionReview({
        applyState: 'applied',
        finalGraphRevision: selectedImageApply.apply.appliedGraphRevision,
        finalRecipeHash: selectedImageFinalRecipeHash,
        ...(initialPreviewReceipt === undefined ? {} : { initialPreviewReceipt }),
        previewLineage,
        rollbackGraphRevision: selectedImageReceipt.rollbackGraphRevision,
        rollbackState: 'available',
        toolCallCount: selectedImageReceipt.toolCalls.length,
      });
      const persistedSelectedImageAuditCount = appendSelectedImageLiveSessionAuditRecord(selectedImageApply.audit);
      setAuditArtifact({
        artifactId: `agent-selected-image-live-audit-${selectedImageReceipt.sessionId}`,
        finalGraphRevision: selectedImageApply.apply.appliedGraphRevision,
        persistedRecordCount: persistedSelectedImageAuditCount,
        previewCount: previewLineage.length,
        rollbackGraphRevision: selectedImageReceipt.rollbackGraphRevision,
        sessionId: selectedImageReceipt.sessionId,
        toolCallCount: selectedImageReceipt.toolCalls.length,
      });
      pushActivityEntry({
        acceptedPreviewArtifactId: selectedImageReceipt.acceptedPreviewArtifactId,
        body: `Approved selected-image dry-run ${selectedImageReceipt.dryRunPlanId}.`,
        graphRevision: selectedImageApply.apply.appliedGraphRevision,
        kind: 'tool_call',
        previewAfterHash: selectedImageApply.previewAfterHash,
        previewBeforeHash: selectedImageApply.previewBeforeHash,
        recipeHash: selectedImageFinalRecipeHash,
        status: 'completed',
        toolName: AGENT_ADJUSTMENTS_APPLY_TOOL_NAME,
      });
      for (const preview of previewLineage) {
        pushActivityEntry({
          body: `${preview.purpose} ${preview.artifactId}`,
          graphRevision: preview.graphRevision,
          kind: 'preview',
          previewAfterHash: preview.renderHash,
          recipeHash: preview.recipeHash,
          status: 'completed',
          toolName: 'rawengine.agent.preview.render',
        });
      }
      pushActivityEntry({
        body: `${selectedImageReceipt.toolCalls.length} typed tool calls completed.`,
        graphRevision: selectedImageApply.apply.appliedGraphRevision,
        kind: 'tool_call',
        recipeHash: selectedImageFinalRecipeHash,
        status: 'completed',
        toolName: 'rawengine.agent.selected_image.live_session',
      });
      pushActivityEntry({
        body: `Replayable selected-image audit receipt ${selectedImageReceipt.sessionId}.`,
        graphRevision: selectedImageApply.apply.appliedGraphRevision,
        kind: 'tool_call',
        recipeHash: selectedImageFinalRecipeHash,
        status: 'completed',
        toolName: 'rawengine.agent.audit.persist',
      });
      setResult(nextResult);
      onResultChange?.(nextResult);
      onSessionEvent?.(
        createLiveSessionEvent(
          'assistant',
          `${t('editor.ai.agent.composer.status.applied')}: ${nextResult.appliedGraphRevision}`,
          'applied',
        ),
      );
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : t('editor.ai.agent.composer.unknownError');
      pushActivityEntry({
        body: errorMessage,
        kind: 'error',
        recipeHash: result.recipeName,
        status: 'blocked',
        toolName: 'rawengine.agent.session.multiturn',
      });
      const nextResult = {
        ...result,
        error: errorMessage,
        status: 'failed',
      } satisfies LivePromptResult;
      setResult(nextResult);
      onResultChange?.(nextResult);
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

  const runSelectedImagePreviewLoopFromPanel = async () => {
    if (!canRunSelectedImageLoop) return;

    const operation = { cancelled: false, id: `agent-chat-selected-loop-${Date.now()}` };
    activeOperationRef.current = operation;
    const initialSnapshot = createAgentRollbackSnapshot();
    const operationStamp = operation.id.replace('agent-chat-selected-loop-', '');
    const operationId = `agent_chat_selected_loop_${operationStamp}`;
    const requestId = operation.id;
    const sessionId = 'agent-chat-shell';

    try {
      const plan = planAgentEditRecipe(acceptedPrompt);
      const steps = buildSelectedImageLoopSteps({ plan, prompt: acceptedPrompt });
      const dryRunApprovals: AgentCurrentImagePreviewLoopRequest['dryRunApprovals'] = [];
      setSelectedImageLoopReview(null);
      pushActivityEntry({
        body: 'Generating accepted dry-run plan hashes for the selected-image preview loop.',
        graphRevision: initialSnapshot.graphRevision,
        kind: 'approval',
        recipeHash: initialSnapshot.recipeHash,
        status: 'pending',
        toolName: AGENT_CURRENT_IMAGE_PREVIEW_LOOP_TOOL_NAME,
      });
      const applyingResult = { ...result, status: 'applying' } satisfies LivePromptResult;
      setResult(applyingResult);
      onResultChange?.(applyingResult);

      try {
        for (const [index, step] of steps.entries()) {
          const {
            assistantRationale: _assistantRationale,
            preview: _preview,
            userFollowUp: _userFollowUp,
            ...adjustments
          } = step;
          const snapshot = buildAgentImageContextSnapshot();
          const turnOperationId = `${operationId}-${index + 1}`;
          if (operation.cancelled) throw new Error('Selected-image preview loop cancelled before dry-run dispatch.');
          const dryRunRequestId = `${requestId}-approval-dry-run-${index + 1}`;
          const dryRun = agentAdjustmentsDryRunResponseSchema.parse(
            await dispatchAgentLiveEditorTool({
              args: {
                adjustments: adjustments as AgentAdjustmentsApplyRequest['adjustments'],
                expectedGraphRevision: snapshot.graphRevision,
                expectedRecipeHash: snapshot.initialPreview.recipeHash,
                operationId: turnOperationId,
                requestId: dryRunRequestId,
                sessionId,
              },
              requestId: dryRunRequestId,
              runtimeToolName: AGENT_ADJUSTMENTS_DRY_RUN_TOOL_NAME,
            }),
          );
          dryRunApprovals.push({
            acceptedPlanHash: dryRun.dryRunPlanHash,
            acceptedPlanId: dryRun.dryRunPlanId,
            approvalState: 'approved',
            expectedGraphRevision: dryRun.sourceGraphRevision,
            turn: index + 2,
          });
          pushActivityEntry({
            approvalId: dryRun.dryRunPlanId,
            body: `${dryRun.adjustedFields.join(', ')} ${dryRun.dryRunPlanHash}`,
            graphRevision: dryRun.sourceGraphRevision,
            kind: 'approval',
            recipeHash: snapshot.initialPreview.recipeHash,
            status: 'completed',
            toolName: dryRun.toolName,
          });
          if (operation.cancelled) throw new Error('Selected-image preview loop cancelled before apply dispatch.');
          const applyRequestId = `${requestId}-approval-apply-${index + 1}`;
          agentAdjustmentsApplyResponseSchema.parse(
            await dispatchAgentLiveEditorTool({
              args: {
                acceptedPlanHash: dryRun.dryRunPlanHash,
                acceptedPlanId: dryRun.dryRunPlanId,
                adjustments: adjustments as AgentAdjustmentsApplyRequest['adjustments'],
                expectedGraphRevision: dryRun.sourceGraphRevision,
                expectedRecipeHash: snapshot.initialPreview.recipeHash,
                operationId: turnOperationId,
                requestId: applyRequestId,
                sessionId,
              },
              requestId: applyRequestId,
              runtimeToolName: AGENT_ADJUSTMENTS_APPLY_TOOL_NAME,
            }),
          );
        }
      } finally {
        restoreAgentRollbackSnapshot(initialSnapshot);
      }

      const loopRequest: AgentCurrentImagePreviewLoopRequest = {
        dryRunApprovals,
        expectedGraphRevision: initialSnapshot.graphRevision,
        expectedPreviewHeight: buildAgentImageContextSnapshot().initialPreview.height,
        expectedPreviewIdentity: buildAgentImageContextSnapshot().previewIdentity,
        expectedPreviewWidth: buildAgentImageContextSnapshot().initialPreview.width,
        expectedRecipeHash: initialSnapshot.recipeHash,
        maxIterations: 4,
        operationId,
        prompt: acceptedPrompt,
        requestId,
        rollbackAfterReview: false,
        selectedImagePath: initialSnapshot.activeImagePath,
        sessionId,
        steps,
      };
      const loopResult = agentCurrentImagePreviewLoopResultSchema.parse(
        await dispatchAgentLiveEditorTool({
          args: loopRequest,
          requestId,
          runtimeToolName: AGENT_CURRENT_IMAGE_PREVIEW_LOOP_TOOL_NAME,
        }),
      );
      if (operation.cancelled || activeOperationRef.current?.id !== operation.id) {
        restoreAgentRollbackSnapshot(initialSnapshot);
        pushActivityEntry({
          body: `Late selected-image result ${loopResult.finalGraphRevision} blocked after cancellation.`,
          graphRevision: loopResult.finalGraphRevision,
          kind: 'error',
          recipeHash: loopResult.finalRecipeHash,
          status: 'blocked',
          toolName: 'rawengine.agent.session.cancel',
        });
        return;
      }
      setSelectedImageLoopReview(
        buildSelectedImageLoopReview({ prompt: acceptedPrompt, request: loopRequest, result: loopResult }),
      );
      const latestReceipt = loopResult.applyReceipts.at(-1);
      if (latestReceipt === undefined) throw new Error('Selected-image preview loop did not return an apply receipt.');
      const nextResult = {
        ...applyingResult,
        appliedGraphRevision: loopResult.finalGraphRevision,
        changedPixelCount: latestReceipt.changedPixelCount,
        changedPixelPercent: latestReceipt.changedPixelPercent,
        maxChannelDelta: latestReceipt.maxChannelDelta,
        meanLuminanceDelta: latestReceipt.meanLuminanceDelta,
        previewAfterHash: loopResult.finalRecipeHash,
        previewBeforeHash: loopResult.initialRecipeHash,
        recipeName: loopResult.finalRecipeHash,
        sampledPixelCount: latestReceipt.sampledPixelCount,
        status: 'applied',
        summary: `${loopResult.acceptedDryRunPlanCount} accepted dry-run plans, ${loopResult.previewRefreshCount} previews, ${loopResult.rollbackReceipt === undefined ? 'rollback available' : 'rollback restored'}.`,
      } satisfies LivePromptResult;
      pushActivityEntry({
        body: `${loopResult.acceptedDryRunPlanCount} accepted dry-run plans dispatched for ${loopResult.selectedImagePath}.`,
        graphRevision: loopResult.finalGraphRevision,
        kind: 'tool_call',
        recipeHash: loopResult.finalRecipeHash,
        status: 'completed',
        toolName: loopResult.toolName,
      });
      pushActivityEntry({
        body: `${loopResult.compareArtifactIds.beforeArtifactId} -> ${loopResult.compareArtifactIds.currentArtifactId}`,
        graphRevision: loopResult.finalGraphRevision,
        kind: 'preview',
        recipeHash: loopResult.finalRecipeHash,
        status: 'completed',
        toolName: 'rawengine.agent.preview.compare',
      });
      if (loopResult.rollbackReceipt !== undefined) {
        pushActivityEntry({
          body: loopResult.rollbackReceipt.graphRevision,
          graphRevision: loopResult.rollbackReceipt.graphRevision,
          kind: 'rollback',
          recipeHash: loopResult.rollbackReceipt.previewRecipeHash,
          status: 'rolled_back',
          toolName: loopResult.rollbackReceipt.toolName,
        });
      }
      setResult(nextResult);
      onResultChange?.(nextResult);
      onSessionEvent?.(
        createLiveSessionEvent(
          'assistant',
          `${AGENT_CURRENT_IMAGE_PREVIEW_LOOP_TOOL_NAME}: ${loopResult.selectedImagePath}`,
          'selected-image-loop',
        ),
      );
    } catch (error) {
      restoreAgentRollbackSnapshot(initialSnapshot);
      const errorMessage = error instanceof Error ? error.message : t('editor.ai.agent.composer.unknownError');
      pushActivityEntry({
        body: errorMessage,
        graphRevision: initialSnapshot.graphRevision,
        kind: 'error',
        recipeHash: initialSnapshot.recipeHash,
        status: 'blocked',
        toolName: AGENT_CURRENT_IMAGE_PREVIEW_LOOP_TOOL_NAME,
      });
      const nextResult = {
        ...result,
        error: errorMessage,
        status: 'failed',
      } satisfies LivePromptResult;
      setResult(nextResult);
      onResultChange?.(nextResult);
    } finally {
      if (activeOperationRef.current?.id === operation.id) activeOperationRef.current = null;
    }
  };

  const requestExportProof = async () => {
    if (!canRequestExportProof) return;

    try {
      const snapshot = buildAgentImageContextSnapshot();
      const requestId = `agent-live-export-proof-${Date.now()}`;
      const exportProof = agentExportProofResponseSchema.parse(
        await dispatchAgentLiveEditorTool({
          args: {
            approval: {
              approvalId: `approval_export_${requestId}`,
              approvedGraphRevision: snapshot.graphRevision,
              approvedRecipeHash: snapshot.initialPreview.recipeHash,
              approvedSelectedImagePath: snapshot.activeImagePath,
              approvedSessionId: 'agent-chat-shell',
              status: 'approved',
            },
            dryRun: true,
            expectedRecipeHash: snapshot.initialPreview.recipeHash,
            operationId: requestId,
            requestId,
            sessionId: 'agent-chat-shell',
          },
          requestId,
          runtimeToolName: AGENT_EXPORT_PROOF_TOOL_NAME,
        }),
      );
      pushActivityEntry({
        body: `${exportProof.output.fileFormat} ${exportProof.output.width}x${exportProof.output.height} ${exportProof.exportHash}`,
        exportArtifactId: exportProof.output.previewRef,
        graphRevision: exportProof.receipt.graphRevision,
        kind: 'export',
        previewAfterHash: exportProof.receipt.previewRenderHash,
        recipeHash: exportProof.receipt.recipeHash,
        status: 'completed',
        toolName: exportProof.toolName,
      });
      const nextResult = {
        ...result,
        exportHash: exportProof.exportHash,
        exportHeight: exportProof.output.height,
        exportPreviewRef: exportProof.output.previewRef,
        exportReceiptGraphRevision: exportProof.receipt.graphRevision,
        exportReceiptPreviewHash: exportProof.receipt.previewRenderHash,
        exportWidth: exportProof.output.width,
      } satisfies LivePromptResult;
      setResult(nextResult);
      onResultChange?.(nextResult);
      onSessionEvent?.(
        createLiveSessionEvent(
          'assistant',
          `${AGENT_EXPORT_PROOF_TOOL_NAME}: ${exportProof.exportHash}`,
          'export-proof',
        ),
      );
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : t('editor.ai.agent.composer.unknownError');
      pushActivityEntry({
        body: errorMessage,
        kind: 'error',
        recipeHash: result.recipeName,
        status: 'blocked',
        toolName: AGENT_EXPORT_PROOF_TOOL_NAME,
      });
    }
  };

  const rollbackApply = async () => {
    if (rollbackSnapshot === null) return;
    const validation = validateAgentRollbackSnapshot(rollbackSnapshot);
    if (validation.state === 'invalidated') {
      setSessionReview((review) => (review === null ? null : { ...review, rollbackState: 'invalidated' }));
      pushActivityEntry({
        body: t('editor.ai.agent.composer.rollbackInvalidated'),
        graphRevision: validation.currentGraphRevision,
        kind: 'rollback',
        recipeHash: validation.currentRecipeHash,
        status: 'blocked',
        toolName: 'rawengine.agent.history.rollback',
      });
      return;
    }

    const rollbackRequestId = `agent-live-rollback-${Date.now()}`;
    const rollbackReceipt = agentHistoryRollbackResponseSchema.parse(
      await dispatchAgentLiveEditorTool({
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
        requestId: rollbackRequestId,
        runtimeToolName: AGENT_HISTORY_ROLLBACK_TOOL_NAME,
      }),
    );
    setRollbackSnapshot(null);
    setSessionReview((review) => (review === null ? null : { ...review, rollbackState: 'restored' }));
    pushActivityEntry({
      body: t('editor.ai.agent.composer.status.rolled_back'),
      graphRevision: rollbackReceipt.graphRevision,
      kind: 'rollback',
      recipeHash: rollbackReceipt.previewRecipeHash,
      status: 'rolled_back',
      toolName: rollbackReceipt.toolName,
    });
    const nextResult = { ...result, status: 'rolled_back' } satisfies LivePromptResult;
    setResult(nextResult);
    onResultChange?.(nextResult);
    onSessionEvent?.(
      createLiveSessionEvent('assistant', t('editor.ai.agent.composer.status.rolled_back'), 'rolled-back'),
    );
  };

  return (
    <form
      className="pointer-events-auto relative z-10 space-y-3 rounded-md border border-sky-500/20 bg-sky-500/5 p-3"
      data-color-tool-name={AGENT_COLOR_APPLY_TOOL_NAME}
      data-detail-tool-name={AGENT_DETAIL_EFFECTS_APPLY_TOOL_NAME}
      data-layer-create-tool-name={AGENT_LAYER_CREATE_TOOL_NAME}
      data-layer-scoped-adjust-tool-name={AGENT_LAYER_SCOPED_ADJUST_TOOL_NAME}
      data-live-prompt-status={result.status}
      data-mask-create-or-update-tool-name={AGENT_MASK_CREATE_OR_UPDATE_TOOL_NAME}
      data-safety-decision={result.safetyDecision?.decisionId ?? ''}
      data-safety-severity={result.safetyDecision?.severity ?? ''}
      data-session-input-state={isContextReady ? 'ready' : 'blocked'}
      data-preview-refresh-policy="native-renderer-handoff"
      data-testid="agent-live-prompt-composer"
      onSubmit={(event) => {
        event.preventDefault();
        void runDryRun();
      }}
    >
      <div
        className="sr-only"
        data-approval-gate="required-before-layer-mask-apply"
        data-apply-receipt="layer-mask-command-receipt"
        data-dry-run-required="true"
        data-rollback-path="rawengine.agent.history.rollback"
        data-testid="agent-live-layer-mask-operation-proof"
      />
      <div className="space-y-1">
        <label className="text-xs font-semibold text-text-primary" htmlFor="agent-live-prompt-input">
          {t('editor.ai.agent.composer.label')}
        </label>
        <textarea
          className="min-h-20 w-full resize-y rounded-md border border-white/10 bg-black/20 px-3 py-2 text-xs leading-5 text-text-primary outline-none transition-colors placeholder:text-text-secondary focus:border-primary/60"
          data-testid="agent-live-prompt-input"
          id="agent-live-prompt-input"
          disabled={!isContextReady}
          onChange={(event) => {
            setPrompt(event.target.value);
          }}
          onInput={(event) => {
            setPrompt(event.currentTarget.value);
          }}
          onMouseDown={() => {
            promptInputRef.current?.focus();
          }}
          placeholder={t('editor.ai.agent.composer.placeholder')}
          ref={promptInputRef}
          value={prompt}
        />
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          className="inline-flex items-center gap-2 rounded-md border border-primary/30 bg-primary/15 px-3 py-2 text-xs font-semibold text-text-primary disabled:border-white/10 disabled:bg-white/5 disabled:text-text-secondary"
          data-testid="agent-live-prompt-run"
          data-native-accessibility-input="reads-textarea-dom-value"
          disabled={!canRun}
          onMouseDown={(event) => {
            event.preventDefault();
            void runDryRun();
          }}
          onClick={() => {
            void runDryRun();
          }}
          type="button"
        >
          <Send size={14} />
          {t('editor.ai.agent.composer.dryRun')}
        </button>
        <button
          className="inline-flex items-center gap-2 rounded-md border border-white/15 bg-white/5 px-3 py-2 text-xs font-semibold text-text-primary disabled:border-white/10 disabled:bg-white/5 disabled:text-text-secondary"
          data-testid="agent-live-prompt-inspect-state"
          disabled={!canInspectState}
          onMouseDown={(event) => {
            event.preventDefault();
            inspectState();
          }}
          onClick={inspectState}
          type="button"
        >
          <Server size={14} />
          {t('editor.ai.agent.composer.inspectState')}
        </button>
        <button
          className="inline-flex items-center gap-2 rounded-md border border-violet-500/30 bg-violet-500/10 px-3 py-2 text-xs font-semibold text-violet-100 disabled:border-white/10 disabled:bg-white/5 disabled:text-text-secondary"
          data-testid="agent-live-prompt-detail-preview"
          disabled={!canRequestDetailPreview}
          onMouseDown={(event) => {
            event.preventDefault();
            requestDetailPreview();
          }}
          onClick={requestDetailPreview}
          type="button"
        >
          <CircleDashed size={14} />
          {t('editor.ai.agent.composer.detailPreview')}
        </button>
        <button
          className="inline-flex items-center gap-2 rounded-md border border-sky-500/30 bg-sky-500/10 px-3 py-2 text-xs font-semibold text-sky-100 disabled:border-white/10 disabled:bg-white/5 disabled:text-text-secondary"
          data-testid="agent-live-prompt-refresh-preview"
          disabled={!canRefreshPreview}
          onMouseDown={(event) => {
            event.preventDefault();
            refreshPreview();
          }}
          onClick={refreshPreview}
          type="button"
        >
          <Eye size={14} />
          {t('editor.ai.agent.composer.refreshPreview')}
        </button>
        <button
          className="rounded-md border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs font-semibold text-emerald-100 disabled:border-white/10 disabled:bg-white/5 disabled:text-text-secondary"
          data-disabled-reason={
            result.status === 'blocked' || result.status === 'approval_required'
              ? (result.safetyDecision?.decisionId ?? result.status)
              : ''
          }
          data-testid="agent-live-prompt-apply"
          disabled={!canApply}
          onMouseDown={(event) => {
            event.preventDefault();
            void applyDryRun();
          }}
          onClick={() => {
            void applyDryRun();
          }}
          type="button"
        >
          {result.status === 'applying' ? t('editor.ai.agent.composer.applying') : t('editor.ai.agent.composer.apply')}
        </button>
        <button
          className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs font-semibold text-red-100 disabled:border-white/10 disabled:bg-white/5 disabled:text-text-secondary"
          data-cancel-boundary="late-result-guard"
          data-testid="agent-live-prompt-cancel"
          disabled={!canCancel}
          onMouseDown={(event) => {
            event.preventDefault();
            cancelActiveOperation();
          }}
          onClick={cancelActiveOperation}
          type="button"
        >
          {t('editor.ai.agent.composer.cancel')}
        </button>
        <button
          className="inline-flex items-center gap-2 rounded-md border border-sky-500/30 bg-sky-500/10 px-3 py-2 text-xs font-semibold text-sky-100 disabled:border-white/10 disabled:bg-white/5 disabled:text-text-secondary"
          data-dispatch-path={AGENT_CURRENT_IMAGE_PREVIEW_LOOP_TOOL_NAME}
          data-testid="agent-live-selected-image-preview-loop"
          disabled={!canRunSelectedImageLoop}
          onMouseDown={(event) => {
            event.preventDefault();
            void runSelectedImagePreviewLoopFromPanel();
          }}
          onClick={() => {
            void runSelectedImagePreviewLoopFromPanel();
          }}
          type="button"
        >
          <Eye size={14} />
          {t('editor.ai.agent.selectedImageLoop.run')}
        </button>
        <button
          className="inline-flex items-center gap-2 rounded-md border border-teal-500/30 bg-teal-500/10 px-3 py-2 text-xs font-semibold text-teal-100 disabled:border-white/10 disabled:bg-white/5 disabled:text-text-secondary"
          data-testid="agent-live-prompt-export-proof"
          disabled={!canRequestExportProof}
          onMouseDown={(event) => {
            event.preventDefault();
            void requestExportProof();
          }}
          onClick={() => {
            void requestExportProof();
          }}
          type="button"
        >
          <FileCheck2 size={14} />
          {t('editor.ai.agent.composer.exportProof')}
        </button>
        <button
          className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs font-semibold text-amber-100 disabled:border-white/10 disabled:bg-white/5 disabled:text-text-secondary"
          data-policy-state={result.status}
          data-testid="agent-live-prompt-approve-policy"
          disabled={result.status !== 'approval_required'}
          onMouseDown={(event) => {
            event.preventDefault();
            approveSafetyGate();
          }}
          onClick={approveSafetyGate}
          type="button"
        >
          {t('editor.ai.agent.composer.policy.approve')}
        </button>
        <button
          className="inline-flex items-center gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs font-semibold text-amber-100 disabled:border-white/10 disabled:bg-white/5 disabled:text-text-secondary"
          data-discard-control="rollback-session"
          data-testid="agent-live-prompt-rollback"
          disabled={!canRollback}
          onMouseDown={(event) => {
            event.preventDefault();
            rollbackApply();
          }}
          onClick={rollbackApply}
          type="button"
        >
          <RotateCcw size={14} />
          {t('editor.ai.agent.composer.rollback')}
        </button>
      </div>

      <LiveActivityTimeline entries={activityEntries} />
      <LiveSessionReviewPanel review={effectiveSessionReview} />
      <LiveAuditArtifactPanel artifact={auditArtifact} />
      {selectedImageLoopReview === null ? null : (
        <SelectedImagePreviewLoopReviewPanel review={selectedImageLoopReview} />
      )}

      <div
        className="rounded border border-white/10 bg-black/15 p-2 text-[11px]"
        data-applied-graph-revision={result.appliedGraphRevision ?? ''}
        data-changed-pixel-count={result.changedPixelCount?.toString() ?? ''}
        data-changed-pixel-percent={result.changedPixelPercent?.toString() ?? ''}
        data-max-channel-delta={result.maxChannelDelta?.toString() ?? ''}
        data-mean-luminance-delta={result.meanLuminanceDelta?.toString() ?? ''}
        data-preview-after-hash={result.previewAfterHash ?? ''}
        data-preview-before-hash={result.previewBeforeHash ?? ''}
        data-preview-refresh-policy="native-renderer-handoff"
        data-sampled-pixel-count={result.sampledPixelCount?.toString() ?? ''}
        data-testid="agent-live-prompt-result"
      >
        <div className="flex items-center justify-between gap-2">
          <span className="font-semibold text-text-primary">{statusLabel}</span>
          {result.recipeName ? <span className="font-mono text-text-secondary">{result.recipeName}</span> : null}
        </div>
        {result.summary ? <p className="mt-1 leading-4 text-text-secondary">{result.summary}</p> : null}
        {result.previewStaleRecipeHash || result.stateStaleRecipeHash ? (
          <p
            className="mt-1 rounded border border-amber-500/25 bg-amber-500/10 px-2 py-1 text-[10px] font-semibold text-amber-100"
            data-preview-stale-recipe-hash={result.previewStaleRecipeHash ? 'true' : 'false'}
            data-state-stale-recipe-hash={result.stateStaleRecipeHash ? 'true' : 'false'}
            data-testid="agent-live-prompt-stale-preview-warning"
          >
            {t('editor.ai.agent.composer.stalePreviewWarning')}
          </p>
        ) : null}
        {result.stateGraphRevision ? (
          <div
            className="mt-1 space-y-1 font-mono text-[10px] text-text-secondary"
            data-state-adjustment-count={result.stateAdjustmentCount?.toString() ?? ''}
            data-state-graph-revision={result.stateGraphRevision}
            data-state-image-path={result.stateImagePath ?? ''}
            data-state-mask-count={result.stateMaskCount?.toString() ?? ''}
            data-state-metadata-count={result.stateMetadataCount?.toString() ?? ''}
            data-state-recipe-hash={result.stateRecipeHash ?? ''}
            data-state-stale-recipe-hash={result.stateStaleRecipeHash ? 'true' : 'false'}
            data-testid="agent-live-prompt-state-inspection"
          >
            <div className="truncate text-emerald-100">{result.stateGraphRevision}</div>
            <div className="truncate">{result.stateImagePath}</div>
          </div>
        ) : null}
        {result.status === 'applied' && result.appliedGraphRevision ? (
          <div
            className="mt-2 grid gap-1.5 rounded border border-emerald-500/25 bg-emerald-500/10 p-2 text-[10px]"
            data-applied-graph-revision={result.appliedGraphRevision}
            data-changed-pixel-count={result.changedPixelCount?.toString() ?? ''}
            data-final-recipe-hash={result.recipeName ?? ''}
            data-policy-decision-id={result.safetyDecision?.decisionId ?? ''}
            data-preview-after-hash={result.previewAfterHash ?? ''}
            data-preview-before-hash={result.previewBeforeHash ?? ''}
            data-sampled-pixel-count={result.sampledPixelCount?.toString() ?? ''}
            data-testid="agent-live-apply-receipt"
            data-tool-call-count={sessionReview?.toolCallCount.toString() ?? ''}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="font-semibold text-emerald-100">{t('editor.ai.agent.composer.applyReceipt')}</span>
              <span className="font-mono text-text-secondary">{sessionReview?.toolCallCount ?? 0}</span>
            </div>
            <div className="grid grid-cols-2 gap-1.5">
              <span className="truncate font-mono text-text-secondary">{result.appliedGraphRevision}</span>
              <span className="truncate font-mono text-text-secondary">{result.recipeName}</span>
              <span className="truncate font-mono text-sky-100">{result.previewBeforeHash}</span>
              <span className="truncate font-mono text-sky-100">{result.previewAfterHash}</span>
            </div>
            <div className="font-mono text-emerald-100">
              {t('editor.ai.agent.composer.applyReceiptPixels', {
                changed: result.changedPixelCount,
                percent: result.changedPixelPercent,
                sampled: result.sampledPixelCount,
              })}
            </div>
          </div>
        ) : null}
        {result.exportHash ? (
          <div
            className="mt-2 grid gap-1.5 rounded border border-teal-500/25 bg-teal-500/10 p-2 text-[10px]"
            data-export-hash={result.exportHash}
            data-export-height={result.exportHeight?.toString() ?? ''}
            data-export-preview-ref={result.exportPreviewRef ?? ''}
            data-export-receipt-graph-revision={result.exportReceiptGraphRevision ?? ''}
            data-export-receipt-preview-hash={result.exportReceiptPreviewHash ?? ''}
            data-export-width={result.exportWidth?.toString() ?? ''}
            data-testid="agent-live-export-proof-receipt"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="font-semibold text-teal-100">{t('editor.ai.agent.composer.exportProofReceipt')}</span>
              <span className="font-mono text-text-secondary">
                {t('editor.ai.agent.composer.exportProofWidth', { width: result.exportWidth })}
              </span>
            </div>
            <div className="truncate font-mono text-teal-100">{result.exportHash}</div>
            <div className="truncate font-mono text-text-secondary">{result.exportPreviewRef}</div>
          </div>
        ) : null}
        {rollbackSnapshot !== null && rollbackValidation !== null && result.status === 'applied' ? (
          <div
            className="mt-2 rounded border border-amber-500/25 bg-amber-500/10 p-2 text-[10px] text-amber-100"
            data-current-graph-revision={rollbackValidation.currentGraphRevision}
            data-current-image-path={rollbackValidation.currentImagePath}
            data-current-recipe-hash={rollbackValidation.currentRecipeHash}
            data-invalidated-reason={rollbackValidation.reason ?? ''}
            data-rollback-graph-revision={rollbackSnapshot.graphRevision}
            data-rollback-image-path={rollbackSnapshot.activeImagePath}
            data-rollback-recipe-hash={rollbackSnapshot.recipeHash}
            data-rollback-state={rollbackValidation.state}
            data-testid="agent-live-rollback-receipt"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="font-semibold">{t('editor.ai.agent.composer.rollbackReceipt')}</span>
              <span className="font-mono">{rollbackValidation.state}</span>
            </div>
            <p className="mt-1">
              {rollbackValidation.state === 'available'
                ? t('editor.ai.agent.composer.rollbackAvailable')
                : t('editor.ai.agent.composer.rollbackInvalidated')}
            </p>
          </div>
        ) : null}
        {result.safetyDecision ? (
          <div
            className={`mt-2 rounded border p-2 ${
              result.safetyDecision.blocked
                ? 'border-red-500/25 bg-red-500/10 text-red-100'
                : 'border-amber-500/25 bg-amber-500/10 text-amber-100'
            }`}
            data-approval-required={result.safetyDecision.approvalRequired ? 'true' : 'false'}
            data-blocked={result.safetyDecision.blocked ? 'true' : 'false'}
            data-policy-id={result.safetyDecision.decisionId}
            data-policy-severity={result.safetyDecision.severity}
            data-testid="agent-live-prompt-safety-policy"
          >
            <span className="font-semibold">{t('editor.ai.agent.composer.policy.title')}</span>
            <p className="mt-1 leading-4">{result.safetyDecision.reason}</p>
            <p className="mt-1 font-mono text-[10px] opacity-80">{result.safetyDecision.decisionId}</p>
          </div>
        ) : null}
        {result.previewAfterHash ? (
          <div className="mt-1 font-mono text-[10px] text-text-secondary">
            {result.previewBeforeHash} → {result.previewAfterHash}
          </div>
        ) : null}
        {result.appliedGraphRevision && result.changedPixelCount !== undefined ? (
          <div className="mt-1 font-mono text-[10px] text-emerald-100">
            {result.appliedGraphRevision} ·{' '}
            {t('editor.ai.agent.composer.previewDelta', {
              changed: result.changedPixelCount,
              maxDelta: result.maxChannelDelta,
              meanLuma: result.meanLuminanceDelta,
              percent: result.changedPixelPercent,
              sampled: result.sampledPixelCount,
            })}
          </div>
        ) : null}
        {result.appliedGraphRevision && result.changedPixelCount === undefined ? (
          <div className="mt-1 font-mono text-[10px] text-emerald-100">{result.appliedGraphRevision}</div>
        ) : null}
        {result.error ? <p className="mt-1 leading-4 text-red-100">{result.error}</p> : null}
      </div>
    </form>
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

      <div className="grid gap-2 text-[11px] md:grid-cols-2" data-testid="agent-replay-gallery">
        {review.replayGallery.map((entry) => (
          <a
            className="rounded border border-white/10 bg-black/15 p-2 hover:border-primary/50"
            data-artifact-id={entry.artifactId}
            data-gallery-role={entry.role}
            data-tool-call-id={entry.toolCallId}
            href={entry.href}
            key={entry.id}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="font-semibold text-text-primary">{entry.label}</span>
              <span className="rounded border border-white/10 bg-white/5 px-1.5 py-0.5 uppercase text-text-secondary">
                {entry.role}
              </span>
            </div>
            <div className="mt-1 truncate font-mono text-text-secondary">{entry.artifactId}</div>
          </a>
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

function AgentProposedEditCard({
  artifactReview,
  auditTranscript,
  dryRunReview,
  reviewHandoff,
  runtimeStatus,
  selectedFrameScope,
  selectedImagePreviewLoopReview,
}: {
  artifactReview: AgentArtifactReview | undefined;
  auditTranscript: AgentAuditTranscript | undefined;
  dryRunReview: AgentChatDryRunReview | undefined;
  reviewHandoff: AgentReviewHandoff | undefined;
  runtimeStatus: AgentChatTranscript['runtimeStatus'];
  selectedFrameScope: AgentSelectedFrameScope | undefined;
  selectedImagePreviewLoopReview: AgentSelectedImagePreviewLoopReview | undefined;
}) {
  const { t } = useTranslation();
  const [proposalState, setProposalState] = useState<AgentProposalReviewState>(
    reviewHandoff?.approvalState === 'approved' ? 'applied' : 'approval_required',
  );
  const [rollbackState, setRollbackState] = useState<'available' | 'restored'>('available');
  const previewArtifact =
    artifactReview?.previewArtifacts.find((artifact) => artifact.status === 'ready') ??
    artifactReview?.previewArtifacts[0];
  const beforeArtifact =
    artifactReview?.previewArtifacts.find((artifact) => artifact.title.toLowerCase().includes('before')) ??
    artifactReview?.previewArtifacts[1] ??
    previewArtifact;
  const afterArtifact =
    artifactReview?.previewArtifacts.find(
      (artifact) => artifact.title.toLowerCase().includes('after') || artifact.id === reviewHandoff?.afterArtifactId,
    ) ??
    artifactReview?.previewArtifacts[2] ??
    previewArtifact;
  const approvalAction = dryRunReview?.actions.find((action) => action.id === 'approve-dry-run');
  const rejectAction = dryRunReview?.actions.find((action) => action.id === 'reject-plan');
  const applyAction = dryRunReview?.actions.find((action) => action.id === 'apply-approved');
  const canApprove = approvalAction?.state === 'available' && proposalState === 'approval_required';
  const canReject = rejectAction?.state === 'available' && proposalState !== 'applied' && proposalState !== 'rejected';
  const canApply =
    applyAction?.state === 'available' &&
    proposalState !== 'applied' &&
    proposalState !== 'applying' &&
    proposalState !== 'rejected';
  const canRollback =
    reviewHandoff?.rollback.status === 'available' && proposalState === 'applied' && rollbackState === 'available';
  const proposalStatusLabel =
    proposalState === 'applied'
      ? t('editor.ai.agent.proposal.status.applied')
      : proposalState === 'applying'
        ? t('editor.ai.agent.proposal.status.applying')
        : proposalState === 'failed'
          ? t('editor.ai.agent.proposal.status.failed')
          : proposalState === 'preview_ready'
            ? t('editor.ai.agent.proposal.status.previewReady')
            : proposalState === 'rejected'
              ? t('editor.ai.agent.proposal.status.rejected')
              : t('editor.ai.agent.proposal.status.approvalRequired');
  const proposalStatusClassName =
    proposalState === 'applied'
      ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-100'
      : proposalState === 'failed' || proposalState === 'rejected'
        ? 'border-red-500/30 bg-red-500/10 text-red-100'
        : proposalState === 'applying'
          ? 'border-sky-500/30 bg-sky-500/10 text-sky-100'
          : 'border-amber-500/30 bg-amber-500/10 text-amber-100';
  const mediumPreview = selectedImagePreviewLoopReview?.compareArtifacts.mediumPreview;
  const auditCount =
    (auditTranscript?.records.length ?? 0) +
    (reviewHandoff?.auditTrail.length ?? 0) +
    (artifactReview?.auditEntries.length ?? 0);

  return (
    <div
      className="space-y-3 rounded-md border border-sky-500/25 bg-editor-panel-well p-3 shadow-lg"
      data-agent-proposal-state={proposalState}
      data-after-artifact-id={afterArtifact?.id ?? reviewHandoff?.afterArtifactId ?? ''}
      data-audit-record-count={auditCount}
      data-before-artifact-id={beforeArtifact?.id ?? reviewHandoff?.beforeArtifactId ?? ''}
      data-medium-preview-artifact-id={mediumPreview?.artifactId ?? ''}
      data-medium-preview-content-hash={mediumPreview?.contentHash ?? ''}
      data-medium-preview-graph-revision={mediumPreview?.graphRevision ?? ''}
      data-medium-preview-height={mediumPreview?.dimensions.height ?? ''}
      data-medium-preview-long-edge={mediumPreview?.longEdgePx ?? ''}
      data-medium-preview-stale={mediumPreview?.staleRecipeHash ?? ''}
      data-medium-preview-width={mediumPreview?.dimensions.width ?? ''}
      data-testid="agent-proposed-edit-card"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-sm font-semibold text-text-primary">
            <Eye size={16} />
            <span>{reviewHandoff?.title ?? t('editor.ai.agent.proposal.title')}</span>
          </div>
          <p className="mt-1 text-[11px] leading-4 text-text-secondary">
            {reviewHandoff?.commandSummary ??
              selectedImagePreviewLoopReview?.title ??
              t('editor.ai.agent.proposal.summary')}
          </p>
        </div>
        <span className={`shrink-0 rounded border px-2 py-1 text-[11px] ${proposalStatusClassName}`}>
          {proposalStatusLabel}
        </span>
      </div>

      <div
        className="grid gap-2 sm:grid-cols-2"
        data-preview-artifact-id={previewArtifact?.id ?? ''}
        data-testid="agent-proposal-medium-preview"
      >
        <div
          className="min-h-28 overflow-hidden rounded-md border border-white/10 p-2"
          style={{ background: 'linear-gradient(135deg, #1c2b32, #53605e 52%, #ba9863)' }}
        >
          <span className="rounded bg-black/45 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-text-primary">
            {artifactReview?.beforeAfter.beforeLabel ??
              reviewHandoff?.beforeLabel ??
              t('editor.ai.agent.selectedImageLoop.before')}
          </span>
          <div className="mt-14 truncate font-mono text-[10px] text-text-primary">
            {artifactReview?.beforeAfter.beforeRevision ??
              reviewHandoff?.beforeArtifactId ??
              beforeArtifact?.contentHash}
          </div>
        </div>
        <div
          className="min-h-28 overflow-hidden rounded-md border border-sky-500/30 p-2"
          style={{
            background: 'linear-gradient(135deg, #2c3f44, #777163 52%, #f0ca7b)',
            boxShadow: 'inset 0 0 0 1px rgba(125,211,252,0.12)',
          }}
        >
          <span className="rounded bg-black/45 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-text-primary">
            {artifactReview?.beforeAfter.afterLabel ?? reviewHandoff?.afterLabel ?? t('editor.ai.agent.proposal.after')}
          </span>
          <div className="mt-14 truncate font-mono text-[10px] text-text-primary">
            {artifactReview?.beforeAfter.afterRevision ?? reviewHandoff?.afterArtifactId ?? afterArtifact?.contentHash}
          </div>
        </div>
      </div>

      {mediumPreview ? (
        <div
          className="grid grid-cols-3 gap-2 rounded border border-white/10 bg-black/15 p-2 text-[11px]"
          data-testid="agent-proposal-preview-quality"
        >
          <div>
            <div className="text-[10px] uppercase text-text-secondary">
              {t('editor.ai.agent.proposal.mediumPreview')}
            </div>
            <div className="mt-1 font-mono text-text-primary">{mediumPreview.longEdgePx}px</div>
          </div>
          <div>
            <div className="text-[10px] uppercase text-text-secondary">{t('editor.ai.agent.proposal.quality')}</div>
            <div className="mt-1 font-mono text-text-primary">{mediumPreview.quality}</div>
          </div>
          <div>
            <div className="text-[10px] uppercase text-text-secondary">{t('editor.ai.agent.proposal.pixels')}</div>
            <div className="mt-1 font-mono text-text-primary">{mediumPreview.maxPixelCount}</div>
          </div>
        </div>
      ) : null}

      <div className="grid grid-cols-4 gap-2" data-testid="agent-proposal-actions">
        <button
          className="rounded-md border border-sky-500/30 bg-sky-500/10 px-2 py-2 text-left text-[11px] font-semibold text-sky-100 disabled:border-white/10 disabled:bg-white/5 disabled:text-text-secondary"
          data-testid="agent-proposal-preview-action"
          onClick={() => {
            setProposalState('preview_ready');
          }}
          type="button"
        >
          {t('editor.ai.agent.proposal.previewAction')}
        </button>
        <button
          className="rounded-md border border-emerald-500/30 bg-emerald-500/10 px-2 py-2 text-left text-[11px] font-semibold text-emerald-100 disabled:border-white/10 disabled:bg-white/5 disabled:text-text-secondary"
          data-runtime-status={runtimeStatus}
          data-testid="agent-proposal-apply-action"
          disabled={!canApply}
          onClick={() => {
            setProposalState('applying');
            window.setTimeout(() => {
              setProposalState('applied');
            }, 80);
          }}
          type="button"
        >
          {t('editor.ai.agent.proposal.applyAction')}
        </button>
        <button
          className="rounded-md border border-red-500/30 bg-red-500/10 px-2 py-2 text-left text-[11px] font-semibold text-red-100 disabled:border-white/10 disabled:bg-white/5 disabled:text-text-secondary"
          data-testid="agent-proposal-reject-action"
          disabled={!canReject}
          onClick={() => {
            setProposalState('rejected');
          }}
          type="button"
        >
          {t('editor.ai.agent.proposal.rejectAction')}
        </button>
        <button
          className="inline-flex items-center gap-1.5 rounded-md border border-amber-500/30 bg-amber-500/10 px-2 py-2 text-left text-[11px] font-semibold text-amber-100 disabled:border-white/10 disabled:bg-white/5 disabled:text-text-secondary"
          data-testid="agent-proposal-rollback-action"
          disabled={!canRollback}
          onClick={() => {
            setRollbackState('restored');
            setProposalState('preview_ready');
          }}
          type="button"
        >
          <RotateCcw size={13} />
          {t('editor.ai.agent.proposal.rollbackAction')}
        </button>
      </div>

      {canApprove ? (
        <button
          className="w-full rounded-md border border-amber-500/30 bg-amber-500/10 px-2 py-2 text-left text-[11px] font-semibold text-amber-100"
          data-testid="agent-proposal-approve-action"
          onClick={() => {
            setProposalState('preview_ready');
          }}
          type="button"
        >
          {approvalAction?.label ?? t('editor.ai.agent.proposal.approveAction')}
        </button>
      ) : null}

      {dryRunReview ? (
        <div className="space-y-2" data-testid="agent-proposal-affected-controls">
          <div className="text-[11px] font-semibold uppercase text-text-secondary">
            {t('editor.ai.agent.proposal.affectedControls')}
          </div>
          <div className="grid gap-2 sm:grid-cols-3">
            {dryRunReview.affectedTargets.map((target) => (
              <div className="rounded border border-white/10 bg-black/15 p-2 text-[11px]" key={target.id}>
                <div className="text-[10px] uppercase text-text-secondary">{target.label}</div>
                <div className="mt-1 truncate text-text-primary">{target.value}</div>
              </div>
            ))}
          </div>
          <div className="space-y-1">
            {dryRunReview.parameterDiffs.map((diff) => (
              <div
                className="grid grid-cols-[1fr_auto_auto] gap-2 rounded border border-white/10 bg-black/15 px-2 py-1.5 text-[11px]"
                key={diff.id}
              >
                <span className="truncate text-text-primary">{diff.label}</span>
                <span className="font-mono text-text-secondary">{diff.before}</span>
                <span className="font-mono text-sky-100">{diff.after}</span>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      <div className="grid gap-2 text-[11px] sm:grid-cols-2" data-testid="agent-proposal-proof-artifacts">
        {artifactReview?.previewArtifacts.slice(0, 4).map((artifact) => (
          <div className="rounded border border-white/10 bg-black/15 p-2" key={artifact.id}>
            <div className="flex items-center justify-between gap-2">
              <span className="truncate font-semibold text-text-primary">{artifact.title}</span>
              <span className={`rounded border px-1.5 py-0.5 ${artifactStatusStyles[artifact.status]}`}>
                {artifact.status}
              </span>
            </div>
            <div className="mt-1 truncate font-mono text-text-secondary">{artifact.contentHash}</div>
          </div>
        ))}
        {reviewHandoff?.outputProof ? (
          <a
            className="rounded border border-teal-500/25 bg-teal-500/10 p-2 text-teal-100 hover:border-teal-300/70"
            href={reviewHandoff.outputProof.href}
          >
            <span className="block font-semibold text-text-primary">{reviewHandoff.outputProof.label}</span>
            <span className="mt-1 block truncate font-mono text-text-secondary">
              {reviewHandoff.outputProof.contentHash}
            </span>
          </a>
        ) : null}
      </div>

      {selectedFrameScope ? <SelectedFrameScopePanel scope={selectedFrameScope} /> : null}

      {selectedImagePreviewLoopReview ? (
        <SelectedImagePreviewLoopReviewPanel review={selectedImagePreviewLoopReview} />
      ) : null}

      <div
        className="max-h-80 overflow-hidden rounded-md border border-white/10 bg-black/15 p-2"
        data-testid="agent-proposal-audit-detail"
      >
        <div className="text-[11px] font-semibold text-text-primary">
          {t('editor.ai.agent.proposal.collapsedAuditDetail', { count: auditCount })}
        </div>
        <div className="mt-2 space-y-2">
          {dryRunReview ? <DryRunReviewPanel review={dryRunReview} runtimeStatus={runtimeStatus} /> : null}
          {artifactReview ? <ArtifactReviewPanel review={artifactReview} /> : null}
          {reviewHandoff ? <ReviewHandoffPanel handoff={reviewHandoff} /> : null}
          {auditTranscript ? <AuditTranscriptViewer auditTranscript={auditTranscript} /> : null}
        </div>
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

function InitialPromptPreviewContextCard({ context }: { context: AgentInitialPromptPreviewContext }) {
  const { t } = useTranslation();

  return (
    <div
      className="rounded-md border border-sky-500/25 bg-sky-500/10 p-3"
      data-access-scope={context.accessScope}
      data-artifact-id={context.artifactId}
      data-color-profile={context.colorProfile}
      data-encoded-format={context.encodedFormat}
      data-graph-revision={context.graphRevision}
      data-height={context.height}
      data-includes-original-raw={String(context.includesOriginalRaw)}
      data-long-edge-px={context.longEdgePx}
      data-media-type={context.mediaType}
      data-preview-ref={context.previewRef}
      data-purpose={context.purpose}
      data-quality={context.quality}
      data-recipe-hash={context.recipeHash}
      data-render-hash={context.renderHash}
      data-testid="agent-initial-prompt-preview-context"
      data-tool-name={context.toolName}
      data-transport={context.transport}
      data-width={context.width}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-xs font-semibold text-text-primary">
            {t('editor.ai.agent.initialPreviewContext.title')}
          </div>
          <p className="mt-1 text-[11px] leading-4 text-text-secondary">
            {t('editor.ai.agent.initialPreviewContext.summary', {
              format: context.encodedFormat.toUpperCase(),
              height: context.height,
              longEdge: context.longEdgePx,
              width: context.width,
            })}
          </p>
        </div>
        <span className="shrink-0 rounded border border-sky-500/30 bg-sky-500/10 px-2 py-0.5 text-[11px] text-sky-100">
          {context.purpose}
        </span>
      </div>
      <div className="mt-2 grid grid-cols-2 gap-2 text-[10px] text-text-secondary">
        <div className="min-w-0">
          <div className="uppercase text-text-tertiary">{t('editor.ai.agent.previewLineage.meta.artifact')}</div>
          <div className="truncate font-mono text-text-primary">{context.artifactId}</div>
        </div>
        <div className="min-w-0">
          <div className="uppercase text-text-tertiary">{t('editor.ai.agent.previewLineage.meta.recipeHash')}</div>
          <div className="truncate font-mono text-text-secondary">{context.recipeHash}</div>
        </div>
        <div className="min-w-0">
          <div className="uppercase text-text-tertiary">{t('editor.ai.agent.previewLineage.meta.renderHash')}</div>
          <div className="truncate font-mono text-text-secondary">{context.renderHash}</div>
        </div>
      </div>
      <div className="mt-2">
        <div className="h-20 w-20 overflow-hidden rounded border border-white/10 bg-black/20">
          <img
            alt={t('editor.ai.agent.initialPreviewContext.title')}
            className="h-full w-full object-cover"
            src={context.previewRef}
          />
        </div>
      </div>
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

function FailureRecoveryPanel({ recovery }: { recovery: AgentFailureRecovery }) {
  const [retryState, setRetryState] = useState<'available' | 'completed'>(recovery.retryAction.state);

  return (
    <div
      className="space-y-3 rounded-md border border-amber-500/20 bg-amber-500/5 p-3"
      data-failed-tool-call-id={recovery.failedToolCallId}
      data-preserved-plan-id={recovery.preservedPlanId}
      data-recovered-tool-call-id={recovery.recoveredToolCallId}
      data-retry-state={retryState}
      data-testid="agent-failure-recovery"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-xs font-semibold text-text-primary">{recovery.title}</div>
          <p className="mt-1 text-[11px] leading-4 text-text-secondary">{recovery.reason}</p>
        </div>
        <span className="shrink-0 rounded border border-amber-500/25 bg-amber-500/10 px-2 py-0.5 text-[11px] text-amber-100">
          {recovery.failedToolCallId}
        </span>
      </div>

      <div className="grid gap-2 text-[11px] md:grid-cols-2">
        <button
          className="rounded-md border border-emerald-500/25 bg-emerald-500/10 px-2 py-2 text-left text-emerald-100 disabled:border-white/10 disabled:bg-white/5 disabled:text-text-secondary"
          data-testid="agent-failure-recovery-retry"
          disabled={retryState === 'completed'}
          onClick={() => {
            setRetryState('completed');
          }}
          type="button"
        >
          <span className="block font-semibold text-text-primary">{recovery.retryAction.label}</span>
          <span className="mt-1 block font-mono">{recovery.recoveredToolCallId}</span>
        </button>
        <div
          className="rounded-md border border-white/10 bg-black/15 px-2 py-2"
          data-testid="agent-failure-recovery-edit"
        >
          <span className="block font-semibold text-text-primary">{recovery.editAction.label}</span>
          <span className="mt-1 block font-mono text-text-secondary">{recovery.preservedPlanId}</span>
        </div>
      </div>
    </div>
  );
}

function E2eClosurePanel({ closure }: { closure: AgentE2eClosure }) {
  const { t } = useTranslation();

  return (
    <div
      className="space-y-3 rounded-md border border-emerald-500/20 bg-emerald-500/5 p-3"
      data-step-count={closure.steps.length}
      data-testid="agent-e2e-closure"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-xs font-semibold text-text-primary">{closure.title}</div>
          <a className="mt-1 block truncate text-[11px] text-sky-100 hover:underline" href={closure.proofHref}>
            {closure.proofLabel}
          </a>
        </div>
        <span className="shrink-0 rounded border border-emerald-500/25 bg-emerald-500/10 px-2 py-0.5 text-[11px] text-emerald-100">
          {t('editor.ai.agent.e2e.verified')}
        </span>
      </div>

      <div className="grid gap-2 text-[11px]" data-testid="agent-e2e-closure-steps">
        {closure.steps.map((step) => (
          <div
            className="rounded border border-white/10 bg-black/15 p-2"
            data-closure-status={step.status}
            data-testid={`agent-e2e-closure-step-${step.id}`}
            key={step.id}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="font-semibold text-text-primary">{step.label}</span>
              <span className="rounded border border-emerald-500/25 bg-emerald-500/10 px-1.5 py-0.5 text-emerald-100">
                {step.status}
              </span>
            </div>
            <p className="mt-1 leading-4 text-text-secondary">{step.summary}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

function LongEditProgressPanel({ progress }: { progress: AgentLongEditProgress }) {
  const { t } = useTranslation();
  const completedPercent = Math.round((progress.completedStageCount / progress.stages.length) * 100);

  return (
    <div
      className="space-y-3 rounded-md border border-sky-500/20 bg-sky-500/5 p-3"
      data-completed-percent={completedPercent}
      data-completed-stage-count={progress.completedStageCount}
      data-estimated-total-ms={progress.estimatedTotalMs}
      data-stage-count={progress.stages.length}
      data-testid="agent-long-edit-progress"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-xs font-semibold text-text-primary">{progress.title}</div>
          <p className="mt-1 text-[11px] leading-4 text-text-secondary">
            {t('editor.ai.agent.progress.stagesComplete', {
              completed: progress.completedStageCount,
              total: progress.stages.length,
            })}
          </p>
        </div>
        <span className="shrink-0 rounded border border-sky-500/25 bg-sky-500/10 px-2 py-0.5 text-[11px] text-sky-100">
          {completedPercent}%
        </span>
      </div>

      <div className="h-1.5 overflow-hidden rounded bg-white/10" data-testid="agent-long-edit-progress-bar">
        <div className="h-full bg-sky-300" style={{ width: `${completedPercent}%` }} />
      </div>

      <div className="grid gap-2 text-[11px]" data-testid="agent-long-edit-progress-stages">
        {progress.stages.map((stage) => (
          <div
            className="rounded border border-white/10 bg-black/15 p-2"
            data-duration-ms={stage.durationMs}
            data-stage-state={stage.state}
            key={stage.id}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="font-semibold text-text-primary">{stage.label}</span>
              <span className={`rounded border px-1.5 py-0.5 ${longEditProgressStageStyles[stage.state]}`}>
                {stage.state}
              </span>
            </div>
            <p className="mt-1 leading-4 text-text-secondary">{stage.summary}</p>
            <div className="mt-1 flex justify-between gap-2 font-mono text-[10px] text-text-secondary">
              <span>{stage.toolCallId ?? t('editor.ai.agent.progress.local')}</span>
              <span>{t('editor.ai.agent.progress.durationMs', { duration: stage.durationMs })}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function AgentChatShell({ transcript }: AgentChatShellProps) {
  const { t } = useTranslation();
  const [livePromptResult, setLivePromptResult] = useState<LivePromptResult>({ status: 'idle' });
  const [liveSessionEvents, setLiveSessionEvents] = useState<LiveSessionEvent[]>([]);
  const runtimeBadge = agentRuntimeBadge[transcript.runtimeStatus];
  const isContextReady = transcript.toolCalls.some(
    (toolCall) => toolCall.toolName === 'rawengine.live_context' && toolCall.status === 'succeeded',
  );
  const hasLiveApplyProof = livePromptResult.status === 'applied';
  const hasReviewProposal =
    transcript.dryRunReview !== undefined ||
    transcript.artifactReview !== undefined ||
    transcript.reviewHandoff !== undefined ||
    transcript.selectedImagePreviewLoopReview !== undefined;
  const liveApplyToolCall =
    hasLiveApplyProof && livePromptResult.appliedGraphRevision
      ? ({
          approvalState: 'not_required',
          id: 'live-agent-basic-tone-apply',
          mode: 'apply',
          provenance: {
            requestHash: `sha256:${(livePromptResult.previewAfterHash ?? 'liveapplyproof00').padEnd(16, '0')}`,
            runtime: 'codex_app_server',
            schema: 'rawengine.agent.live_basic_tone_apply.v1',
          },
          status: 'succeeded',
          summary: `${livePromptResult.appliedGraphRevision} · ${t('editor.ai.agent.composer.previewDelta', {
            changed: livePromptResult.changedPixelCount,
            maxDelta: livePromptResult.maxChannelDelta,
            meanLuma: livePromptResult.meanLuminanceDelta,
            percent: livePromptResult.changedPixelPercent,
            sampled: livePromptResult.sampledPixelCount,
          })}`,
          timestamp: 'SYSTEM NOW',
          title: livePromptResult.recipeName ?? t('editor.ai.agent.composer.status.applied'),
          toolName: 'rawengine.live_basic_tone.apply',
        } satisfies AgentChatToolCall)
      : null;

  return (
    <section
      className="space-y-3 rounded-md border border-white/10 bg-card/40 p-3"
      data-agent-runtime-status={transcript.runtimeStatus}
      data-live-session-event-count={liveSessionEvents.length}
      data-live-session-state={isContextReady ? 'ready' : 'blocked'}
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

      <LivePromptComposer
        initialPromptPreviewContext={transcript.initialPromptPreviewContext}
        isContextReady={isContextReady}
        onResultChange={setLivePromptResult}
        onSessionEvent={(event) => {
          setLiveSessionEvents((events) => [...events, event]);
        }}
      />

      {transcript.initialPromptPreviewContext ? (
        <InitialPromptPreviewContextCard context={transcript.initialPromptPreviewContext} />
      ) : null}

      {hasReviewProposal ? (
        <AgentProposedEditCard
          artifactReview={transcript.artifactReview}
          auditTranscript={transcript.auditTranscript}
          dryRunReview={transcript.dryRunReview}
          reviewHandoff={transcript.reviewHandoff}
          runtimeStatus={transcript.runtimeStatus}
          selectedFrameScope={transcript.selectedFrameScope}
          selectedImagePreviewLoopReview={transcript.selectedImagePreviewLoopReview}
        />
      ) : null}

      <div className="space-y-2" data-testid="agent-chat-messages">
        {liveSessionEvents.map((message) => (
          <MessageBubble key={message.id} message={message} />
        ))}
        {transcript.messages.map((message) => (
          <MessageBubble key={message.id} message={message} />
        ))}
      </div>

      <AppServerToolReadinessSummary />

      {transcript.livePromptWalkthrough ? (
        <LivePromptWalkthroughPanel walkthrough={transcript.livePromptWalkthrough} />
      ) : null}

      {transcript.e2eClosure ? <E2eClosurePanel closure={transcript.e2eClosure} /> : null}

      {transcript.failureRecovery ? <FailureRecoveryPanel recovery={transcript.failureRecovery} /> : null}

      {transcript.longEditProgress ? <LongEditProgressPanel progress={transcript.longEditProgress} /> : null}

      <div className="space-y-2" data-testid="agent-tool-transcript">
        <div className="flex items-center justify-between text-xs">
          <span className="font-semibold text-text-primary">{t('editor.ai.agent.transcript')}</span>
          <span className="text-text-secondary">
            {hasLiveApplyProof || transcript.runtimeStatus === 'runtime_apply_demo'
              ? t('editor.ai.agent.runtimeApplyProof')
              : t('editor.ai.agent.noAppliedEdits')}
          </span>
        </div>
        {liveApplyToolCall ? <ToolCallRow toolCall={liveApplyToolCall} /> : null}
        {transcript.toolCalls.map((toolCall) => (
          <ToolCallRow key={toolCall.id} toolCall={toolCall} />
        ))}
      </div>

      {transcript.privateRawArtifacts ? <PrivateRawArtifactsPanel proof={transcript.privateRawArtifacts} /> : null}
    </section>
  );
}
