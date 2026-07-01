import { z } from 'zod';
import type { RawEngineAppServerToolDispatchRequest } from '../../../schemas/agent/agentRuntimeSchemas';
import { buildAgentImageContextSnapshot } from '../context/agentImageContextSnapshot';
import {
  AGENT_PREVIEW_RENDER_TOOL_NAME,
  agentPreviewRenderResponseSchema,
} from '../context/agentReadOnlyAppServerTools';
import {
  AGENT_ADJUSTMENTS_APPLY_TOOL_NAME,
  AGENT_ADJUSTMENTS_DRY_RUN_TOOL_NAME,
  type AgentAdjustmentsApplyRequest,
  type AgentAdjustmentsApplyResponse,
  type AgentAdjustmentsDryRunResponse,
  agentAdjustmentsApplyResponseSchema,
  agentAdjustmentsDryRunResponseSchema,
} from '../tools/agentAdjustmentApplyTool';
import { dispatchAgentLiveEditorTool } from './agentLiveToolDispatch';
import {
  AGENT_HISTORY_ROLLBACK_TOOL_NAME,
  type AgentSessionCheckpoint,
  agentHistoryRollbackResponseSchema,
  createAgentSessionCheckpoint,
} from './agentSessionHistory';

export type AgentSelectedImageLiveSessionState =
  | 'idle'
  | 'dry_run_ready'
  | 'approval_required'
  | 'applying'
  | 'cancelling'
  | 'applied'
  | 'rolled_back'
  | 'failed';

export type AgentSelectedImageLiveSessionApprovalDecision = 'approved' | 'cancelled' | 'pending' | 'rejected';
export type AgentSelectedImageLiveSessionStaleReason =
  | 'graph_revision_changed'
  | 'image_changed'
  | 'preview_artifact_changed'
  | 'preview_dimensions_changed'
  | 'preview_identity_changed'
  | 'recipe_hash_changed';
export type AgentSelectedImageLiveSessionCancellationOutcome =
  | 'cancelled_before_apply'
  | 'late_result_blocked'
  | 'not_cancelled';

const selectedImageLiveSessionSnapshotSchema = z
  .object({
    graphRevision: z.string().trim().min(1),
    previewArtifactId: z.string().trim().min(1),
    previewHeight: z.number().int().positive(),
    previewIdentity: z.string().trim().min(1).nullable(),
    previewRenderHash: z.string().trim().min(1),
    previewWidth: z.number().int().positive(),
    recipeHash: z.string().trim().min(1),
    selectedImagePath: z.string().trim().min(1),
  })
  .strict();

const selectedImageLiveSessionAuditEventSchema = z
  .object({
    approvalDecision: z.enum(['approved', 'cancelled', 'pending', 'rejected']).optional(),
    cancellationOutcome: z.enum(['cancelled_before_apply', 'late_result_blocked', 'not_cancelled']).optional(),
    graphRevision: z.string().trim().min(1).optional(),
    id: z.string().trim().min(1),
    message: z.string().trim().min(1),
    previewHash: z.string().trim().min(1).optional(),
    recipeHash: z.string().trim().min(1).optional(),
    state: z.enum([
      'idle',
      'dry_run_ready',
      'approval_required',
      'applying',
      'cancelling',
      'applied',
      'rolled_back',
      'failed',
    ]),
    staleReason: z
      .enum([
        'graph_revision_changed',
        'image_changed',
        'preview_artifact_changed',
        'preview_dimensions_changed',
        'preview_identity_changed',
        'recipe_hash_changed',
      ])
      .optional(),
    toolCallId: z.string().trim().min(1).optional(),
    toolName: z.string().trim().min(1).optional(),
  })
  .strict();

const selectedImageLiveSessionApplyGuardSchema = z
  .object({
    acceptedPreviewArtifactId: z.string().trim().min(1),
    currentGraphRevision: z.string().trim().min(1),
    currentPreviewArtifactId: z.string().trim().min(1),
    currentPreviewHeight: z.number().int().positive(),
    currentPreviewIdentity: z.string().trim().min(1).nullable(),
    currentPreviewWidth: z.number().int().positive(),
    currentRecipeHash: z.string().trim().min(1),
    currentSelectedImagePath: z.string().trim().min(1),
    expectedGraphRevision: z.string().trim().min(1),
    expectedPreviewArtifactId: z.string().trim().min(1),
    expectedPreviewHeight: z.number().int().positive(),
    expectedPreviewIdentity: z.string().trim().min(1).nullable(),
    expectedPreviewWidth: z.number().int().positive(),
    expectedRecipeHash: z.string().trim().min(1),
    expectedSelectedImagePath: z.string().trim().min(1),
    staleReason: z
      .enum([
        'graph_revision_changed',
        'image_changed',
        'preview_artifact_changed',
        'preview_dimensions_changed',
        'preview_identity_changed',
        'recipe_hash_changed',
      ])
      .optional(),
    status: z.enum(['passed', 'rejected']),
  })
  .strict();

const selectedImageLiveSessionTranscriptEntrySchema = z
  .object({
    acceptedPreviewArtifactId: z.string().trim().min(1).optional(),
    argumentsHash: z.string().trim().min(1).optional(),
    graphRevision: z.string().trim().min(1).optional(),
    id: z.string().trim().min(1),
    kind: z.enum(['apply_decision', 'approval', 'error', 'preview', 'rollback', 'tool_call', 'tool_result']),
    previewArtifactId: z.string().trim().min(1).optional(),
    recipeHash: z.string().trim().min(1).optional(),
    resultHash: z.string().trim().min(1).optional(),
    rollbackGraphRevision: z.string().trim().min(1).optional(),
    staleReason: z
      .enum([
        'graph_revision_changed',
        'image_changed',
        'preview_artifact_changed',
        'preview_dimensions_changed',
        'preview_identity_changed',
        'recipe_hash_changed',
      ])
      .optional(),
    status: z.enum(['blocked', 'cancelled', 'failed', 'pending', 'rejected', 'succeeded']),
    toolCallId: z.string().trim().min(1).optional(),
    toolName: z.string().trim().min(1).optional(),
  })
  .strict();

export const agentSelectedImageLiveSessionReceiptSchema = z
  .object({
    acceptedPreviewArtifactId: z.string().trim().min(1),
    afterPreviewHash: z.string().trim().min(1).optional(),
    approvalDecision: z.enum(['approved', 'cancelled', 'pending', 'rejected']),
    applyGuard: selectedImageLiveSessionApplyGuardSchema.optional(),
    beforePreviewHash: z.string().trim().min(1),
    cancellationOutcome: z.enum(['cancelled_before_apply', 'late_result_blocked', 'not_cancelled']),
    dryRunPlanHash: z.string().trim().min(1),
    dryRunPlanId: z.string().trim().min(1),
    finalGraphRevision: z.string().trim().min(1).optional(),
    finalRecipeHash: z.string().trim().min(1).optional(),
    initialGraphRevision: z.string().trim().min(1),
    initialRecipeHash: z.string().trim().min(1),
    operationId: z.string().trim().min(1),
    requestId: z.string().trim().min(1),
    rollbackGraphRevision: z.string().trim().min(1),
    rollbackReceiptGraphRevision: z.string().trim().min(1).optional(),
    selectedImagePath: z.string().trim().min(1),
    sessionId: z.string().trim().min(1),
    state: z.enum([
      'idle',
      'dry_run_ready',
      'approval_required',
      'applying',
      'cancelling',
      'applied',
      'rolled_back',
      'failed',
    ]),
    staleReason: z
      .enum([
        'graph_revision_changed',
        'image_changed',
        'preview_artifact_changed',
        'preview_dimensions_changed',
        'preview_identity_changed',
        'recipe_hash_changed',
      ])
      .optional(),
    toolCalls: z
      .array(
        z
          .object({
            id: z.string().trim().min(1),
            name: z.string().trim().min(1),
            status: z.enum(['blocked', 'cancelled', 'succeeded']),
          })
          .strict(),
      )
      .min(1),
  })
  .strict();

export const agentSelectedImageLiveSessionAuditRecordSchema = z
  .object({
    auditEvents: z.array(selectedImageLiveSessionAuditEventSchema).min(1),
    receipt: agentSelectedImageLiveSessionReceiptSchema,
    replayState: z.enum(['replayable']),
    schemaVersion: z.literal(1),
    transcript: z.array(selectedImageLiveSessionTranscriptEntrySchema).min(2),
  })
  .strict();

export type AgentSelectedImageLiveSessionAuditEvent = z.infer<typeof selectedImageLiveSessionAuditEventSchema>;
export type AgentSelectedImageLiveSessionAuditRecord = z.infer<typeof agentSelectedImageLiveSessionAuditRecordSchema>;
export type AgentSelectedImageLiveSessionApplyGuard = z.infer<typeof selectedImageLiveSessionApplyGuardSchema>;
export type AgentSelectedImageLiveSessionReceipt = z.infer<typeof agentSelectedImageLiveSessionReceiptSchema>;
export type AgentSelectedImageLiveSessionTranscriptEntry = z.infer<
  typeof selectedImageLiveSessionTranscriptEntrySchema
>;

export interface AgentSelectedImageLiveSessionDraft {
  adjustments: AgentAdjustmentsApplyRequest['adjustments'];
  auditEvents: AgentSelectedImageLiveSessionAuditEvent[];
  checkpoint: AgentSessionCheckpoint;
  dryRun: AgentAdjustmentsDryRunResponse;
  operationId: string;
  prompt: string;
  requestId: string;
  sessionId: string;
  snapshot: z.infer<typeof selectedImageLiveSessionSnapshotSchema>;
  state: AgentSelectedImageLiveSessionState;
}

export interface AgentSelectedImageLiveSessionApplyResult {
  apply: AgentAdjustmentsApplyResponse;
  audit: AgentSelectedImageLiveSessionAuditRecord;
  previewAfterHash: string;
  previewBeforeHash: string;
}

const buildSnapshot = (): z.infer<typeof selectedImageLiveSessionSnapshotSchema> => {
  const snapshot = buildAgentImageContextSnapshot();
  return selectedImageLiveSessionSnapshotSchema.parse({
    graphRevision: snapshot.graphRevision,
    previewArtifactId: snapshot.initialPreview.artifactId,
    previewHeight: snapshot.initialPreview.height,
    previewIdentity: snapshot.previewIdentity,
    previewRenderHash: snapshot.initialPreview.renderHash,
    previewWidth: snapshot.initialPreview.width,
    recipeHash: snapshot.initialPreview.recipeHash,
    selectedImagePath: snapshot.activeImagePath,
  });
};

const buildDraftSession = (
  draft: AgentSelectedImageLiveSessionDraft,
  status: 'active' | 'cancelled',
): RawEngineAppServerToolDispatchRequest['draftSession'] => ({
  draftRevision: Number(draft.snapshot.graphRevision.replace(/^history_/u, '')),
  parentRecipeHash: draft.snapshot.recipeHash,
  selectedImagePath: draft.snapshot.selectedImagePath,
  sessionId: draft.sessionId,
  status,
});

const pushEvent = (
  draft: AgentSelectedImageLiveSessionDraft,
  event: Omit<AgentSelectedImageLiveSessionAuditEvent, 'id'>,
): AgentSelectedImageLiveSessionAuditEvent => {
  const parsedEvent = selectedImageLiveSessionAuditEventSchema.parse({
    ...event,
    id: `${draft.requestId}-audit-${draft.auditEvents.length + 1}`,
  });
  draft.auditEvents.push(parsedEvent);
  return parsedEvent;
};

const stableTranscriptHash = (value: unknown): string => {
  const input = JSON.stringify(value);
  let hash = 0x811c9dc5;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `sha256:${(hash >>> 0).toString(16).padStart(16, '0')}`;
};

const buildApplyGuard = (
  draft: AgentSelectedImageLiveSessionDraft,
  current: z.infer<typeof selectedImageLiveSessionSnapshotSchema>,
): AgentSelectedImageLiveSessionApplyGuard => {
  const staleReason = getAgentSelectedImageLiveSessionStaleReasonForSnapshot(draft, current);
  return selectedImageLiveSessionApplyGuardSchema.parse({
    acceptedPreviewArtifactId: draft.snapshot.previewArtifactId,
    currentGraphRevision: current.graphRevision,
    currentPreviewArtifactId: current.previewArtifactId,
    currentPreviewHeight: current.previewHeight,
    currentPreviewIdentity: current.previewIdentity,
    currentPreviewWidth: current.previewWidth,
    currentRecipeHash: current.recipeHash,
    currentSelectedImagePath: current.selectedImagePath,
    expectedGraphRevision: draft.snapshot.graphRevision,
    expectedPreviewArtifactId: draft.snapshot.previewArtifactId,
    expectedPreviewHeight: draft.snapshot.previewHeight,
    expectedPreviewIdentity: draft.snapshot.previewIdentity,
    expectedPreviewWidth: draft.snapshot.previewWidth,
    expectedRecipeHash: draft.snapshot.recipeHash,
    expectedSelectedImagePath: draft.snapshot.selectedImagePath,
    staleReason: staleReason ?? undefined,
    status: staleReason === null ? 'passed' : 'rejected',
  });
};

const getAgentSelectedImageLiveSessionStaleReasonForSnapshot = (
  draft: AgentSelectedImageLiveSessionDraft,
  current: z.infer<typeof selectedImageLiveSessionSnapshotSchema>,
): AgentSelectedImageLiveSessionStaleReason | null => {
  if (current.selectedImagePath !== draft.snapshot.selectedImagePath) return 'image_changed';
  if (current.previewArtifactId !== draft.snapshot.previewArtifactId) return 'preview_artifact_changed';
  if (current.previewIdentity !== draft.snapshot.previewIdentity) return 'preview_identity_changed';
  if (current.previewWidth !== draft.snapshot.previewWidth || current.previewHeight !== draft.snapshot.previewHeight) {
    return 'preview_dimensions_changed';
  }
  if (current.graphRevision !== draft.snapshot.graphRevision) return 'graph_revision_changed';
  if (current.recipeHash !== draft.snapshot.recipeHash) return 'recipe_hash_changed';
  return null;
};

export const getAgentSelectedImageLiveSessionStaleReason = (
  draft: AgentSelectedImageLiveSessionDraft,
): AgentSelectedImageLiveSessionStaleReason | null => {
  return getAgentSelectedImageLiveSessionStaleReasonForSnapshot(draft, buildSnapshot());
};

export const startAgentSelectedImageLiveSessionDryRun = async ({
  adjustments,
  operationId,
  prompt,
  requestId,
  sessionId,
}: {
  adjustments: AgentAdjustmentsApplyRequest['adjustments'];
  operationId: string;
  prompt: string;
  requestId: string;
  sessionId: string;
}): Promise<AgentSelectedImageLiveSessionDraft> => {
  const snapshot = buildSnapshot();
  const dryRun = agentAdjustmentsDryRunResponseSchema.parse(
    await dispatchAgentLiveEditorTool({
      args: {
        adjustments,
        expectedGraphRevision: snapshot.graphRevision,
        expectedRecipeHash: snapshot.recipeHash,
        operationId,
        requestId: `${requestId}-dry-run`,
        sessionId,
      },
      requestId: `${requestId}-dry-run`,
      runtimeToolName: AGENT_ADJUSTMENTS_DRY_RUN_TOOL_NAME,
    }),
  );
  const draft: AgentSelectedImageLiveSessionDraft = {
    adjustments,
    auditEvents: [],
    checkpoint: createAgentSessionCheckpoint(sessionId),
    dryRun,
    operationId,
    prompt,
    requestId,
    sessionId,
    snapshot,
    state: 'approval_required',
  };
  pushEvent(draft, {
    approvalDecision: 'pending',
    graphRevision: dryRun.sourceGraphRevision,
    message: 'Dry-run is ready and requires explicit approval before apply.',
    previewHash: snapshot.previewRenderHash,
    recipeHash: snapshot.recipeHash,
    state: 'approval_required',
    toolCallId: `${requestId}-dry-run`,
    toolName: AGENT_ADJUSTMENTS_DRY_RUN_TOOL_NAME,
  });
  return draft;
};

export const approveAgentSelectedImageLiveSession = (
  draft: AgentSelectedImageLiveSessionDraft,
): AgentSelectedImageLiveSessionDraft => {
  if (draft.state !== 'approval_required') throw new Error('Selected-image live session is not awaiting approval.');
  draft.state = 'dry_run_ready';
  pushEvent(draft, {
    approvalDecision: 'approved',
    graphRevision: draft.snapshot.graphRevision,
    message: 'Dry-run approval recorded.',
    previewHash: draft.snapshot.previewRenderHash,
    recipeHash: draft.snapshot.recipeHash,
    state: 'dry_run_ready',
  });
  return draft;
};

export const cancelAgentSelectedImageLiveSession = (
  draft: AgentSelectedImageLiveSessionDraft,
): AgentSelectedImageLiveSessionAuditRecord => {
  draft.state = 'cancelling';
  pushEvent(draft, {
    approvalDecision: 'cancelled',
    cancellationOutcome: 'cancelled_before_apply',
    graphRevision: draft.snapshot.graphRevision,
    message: 'Session cancellation recorded before mutation.',
    previewHash: draft.snapshot.previewRenderHash,
    recipeHash: draft.snapshot.recipeHash,
    state: 'cancelling',
  });
  return buildAgentSelectedImageLiveSessionAuditRecord(draft, {
    approvalDecision: 'cancelled',
    cancellationOutcome: 'cancelled_before_apply',
    state: 'cancelling',
    toolCalls: [
      { id: `${draft.requestId}-dry-run`, name: AGENT_ADJUSTMENTS_DRY_RUN_TOOL_NAME, status: 'succeeded' },
      { id: `${draft.requestId}-cancel`, name: 'rawengine.agent.session.cancel', status: 'cancelled' },
    ],
  });
};

export const recordAgentSelectedImageLiveSessionLateResult = (
  draft: AgentSelectedImageLiveSessionDraft,
  apply: AgentAdjustmentsApplyResponse,
): AgentSelectedImageLiveSessionAuditRecord => {
  if (draft.state !== 'cancelling') {
    throw new Error('Selected-image live session late-result guard requires a cancelled session.');
  }
  pushEvent(draft, {
    approvalDecision: 'cancelled',
    cancellationOutcome: 'late_result_blocked',
    graphRevision: apply.appliedGraphRevision,
    message: 'Late apply result was blocked at the selected-image session boundary.',
    previewHash: apply.afterPreviewHash,
    recipeHash: draft.snapshot.recipeHash,
    state: 'cancelling',
    toolCallId: `${draft.requestId}-late-apply`,
    toolName: AGENT_ADJUSTMENTS_APPLY_TOOL_NAME,
  });
  return buildAgentSelectedImageLiveSessionAuditRecord(draft, {
    afterPreviewHash: apply.afterPreviewHash,
    approvalDecision: 'cancelled',
    cancellationOutcome: 'late_result_blocked',
    finalGraphRevision: apply.appliedGraphRevision,
    finalRecipeHash: draft.snapshot.recipeHash,
    state: 'cancelling',
    toolCalls: [
      { id: `${draft.requestId}-dry-run`, name: AGENT_ADJUSTMENTS_DRY_RUN_TOOL_NAME, status: 'succeeded' },
      { id: `${draft.requestId}-late-apply`, name: AGENT_ADJUSTMENTS_APPLY_TOOL_NAME, status: 'blocked' },
    ],
  });
};

export const applyAgentSelectedImageLiveSession = async (
  draft: AgentSelectedImageLiveSessionDraft,
): Promise<AgentSelectedImageLiveSessionApplyResult> => {
  if (draft.state !== 'dry_run_ready') throw new Error('Selected-image live session apply requires approval.');
  const currentBeforeApply = buildSnapshot();
  const applyGuard = buildApplyGuard(draft, currentBeforeApply);
  const staleReason = applyGuard.staleReason ?? null;
  if (staleReason !== null) {
    draft.state = 'failed';
    pushEvent(draft, {
      approvalDecision: 'approved',
      graphRevision: currentBeforeApply.graphRevision,
      message: `Selected-image live session rejected stale ${staleReason}.`,
      recipeHash: currentBeforeApply.recipeHash,
      staleReason,
      state: 'failed',
      toolName: AGENT_ADJUSTMENTS_APPLY_TOOL_NAME,
    });
    throw new Error(`Selected-image live session rejected ${staleReason}.`);
  }

  draft.state = 'applying';
  pushEvent(draft, {
    approvalDecision: 'approved',
    graphRevision: draft.snapshot.graphRevision,
    message: 'Applying approved selected-image dry-run.',
    previewHash: draft.snapshot.previewRenderHash,
    recipeHash: draft.snapshot.recipeHash,
    state: 'applying',
    toolName: AGENT_ADJUSTMENTS_APPLY_TOOL_NAME,
  });

  const apply = agentAdjustmentsApplyResponseSchema.parse(
    await dispatchAgentLiveEditorTool({
      args: {
        acceptedPlanHash: draft.dryRun.dryRunPlanHash,
        acceptedPlanId: draft.dryRun.dryRunPlanId,
        adjustments: draft.adjustments,
        expectedGraphRevision: draft.dryRun.sourceGraphRevision,
        expectedRecipeHash: draft.snapshot.recipeHash,
        operationId: draft.operationId,
        requestId: `${draft.requestId}-apply`,
        sessionId: draft.sessionId,
      },
      draftSession: buildDraftSession(draft, 'active'),
      requestId: `${draft.requestId}-apply`,
      runtimeToolName: AGENT_ADJUSTMENTS_APPLY_TOOL_NAME,
    }),
  );
  const afterPreview = agentPreviewRenderResponseSchema.parse(
    await dispatchAgentLiveEditorTool({
      args: {
        expectedRecipeHash: buildSnapshot().recipeHash,
        purpose: 'refresh',
        requestId: `${draft.requestId}-after-preview`,
      },
      requestId: `${draft.requestId}-after-preview`,
      runtimeToolName: AGENT_PREVIEW_RENDER_TOOL_NAME,
    }),
  );

  draft.state = 'applied';
  pushEvent(draft, {
    approvalDecision: 'approved',
    cancellationOutcome: 'not_cancelled',
    graphRevision: apply.appliedGraphRevision,
    message: 'Selected-image live session applied.',
    previewHash: apply.afterPreviewHash,
    recipeHash: afterPreview.preview.recipeHash,
    state: 'applied',
    toolCallId: `${draft.requestId}-apply`,
    toolName: AGENT_ADJUSTMENTS_APPLY_TOOL_NAME,
  });

  return {
    apply,
    audit: buildAgentSelectedImageLiveSessionAuditRecord(draft, {
      afterPreviewHash: apply.afterPreviewHash,
      approvalDecision: 'approved',
      applyGuard,
      cancellationOutcome: 'not_cancelled',
      finalGraphRevision: apply.appliedGraphRevision,
      finalRecipeHash: afterPreview.preview.recipeHash,
      state: 'applied',
      toolCalls: [
        { id: `${draft.requestId}-dry-run`, name: AGENT_ADJUSTMENTS_DRY_RUN_TOOL_NAME, status: 'succeeded' },
        { id: `${draft.requestId}-apply`, name: AGENT_ADJUSTMENTS_APPLY_TOOL_NAME, status: 'succeeded' },
        { id: `${draft.requestId}-after-preview`, name: AGENT_PREVIEW_RENDER_TOOL_NAME, status: 'succeeded' },
      ],
    }),
    previewAfterHash: apply.afterPreviewHash,
    previewBeforeHash: apply.beforePreviewHash,
  };
};

export const rollbackAgentSelectedImageLiveSession = async ({
  audit,
  checkpoint,
}: {
  audit: AgentSelectedImageLiveSessionAuditRecord;
  checkpoint: AgentSessionCheckpoint;
}): Promise<AgentSelectedImageLiveSessionAuditRecord> => {
  const parsedAudit = agentSelectedImageLiveSessionAuditRecordSchema.parse(audit);
  const current = buildSnapshot();
  const receipt = parsedAudit.receipt;
  if (current.selectedImagePath !== receipt.selectedImagePath) {
    throw new Error('Selected-image live session rollback rejected a different selected image.');
  }
  if (current.graphRevision !== receipt.finalGraphRevision) {
    throw new Error('Selected-image live session rollback rejected stale graph revision.');
  }
  if (receipt.finalRecipeHash !== undefined && current.recipeHash !== receipt.finalRecipeHash) {
    throw new Error('Selected-image live session rollback rejected stale recipe hash.');
  }
  if (checkpoint.sessionId !== receipt.sessionId || checkpoint.graphRevision !== receipt.rollbackGraphRevision) {
    throw new Error('Selected-image live session rollback rejected mismatched rollback checkpoint.');
  }
  const rollbackReceipt = agentHistoryRollbackResponseSchema.parse(
    await dispatchAgentLiveEditorTool({
      args: {
        checkpoint,
        expectedCurrentGraphRevision: current.graphRevision,
        expectedCurrentPreviewRecipeHash: current.recipeHash,
        expectedSelectedImagePath: current.selectedImagePath,
        requestId: `${receipt.requestId}-rollback`,
        scope: 'session_start',
        sessionId: receipt.sessionId,
      },
      requestId: `${receipt.requestId}-rollback`,
      runtimeToolName: AGENT_HISTORY_ROLLBACK_TOOL_NAME,
    }),
  );
  return agentSelectedImageLiveSessionAuditRecordSchema.parse({
    ...parsedAudit,
    auditEvents: [
      ...parsedAudit.auditEvents,
      {
        graphRevision: rollbackReceipt.graphRevision,
        id: `${receipt.requestId}-audit-rollback`,
        message: 'Selected-image live session rolled back through typed app-server dispatch.',
        recipeHash: rollbackReceipt.previewRecipeHash,
        state: 'rolled_back',
        toolCallId: `${receipt.requestId}-rollback`,
        toolName: AGENT_HISTORY_ROLLBACK_TOOL_NAME,
      },
    ],
    receipt: {
      ...parsedAudit.receipt,
      rollbackReceiptGraphRevision: rollbackReceipt.graphRevision,
      state: 'rolled_back',
      toolCalls: [
        ...parsedAudit.receipt.toolCalls,
        { id: `${receipt.requestId}-rollback`, name: AGENT_HISTORY_ROLLBACK_TOOL_NAME, status: 'succeeded' },
      ],
    },
    transcript: [
      ...parsedAudit.transcript,
      {
        argumentsHash: stableTranscriptHash({
          expectedCurrentGraphRevision: current.graphRevision,
          expectedCurrentPreviewRecipeHash: current.recipeHash,
          expectedSelectedImagePath: current.selectedImagePath,
          rollbackGraphRevision: checkpoint.graphRevision,
          sessionId: receipt.sessionId,
        }),
        graphRevision: current.graphRevision,
        id: `${receipt.requestId}-rollback-call`,
        kind: 'tool_call',
        previewArtifactId: receipt.acceptedPreviewArtifactId,
        recipeHash: current.recipeHash,
        status: 'succeeded',
        toolCallId: `${receipt.requestId}-rollback`,
        toolName: AGENT_HISTORY_ROLLBACK_TOOL_NAME,
      },
      {
        graphRevision: rollbackReceipt.graphRevision,
        id: `${receipt.requestId}-rollback-result`,
        kind: 'tool_result',
        previewArtifactId: receipt.acceptedPreviewArtifactId,
        recipeHash: rollbackReceipt.previewRecipeHash,
        resultHash: stableTranscriptHash(rollbackReceipt),
        rollbackGraphRevision: rollbackReceipt.graphRevision,
        status: 'succeeded',
        toolCallId: `${receipt.requestId}-rollback`,
        toolName: AGENT_HISTORY_ROLLBACK_TOOL_NAME,
      },
      {
        graphRevision: rollbackReceipt.graphRevision,
        id: `${receipt.requestId}-rollback-decision`,
        kind: 'rollback',
        previewArtifactId: receipt.acceptedPreviewArtifactId,
        recipeHash: rollbackReceipt.previewRecipeHash,
        rollbackGraphRevision: rollbackReceipt.graphRevision,
        status: 'succeeded',
        toolCallId: `${receipt.requestId}-rollback`,
        toolName: AGENT_HISTORY_ROLLBACK_TOOL_NAME,
      },
    ],
  });
};

export const buildAgentSelectedImageLiveSessionAuditRecord = (
  draft: AgentSelectedImageLiveSessionDraft,
  receiptPatch: {
    afterPreviewHash?: string;
    approvalDecision: AgentSelectedImageLiveSessionApprovalDecision;
    applyGuard?: AgentSelectedImageLiveSessionApplyGuard;
    cancellationOutcome: AgentSelectedImageLiveSessionCancellationOutcome;
    finalGraphRevision?: string;
    finalRecipeHash?: string;
    state: AgentSelectedImageLiveSessionState;
    staleReason?: AgentSelectedImageLiveSessionStaleReason;
    toolCalls: AgentSelectedImageLiveSessionReceipt['toolCalls'];
  },
): AgentSelectedImageLiveSessionAuditRecord =>
  agentSelectedImageLiveSessionAuditRecordSchema.parse({
    auditEvents: draft.auditEvents,
    receipt: {
      acceptedPreviewArtifactId: draft.snapshot.previewArtifactId,
      afterPreviewHash: receiptPatch.afterPreviewHash,
      approvalDecision: receiptPatch.approvalDecision,
      applyGuard: receiptPatch.applyGuard,
      beforePreviewHash: draft.snapshot.previewRenderHash,
      cancellationOutcome: receiptPatch.cancellationOutcome,
      dryRunPlanHash: draft.dryRun.dryRunPlanHash,
      dryRunPlanId: draft.dryRun.dryRunPlanId,
      finalGraphRevision: receiptPatch.finalGraphRevision,
      finalRecipeHash: receiptPatch.finalRecipeHash,
      initialGraphRevision: draft.snapshot.graphRevision,
      initialRecipeHash: draft.snapshot.recipeHash,
      operationId: draft.operationId,
      requestId: draft.requestId,
      rollbackGraphRevision: draft.checkpoint.graphRevision,
      selectedImagePath: draft.snapshot.selectedImagePath,
      sessionId: draft.sessionId,
      staleReason: receiptPatch.staleReason,
      state: receiptPatch.state,
      toolCalls: receiptPatch.toolCalls,
    },
    replayState: 'replayable',
    schemaVersion: 1,
    transcript: buildAgentSelectedImageLiveSessionTranscript(draft, receiptPatch),
  });

const buildAgentSelectedImageLiveSessionTranscript = (
  draft: AgentSelectedImageLiveSessionDraft,
  receiptPatch: {
    afterPreviewHash?: string;
    approvalDecision: AgentSelectedImageLiveSessionApprovalDecision;
    applyGuard?: AgentSelectedImageLiveSessionApplyGuard;
    cancellationOutcome: AgentSelectedImageLiveSessionCancellationOutcome;
    finalGraphRevision?: string;
    finalRecipeHash?: string;
    state: AgentSelectedImageLiveSessionState;
    staleReason?: AgentSelectedImageLiveSessionStaleReason;
    toolCalls: AgentSelectedImageLiveSessionReceipt['toolCalls'];
  },
): AgentSelectedImageLiveSessionTranscriptEntry[] => {
  const toolEntries = receiptPatch.toolCalls.flatMap((toolCall): AgentSelectedImageLiveSessionTranscriptEntry[] => [
    {
      argumentsHash: stableTranscriptHash({
        acceptedPlanHash: toolCall.name === AGENT_ADJUSTMENTS_APPLY_TOOL_NAME ? draft.dryRun.dryRunPlanHash : undefined,
        acceptedPlanId: toolCall.name === AGENT_ADJUSTMENTS_APPLY_TOOL_NAME ? draft.dryRun.dryRunPlanId : undefined,
        adjustments: toolCall.name.includes('adjustments') ? draft.adjustments : undefined,
        expectedGraphRevision: draft.snapshot.graphRevision,
        expectedRecipeHash: draft.snapshot.recipeHash,
        operationId: draft.operationId,
        previewArtifactId: draft.snapshot.previewArtifactId,
        selectedImagePath: draft.snapshot.selectedImagePath,
        sessionId: draft.sessionId,
      }),
      graphRevision: draft.snapshot.graphRevision,
      id: `${toolCall.id}-call`,
      kind: 'tool_call',
      previewArtifactId: draft.snapshot.previewArtifactId,
      recipeHash: draft.snapshot.recipeHash,
      status: toolCall.status === 'blocked' ? 'blocked' : toolCall.status,
      toolCallId: toolCall.id,
      toolName: toolCall.name,
    },
    {
      graphRevision: receiptPatch.finalGraphRevision ?? draft.snapshot.graphRevision,
      id: `${toolCall.id}-result`,
      kind: 'tool_result',
      previewArtifactId: draft.snapshot.previewArtifactId,
      recipeHash: receiptPatch.finalRecipeHash ?? draft.snapshot.recipeHash,
      resultHash: stableTranscriptHash({
        afterPreviewHash: receiptPatch.afterPreviewHash,
        cancellationOutcome: receiptPatch.cancellationOutcome,
        finalGraphRevision: receiptPatch.finalGraphRevision,
        finalRecipeHash: receiptPatch.finalRecipeHash,
        status: toolCall.status,
      }),
      status: toolCall.status === 'blocked' ? 'blocked' : toolCall.status,
      toolCallId: toolCall.id,
      toolName: toolCall.name,
    },
  ]);

  return [
    {
      acceptedPreviewArtifactId: draft.snapshot.previewArtifactId,
      graphRevision: draft.snapshot.graphRevision,
      id: `${draft.requestId}-accepted-preview`,
      kind: 'preview',
      previewArtifactId: draft.snapshot.previewArtifactId,
      recipeHash: draft.snapshot.recipeHash,
      resultHash: stableTranscriptHash({
        previewArtifactId: draft.snapshot.previewArtifactId,
        previewRenderHash: draft.snapshot.previewRenderHash,
      }),
      status: 'succeeded',
    },
    ...toolEntries,
    {
      acceptedPreviewArtifactId: draft.snapshot.previewArtifactId,
      graphRevision: draft.snapshot.graphRevision,
      id: `${draft.requestId}-approval-decision`,
      kind: 'approval',
      previewArtifactId: draft.snapshot.previewArtifactId,
      recipeHash: draft.snapshot.recipeHash,
      resultHash: stableTranscriptHash(receiptPatch.approvalDecision),
      status:
        receiptPatch.approvalDecision === 'approved'
          ? 'succeeded'
          : receiptPatch.approvalDecision === 'cancelled'
            ? 'cancelled'
            : receiptPatch.approvalDecision === 'pending'
              ? 'pending'
              : 'rejected',
    },
    {
      acceptedPreviewArtifactId: draft.snapshot.previewArtifactId,
      graphRevision: receiptPatch.finalGraphRevision ?? draft.snapshot.graphRevision,
      id: `${draft.requestId}-apply-decision`,
      kind: 'apply_decision',
      previewArtifactId: draft.snapshot.previewArtifactId,
      recipeHash: receiptPatch.finalRecipeHash ?? draft.snapshot.recipeHash,
      resultHash: stableTranscriptHash(receiptPatch.applyGuard ?? receiptPatch.cancellationOutcome),
      staleReason: receiptPatch.staleReason ?? receiptPatch.applyGuard?.staleReason,
      status:
        receiptPatch.applyGuard?.status === 'rejected'
          ? 'rejected'
          : receiptPatch.state === 'applied'
            ? 'succeeded'
            : receiptPatch.state === 'cancelling'
              ? 'cancelled'
              : receiptPatch.state === 'failed'
                ? 'failed'
                : 'pending',
      toolCallId: receiptPatch.toolCalls.find((toolCall) => toolCall.name === AGENT_ADJUSTMENTS_APPLY_TOOL_NAME)?.id,
      toolName: AGENT_ADJUSTMENTS_APPLY_TOOL_NAME,
    },
  ];
};

export const replayAgentSelectedImageLiveSessionAudit = (
  audit: AgentSelectedImageLiveSessionAuditRecord,
): AgentSelectedImageLiveSessionReceipt => {
  const parsedAudit = agentSelectedImageLiveSessionAuditRecordSchema.parse(audit);
  const { receipt } = parsedAudit;
  verifyAgentSelectedImageLiveSessionTranscript(parsedAudit);
  if (
    receipt.approvalDecision === 'approved' &&
    receipt.state === 'applied' &&
    receipt.afterPreviewHash === undefined
  ) {
    throw new Error('Selected-image live session audit replay rejected applied receipt without after preview hash.');
  }
  if (receipt.state === 'cancelling' && receipt.cancellationOutcome === 'not_cancelled') {
    throw new Error('Selected-image live session audit replay rejected missing cancellation outcome.');
  }
  if (!receipt.toolCalls.some((toolCall) => toolCall.name === AGENT_ADJUSTMENTS_DRY_RUN_TOOL_NAME)) {
    throw new Error('Selected-image live session audit replay rejected missing dry-run tool receipt.');
  }
  if (receipt.state === 'applied') {
    if (receipt.applyGuard === undefined) {
      throw new Error('Selected-image live session audit replay rejected applied receipt without apply guard.');
    }
    if (receipt.applyGuard.status !== 'passed') {
      throw new Error('Selected-image live session audit replay rejected failed apply guard.');
    }
    if (receipt.applyGuard.acceptedPreviewArtifactId !== receipt.acceptedPreviewArtifactId) {
      throw new Error('Selected-image live session audit replay rejected mismatched accepted preview artifact.');
    }
  }
  return receipt;
};

const verifyAgentSelectedImageLiveSessionTranscript = (audit: AgentSelectedImageLiveSessionAuditRecord): void => {
  const toolCallIds = new Set(audit.receipt.toolCalls.map((toolCall) => toolCall.id));
  const transcriptToolCallIds = new Set(
    audit.transcript
      .filter((entry) => entry.kind === 'tool_call')
      .map((entry) => entry.toolCallId)
      .filter((id): id is string => id !== undefined),
  );
  for (const toolCallId of toolCallIds) {
    if (!transcriptToolCallIds.has(toolCallId)) {
      throw new Error(`Selected-image live session audit replay rejected missing transcript call ${toolCallId}.`);
    }
  }

  const acceptedPreview = audit.transcript.find((entry) => entry.kind === 'preview');
  if (acceptedPreview?.previewArtifactId !== audit.receipt.acceptedPreviewArtifactId) {
    throw new Error('Selected-image live session audit replay rejected missing accepted preview transcript.');
  }

  const applyDecision = audit.transcript.find((entry) => entry.kind === 'apply_decision');
  if (applyDecision === undefined) {
    throw new Error('Selected-image live session audit replay rejected missing apply decision transcript.');
  }
  if (applyDecision.acceptedPreviewArtifactId !== audit.receipt.acceptedPreviewArtifactId) {
    throw new Error('Selected-image live session audit replay rejected stale apply decision preview artifact.');
  }
  if (audit.receipt.state === 'applied' && applyDecision.status !== 'succeeded') {
    throw new Error('Selected-image live session audit replay rejected unapplied apply decision status.');
  }
};
