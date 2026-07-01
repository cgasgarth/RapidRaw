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
  | 'recipe_hash_changed';
export type AgentSelectedImageLiveSessionCancellationOutcome =
  | 'cancelled_before_apply'
  | 'late_result_blocked'
  | 'not_cancelled';

const selectedImageLiveSessionSnapshotSchema = z
  .object({
    graphRevision: z.string().trim().min(1),
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
    staleReason: z.enum(['graph_revision_changed', 'image_changed', 'recipe_hash_changed']).optional(),
    toolCallId: z.string().trim().min(1).optional(),
    toolName: z.string().trim().min(1).optional(),
  })
  .strict();

export const agentSelectedImageLiveSessionReceiptSchema = z
  .object({
    afterPreviewHash: z.string().trim().min(1).optional(),
    approvalDecision: z.enum(['approved', 'cancelled', 'pending', 'rejected']),
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
    staleReason: z.enum(['graph_revision_changed', 'image_changed', 'recipe_hash_changed']).optional(),
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
  })
  .strict();

export type AgentSelectedImageLiveSessionAuditEvent = z.infer<typeof selectedImageLiveSessionAuditEventSchema>;
export type AgentSelectedImageLiveSessionAuditRecord = z.infer<typeof agentSelectedImageLiveSessionAuditRecordSchema>;
export type AgentSelectedImageLiveSessionReceipt = z.infer<typeof agentSelectedImageLiveSessionReceiptSchema>;

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

export const getAgentSelectedImageLiveSessionStaleReason = (
  draft: AgentSelectedImageLiveSessionDraft,
): AgentSelectedImageLiveSessionStaleReason | null => {
  const current = buildSnapshot();
  if (current.selectedImagePath !== draft.snapshot.selectedImagePath) return 'image_changed';
  if (current.graphRevision !== draft.snapshot.graphRevision) return 'graph_revision_changed';
  if (current.recipeHash !== draft.snapshot.recipeHash) return 'recipe_hash_changed';
  return null;
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
  const staleReason = getAgentSelectedImageLiveSessionStaleReason(draft);
  if (staleReason !== null) {
    draft.state = 'failed';
    pushEvent(draft, {
      approvalDecision: 'approved',
      graphRevision: buildSnapshot().graphRevision,
      message: `Selected-image live session rejected stale ${staleReason}.`,
      recipeHash: buildSnapshot().recipeHash,
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
  });
};

export const buildAgentSelectedImageLiveSessionAuditRecord = (
  draft: AgentSelectedImageLiveSessionDraft,
  receiptPatch: {
    afterPreviewHash?: string;
    approvalDecision: AgentSelectedImageLiveSessionApprovalDecision;
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
      afterPreviewHash: receiptPatch.afterPreviewHash,
      approvalDecision: receiptPatch.approvalDecision,
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
  });

export const replayAgentSelectedImageLiveSessionAudit = (
  audit: AgentSelectedImageLiveSessionAuditRecord,
): AgentSelectedImageLiveSessionReceipt => {
  const parsedAudit = agentSelectedImageLiveSessionAuditRecordSchema.parse(audit);
  const { receipt } = parsedAudit;
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
  return receipt;
};
