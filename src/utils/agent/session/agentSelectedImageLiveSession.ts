import { z } from 'zod';
import type { RawEngineAppServerToolDispatchRequest } from '../../../schemas/agent/agentRuntimeSchemas';
import type {
  AgentCurrentImagePreviewLoopRequest,
  AgentCurrentImagePreviewLoopResult,
} from '../context/agentCurrentImagePreviewLoop';
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
  agentAdjustmentsApplyRequestSchema,
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
export type AgentSelectedImageLiveSessionEnvelopeBlockedReason =
  | AgentSelectedImageLiveSessionStaleReason
  | 'approval_mismatch'
  | 'invalid_arguments'
  | 'missing_approval'
  | 'request_id_mismatch'
  | 'runtime_tool_mismatch';
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
    approvalId: z.string().trim().min(1).optional(),
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
    approvalId: z.string().trim().min(1).optional(),
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

const selectedImageLiveSessionDryRunApprovalSchema = z
  .object({
    approvalId: z.string().trim().min(1).optional(),
    approvedGraphRevision: z.string().trim().min(1),
    approvedRecipeHash: z.string().trim().min(1),
    dryRunPlanHash: z.string().trim().min(1),
    dryRunPlanId: z.string().trim().min(1),
    state: z.enum(['approved', 'cancelled', 'pending', 'rejected']),
    turn: z.number().int().positive().optional(),
  })
  .strict();

const selectedImageLiveSessionApplyReceiptSchema = z
  .object({
    acceptedPlanHash: z.string().trim().min(1).optional(),
    acceptedPlanId: z.string().trim().min(1).optional(),
    graphRevision: z.string().trim().min(1),
    previewHash: z.string().trim().min(1).optional(),
    recipeHash: z.string().trim().min(1).optional(),
    status: z.enum(['blocked', 'cancelled', 'succeeded']),
    toolCallId: z.string().trim().min(1),
    turn: z.number().int().positive().optional(),
  })
  .strict();

const selectedImageLiveSessionPreviewLineageSchema = z
  .object({
    graphRevision: z.string().trim().min(1),
    previewArtifactId: z.string().trim().min(1),
    previewRef: z.string().trim().min(1).optional(),
    purpose: z.enum(['accepted_preview', 'detail_review', 'refresh']),
    recipeHash: z.string().trim().min(1),
    renderHash: z.string().trim().min(1).optional(),
    sourceToolCallId: z.string().trim().min(1).optional(),
    sourceToolName: z.string().trim().min(1).optional(),
    turn: z.number().int().positive().optional(),
  })
  .strict();

const selectedImageLiveSessionRollbackCheckpointSchema = z
  .object({
    graphRevision: z.string().trim().min(1),
    previewRecipeHash: z.string().trim().min(1).optional(),
    sessionId: z.string().trim().min(1),
  })
  .strict();

export const agentSelectedImageLiveSessionReceiptSchema = z
  .object({
    acceptedPreviewArtifactId: z.string().trim().min(1),
    afterPreviewHash: z.string().trim().min(1).optional(),
    approvalDecision: z.enum(['approved', 'cancelled', 'pending', 'rejected']),
    approvalId: z.string().trim().min(1).optional(),
    applyGuard: selectedImageLiveSessionApplyGuardSchema.optional(),
    applyReceipts: z.array(selectedImageLiveSessionApplyReceiptSchema).optional(),
    beforePreviewHash: z.string().trim().min(1),
    cancellationOutcome: z.enum(['cancelled_before_apply', 'late_result_blocked', 'not_cancelled']),
    dryRunApprovals: z.array(selectedImageLiveSessionDryRunApprovalSchema).optional(),
    dryRunPlanHash: z.string().trim().min(1),
    dryRunPlanId: z.string().trim().min(1),
    finalGraphHash: z.string().trim().min(1).optional(),
    finalGraphRevision: z.string().trim().min(1).optional(),
    finalRecipeHash: z.string().trim().min(1).optional(),
    initialGraphRevision: z.string().trim().min(1),
    initialRecipeHash: z.string().trim().min(1),
    operationId: z.string().trim().min(1),
    previewLineage: z.array(selectedImageLiveSessionPreviewLineageSchema).optional(),
    promptSummary: z.string().trim().min(1).default('Selected-image edit'),
    requestId: z.string().trim().min(1),
    rollbackCheckpoint: selectedImageLiveSessionRollbackCheckpointSchema.optional(),
    rollbackGraphRevision: z.string().trim().min(1),
    rollbackReceiptGraphRevision: z.string().trim().min(1).optional(),
    selectedImagePath: z.string().trim().min(1),
    sessionId: z.string().trim().min(1),
    storageKey: z.string().trim().min(1).optional(),
    schemaVersion: z.literal(1).default(1),
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

export const agentSelectedImageLiveSessionAuditStoreSchema = z
  .object({
    records: z.array(agentSelectedImageLiveSessionAuditRecordSchema),
    schemaVersion: z.literal(1),
  })
  .strict();

export const agentSelectedImageLiveSessionReplayPreflightSchema = z
  .object({
    currentGraphRevision: z.string().trim().min(1),
    currentPreviewArtifactId: z.string().trim().min(1),
    currentRecipeHash: z.string().trim().min(1),
    currentSelectedImagePath: z.string().trim().min(1),
    expectedGraphRevision: z.string().trim().min(1),
    expectedPreviewArtifactId: z.string().trim().min(1),
    expectedRecipeHash: z.string().trim().min(1),
    expectedSelectedImagePath: z.string().trim().min(1),
    replayPreviewHash: z.string().trim().min(1),
    sessionId: z.string().trim().min(1),
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
    status: z.enum(['ready', 'stale']),
    toolCallCount: z.number().int().positive(),
  })
  .strict();

export const agentSelectedImageLiveSessionAuditExportReceiptSchema = z
  .object({
    auditRecord: agentSelectedImageLiveSessionAuditRecordSchema,
    exportedAt: z.string().trim().min(1),
    graphRevisions: z
      .object({
        final: z.string().trim().min(1).optional(),
        initial: z.string().trim().min(1),
        rollbackCheckpoint: z.string().trim().min(1),
        rollbackReceipt: z.string().trim().min(1).optional(),
      })
      .strict(),
    kind: z.literal('agent.selectedImageLiveSession.auditReceipt'),
    previewHashes: z
      .object({
        after: z.string().trim().min(1).optional(),
        before: z.string().trim().min(1),
        lineage: z
          .array(
            z
              .object({
                graphRevision: z.string().trim().min(1),
                previewArtifactId: z.string().trim().min(1),
                purpose: z.enum(['accepted_preview', 'detail_review', 'refresh']),
                renderHash: z.string().trim().min(1).optional(),
              })
              .strict(),
          )
          .optional(),
      })
      .strict(),
    replayPreflight: agentSelectedImageLiveSessionReplayPreflightSchema,
    requestIds: z.array(z.string().trim().min(1)).min(1),
    rollbackState: z
      .object({
        checkpointGraphRevision: z.string().trim().min(1),
        receiptGraphRevision: z.string().trim().min(1).optional(),
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
        status: z.enum(['available', 'restored', 'unavailable']),
      })
      .strict(),
    schemaVersion: z.literal(1),
    selectedImage: z
      .object({
        basename: z.string().trim().min(1),
        stableHash: z.string().trim().min(1),
      })
      .strict(),
    sessionId: z.string().trim().min(1),
    toolNames: z.array(z.string().trim().min(1)).min(1),
  })
  .strict();

export type AgentSelectedImageLiveSessionAuditEvent = z.infer<typeof selectedImageLiveSessionAuditEventSchema>;
export type AgentSelectedImageLiveSessionAuditExportReceipt = z.infer<
  typeof agentSelectedImageLiveSessionAuditExportReceiptSchema
>;
export type AgentSelectedImageLiveSessionAuditRecord = z.infer<typeof agentSelectedImageLiveSessionAuditRecordSchema>;
export type AgentSelectedImageLiveSessionAuditStore = z.infer<typeof agentSelectedImageLiveSessionAuditStoreSchema>;
export type AgentSelectedImageLiveSessionApplyGuard = z.infer<typeof selectedImageLiveSessionApplyGuardSchema>;
export type AgentSelectedImageLiveSessionReplayPreflight = z.infer<
  typeof agentSelectedImageLiveSessionReplayPreflightSchema
>;
export type AgentSelectedImageLiveSessionReceipt = z.infer<typeof agentSelectedImageLiveSessionReceiptSchema>;
export type AgentSelectedImageLiveSessionTranscriptEntry = z.infer<
  typeof selectedImageLiveSessionTranscriptEntrySchema
>;

export interface AgentSelectedImageLiveSessionAuditSummary {
  finalGraphRevision?: string;
  latestSessionId?: string;
  previewCount: number;
  recordCount: number;
  replayPreflightStatus: 'failed' | 'ready' | 'stale' | 'unchecked';
}

export interface AgentSelectedImageLiveSessionDraft {
  adjustments: AgentAdjustmentsApplyRequest['adjustments'];
  approvalId?: string;
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

export interface AgentSelectedImageLiveSessionAppliedResult {
  status: 'applied';
  apply: AgentAdjustmentsApplyResponse;
  audit: AgentSelectedImageLiveSessionAuditRecord;
  previewAfterHash: string;
  previewBeforeHash: string;
}

export interface AgentSelectedImageLiveSessionBlockedResult {
  status: 'blocked';
  applyGuard: AgentSelectedImageLiveSessionApplyGuard;
  audit: AgentSelectedImageLiveSessionAuditRecord;
  message: string;
  reason: AgentSelectedImageLiveSessionEnvelopeBlockedReason;
  refresh: AgentSelectedImageLiveSessionContextRefresh;
  staleReason?: AgentSelectedImageLiveSessionStaleReason;
}

export type AgentSelectedImageLiveSessionApplyResult =
  | AgentSelectedImageLiveSessionAppliedResult
  | AgentSelectedImageLiveSessionBlockedResult;

export interface AgentSelectedImageLiveSessionContextRefresh {
  applyGuard: AgentSelectedImageLiveSessionApplyGuard;
  currentGraphRevision: string;
  currentPreviewArtifactId: string;
  currentPreviewIdentity: string | null;
  currentRecipeHash: string;
  currentSelectedImagePath: string;
  status: 'ready' | 'stale';
  staleReason?: AgentSelectedImageLiveSessionStaleReason;
}

export interface AgentSelectedImageLiveSessionAuditStorageAdapter {
  readText: () => string | null;
  writeText: (value: string) => void;
}

export type AgentSelectedImageApplyEnvelopeValidation =
  | {
      applyGuard: AgentSelectedImageLiveSessionApplyGuard;
      parsedRequest: AgentAdjustmentsApplyRequest;
      status: 'passed';
    }
  | {
      applyGuard: AgentSelectedImageLiveSessionApplyGuard;
      message: string;
      reason: AgentSelectedImageLiveSessionEnvelopeBlockedReason;
      staleReason?: AgentSelectedImageLiveSessionStaleReason;
      status: 'blocked';
    };

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

const getPathBasename = (path: string): string => {
  const cleanPath = path.split('?')[0] ?? path;
  return cleanPath.split(/[\\/]/u).pop() || cleanPath || 'selected-image';
};

export const buildAgentSelectedImageLiveSessionAuditStorageKey = ({
  namespace = 'rawengine.agent.selectedImageLiveSessionAudit.v1',
  selectedImagePath,
  sessionId,
}: {
  namespace?: string;
  selectedImagePath: string;
  sessionId: string;
}): string => `${namespace}.${stableTranscriptHash({ selectedImagePath, sessionId }).replace(':', '-')}`;

const summarizePrompt = (prompt: string): string => {
  const normalized = prompt.replaceAll(/\s+/gu, ' ').trim();
  if (normalized.length === 0) return 'Selected-image edit';
  return normalized.length <= 180 ? normalized : `${normalized.slice(0, 177)}...`;
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
  if (current.graphRevision !== draft.snapshot.graphRevision) return 'graph_revision_changed';
  if (current.recipeHash !== draft.snapshot.recipeHash) return 'recipe_hash_changed';
  if (current.previewIdentity !== draft.snapshot.previewIdentity) return 'preview_identity_changed';
  if (current.previewWidth !== draft.snapshot.previewWidth || current.previewHeight !== draft.snapshot.previewHeight) {
    return 'preview_dimensions_changed';
  }
  if (current.previewArtifactId !== draft.snapshot.previewArtifactId) return 'preview_artifact_changed';
  return null;
};

export const getAgentSelectedImageLiveSessionStaleReason = (
  draft: AgentSelectedImageLiveSessionDraft,
): AgentSelectedImageLiveSessionStaleReason | null => {
  return getAgentSelectedImageLiveSessionStaleReasonForSnapshot(draft, buildSnapshot());
};

export const refreshAgentSelectedImageLiveSessionContext = (
  draft: AgentSelectedImageLiveSessionDraft,
): AgentSelectedImageLiveSessionContextRefresh => {
  const current = buildSnapshot();
  const applyGuard = buildApplyGuard(draft, current);
  const staleReason = applyGuard.staleReason;
  const refresh: AgentSelectedImageLiveSessionContextRefresh = {
    applyGuard,
    currentGraphRevision: current.graphRevision,
    currentPreviewArtifactId: current.previewArtifactId,
    currentPreviewIdentity: current.previewIdentity,
    currentRecipeHash: current.recipeHash,
    currentSelectedImagePath: current.selectedImagePath,
    status: staleReason === undefined ? 'ready' : 'stale',
  };
  if (staleReason !== undefined) refresh.staleReason = staleReason;
  return refresh;
};

const buildBlockedApplyValidation = ({
  applyGuard,
  message,
  reason,
}: {
  applyGuard: AgentSelectedImageLiveSessionApplyGuard;
  message: string;
  reason: AgentSelectedImageLiveSessionEnvelopeBlockedReason;
}): AgentSelectedImageApplyEnvelopeValidation => {
  const validation: AgentSelectedImageApplyEnvelopeValidation = {
    applyGuard,
    message,
    reason,
    status: 'blocked',
  };
  if (applyGuard.staleReason !== undefined) validation.staleReason = applyGuard.staleReason;
  return validation;
};

export const validateAgentSelectedImageApplyToolEnvelope = ({
  args,
  draft,
  requestId,
  runtimeToolName,
}: {
  args: unknown;
  draft: AgentSelectedImageLiveSessionDraft;
  requestId: string;
  runtimeToolName: string;
}): AgentSelectedImageApplyEnvelopeValidation => {
  const current = buildSnapshot();
  const applyGuard = buildApplyGuard(draft, current);

  if (runtimeToolName !== AGENT_ADJUSTMENTS_APPLY_TOOL_NAME) {
    return buildBlockedApplyValidation({
      applyGuard,
      message: `Selected-image live session rejected unexpected tool ${runtimeToolName}.`,
      reason: 'runtime_tool_mismatch',
    });
  }

  if (requestId !== `${draft.requestId}-apply`) {
    return buildBlockedApplyValidation({
      applyGuard,
      message: 'Selected-image live session rejected mismatched apply request id.',
      reason: 'request_id_mismatch',
    });
  }

  if (draft.state !== 'dry_run_ready' || draft.approvalId === undefined) {
    return buildBlockedApplyValidation({
      applyGuard,
      message: 'Selected-image live session apply requires an approved dry-run.',
      reason: 'missing_approval',
    });
  }

  const parsedRequest = agentAdjustmentsApplyRequestSchema.safeParse(args);
  if (!parsedRequest.success) {
    return buildBlockedApplyValidation({
      applyGuard,
      message: 'Selected-image live session rejected invalid apply arguments.',
      reason: 'invalid_arguments',
    });
  }

  const request = parsedRequest.data;
  if (
    request.acceptedPlanHash !== draft.dryRun.dryRunPlanHash ||
    request.acceptedPlanId !== draft.dryRun.dryRunPlanId ||
    request.approval.approvalId !== draft.approvalId ||
    request.approval.approvedGraphRevision !== draft.dryRun.sourceGraphRevision ||
    request.approval.approvedPlanHash !== draft.dryRun.dryRunPlanHash ||
    request.approval.approvedPlanId !== draft.dryRun.dryRunPlanId ||
    request.approval.approvedRecipeHash !== draft.snapshot.recipeHash ||
    request.approval.approvedSessionId !== draft.sessionId ||
    request.expectedGraphRevision !== draft.dryRun.sourceGraphRevision ||
    request.expectedRecipeHash !== draft.snapshot.recipeHash ||
    request.operationId !== draft.operationId ||
    request.requestId !== requestId ||
    request.sessionId !== draft.sessionId
  ) {
    return buildBlockedApplyValidation({
      applyGuard,
      message: 'Selected-image live session rejected mismatched approval or dry-run envelope.',
      reason: 'approval_mismatch',
    });
  }

  if (applyGuard.staleReason !== undefined) {
    return buildBlockedApplyValidation({
      applyGuard,
      message: `Selected-image live session rejected stale ${applyGuard.staleReason}.`,
      reason: applyGuard.staleReason,
    });
  }

  return {
    applyGuard,
    parsedRequest: request,
    status: 'passed',
  };
};

export const parseAgentSelectedImageLiveSessionAuditStore = (
  value: string | null,
): AgentSelectedImageLiveSessionAuditStore => {
  if (value === null) return { records: [], schemaVersion: 1 };

  let parsedValue: unknown;
  try {
    parsedValue = JSON.parse(value);
  } catch {
    return { records: [], schemaVersion: 1 };
  }

  const currentStore = agentSelectedImageLiveSessionAuditStoreSchema.safeParse(parsedValue);
  if (currentStore.success) return currentStore.data;

  const legacyRecords = z.array(agentSelectedImageLiveSessionAuditRecordSchema).safeParse(parsedValue);
  if (legacyRecords.success) {
    return agentSelectedImageLiveSessionAuditStoreSchema.parse({
      records: legacyRecords.data,
      schemaVersion: 1,
    });
  }

  return { records: [], schemaVersion: 1 };
};

export const readAgentSelectedImageLiveSessionAuditStore = (
  adapter: AgentSelectedImageLiveSessionAuditStorageAdapter,
): AgentSelectedImageLiveSessionAuditStore => parseAgentSelectedImageLiveSessionAuditStore(adapter.readText());

export const appendAgentSelectedImageLiveSessionAuditRecord = (
  adapter: AgentSelectedImageLiveSessionAuditStorageAdapter,
  record: AgentSelectedImageLiveSessionAuditRecord,
): AgentSelectedImageLiveSessionAuditStore => {
  const store = readAgentSelectedImageLiveSessionAuditStore(adapter);
  const parsedRecord = agentSelectedImageLiveSessionAuditRecordSchema.parse(record);
  verifyAgentSelectedImageAuditReceiptLineage(parsedRecord);
  const nextStore = agentSelectedImageLiveSessionAuditStoreSchema.parse({
    records: [...store.records, parsedRecord],
    schemaVersion: 1,
  });
  adapter.writeText(JSON.stringify(nextStore));
  return nextStore;
};

export const summarizeAgentSelectedImageLiveSessionAuditStore = (
  adapter: AgentSelectedImageLiveSessionAuditStorageAdapter,
): AgentSelectedImageLiveSessionAuditSummary => {
  const store = readAgentSelectedImageLiveSessionAuditStore(adapter);
  const latest = store.records.at(-1);
  if (latest === undefined) {
    return {
      previewCount: 0,
      recordCount: 0,
      replayPreflightStatus: 'unchecked',
    };
  }

  let replayPreflightStatus: AgentSelectedImageLiveSessionAuditSummary['replayPreflightStatus'] = 'failed';
  try {
    replayPreflightStatus = preflightAgentSelectedImageLiveSessionAuditReplay(latest).status;
  } catch {
    replayPreflightStatus = 'failed';
  }

  const summary: AgentSelectedImageLiveSessionAuditSummary = {
    latestSessionId: latest.receipt.sessionId,
    previewCount:
      latest.receipt.previewLineage?.length ?? latest.transcript.filter((entry) => entry.kind === 'preview').length,
    recordCount: store.records.length,
    replayPreflightStatus,
  };
  if (latest.receipt.finalGraphRevision !== undefined) {
    summary.finalGraphRevision = latest.receipt.finalGraphRevision;
  }
  return summary;
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
  draft.approvalId = `approval_${draft.sessionId}_${draft.requestId}_${draft.dryRun.dryRunPlanId}`.replaceAll(
    /[^A-Za-z0-9_-]/gu,
    '_',
  );
  draft.state = 'dry_run_ready';
  pushEvent(draft, {
    approvalDecision: 'approved',
    approvalId: draft.approvalId,
    graphRevision: draft.snapshot.graphRevision,
    message: 'Dry-run approval recorded.',
    previewHash: draft.snapshot.previewRenderHash,
    recipeHash: draft.snapshot.recipeHash,
    state: 'dry_run_ready',
  });
  return draft;
};

export const rejectAgentSelectedImageLiveSession = (
  draft: AgentSelectedImageLiveSessionDraft,
): AgentSelectedImageLiveSessionAuditRecord => {
  if (draft.state !== 'approval_required') throw new Error('Selected-image live session is not awaiting approval.');
  draft.state = 'failed';
  pushEvent(draft, {
    approvalDecision: 'rejected',
    graphRevision: draft.snapshot.graphRevision,
    message: 'Dry-run approval was rejected before apply.',
    previewHash: draft.snapshot.previewRenderHash,
    recipeHash: draft.snapshot.recipeHash,
    state: 'failed',
  });
  return buildAgentSelectedImageLiveSessionAuditRecord(draft, {
    approvalDecision: 'rejected',
    cancellationOutcome: 'not_cancelled',
    state: 'failed',
    toolCalls: [
      { id: `${draft.requestId}-dry-run`, name: AGENT_ADJUSTMENTS_DRY_RUN_TOOL_NAME, status: 'succeeded' },
      { id: `${draft.requestId}-approval-rejected`, name: AGENT_ADJUSTMENTS_APPLY_TOOL_NAME, status: 'blocked' },
    ],
  });
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
  const applyRequest = {
    acceptedPlanHash: draft.dryRun.dryRunPlanHash,
    acceptedPlanId: draft.dryRun.dryRunPlanId,
    adjustments: draft.adjustments,
    approval: {
      approvalId: draft.approvalId ?? '',
      approvedGraphRevision: draft.dryRun.sourceGraphRevision,
      approvedPlanHash: draft.dryRun.dryRunPlanHash,
      approvedPlanId: draft.dryRun.dryRunPlanId,
      approvedRecipeHash: draft.snapshot.recipeHash,
      approvedSessionId: draft.sessionId,
      status: 'approved',
    },
    expectedGraphRevision: draft.dryRun.sourceGraphRevision,
    expectedRecipeHash: draft.snapshot.recipeHash,
    operationId: draft.operationId,
    requestId: `${draft.requestId}-apply`,
    sessionId: draft.sessionId,
  };
  const envelopeValidation = validateAgentSelectedImageApplyToolEnvelope({
    args: applyRequest,
    draft,
    requestId: `${draft.requestId}-apply`,
    runtimeToolName: AGENT_ADJUSTMENTS_APPLY_TOOL_NAME,
  });
  if (envelopeValidation.status === 'blocked') {
    draft.state = 'failed';
    pushEvent(draft, {
      approvalDecision: 'approved',
      graphRevision: envelopeValidation.applyGuard.currentGraphRevision,
      message: envelopeValidation.message,
      recipeHash: envelopeValidation.applyGuard.currentRecipeHash,
      ...(envelopeValidation.staleReason === undefined ? {} : { staleReason: envelopeValidation.staleReason }),
      state: 'failed',
      toolName: AGENT_ADJUSTMENTS_APPLY_TOOL_NAME,
    });
    const audit = buildAgentSelectedImageLiveSessionAuditRecord(draft, {
      approvalDecision: 'approved',
      applyGuard: envelopeValidation.applyGuard,
      cancellationOutcome: 'not_cancelled',
      state: 'failed',
      ...(envelopeValidation.staleReason === undefined ? {} : { staleReason: envelopeValidation.staleReason }),
      toolCalls: [
        { id: `${draft.requestId}-dry-run`, name: AGENT_ADJUSTMENTS_DRY_RUN_TOOL_NAME, status: 'succeeded' },
        { id: `${draft.requestId}-apply`, name: AGENT_ADJUSTMENTS_APPLY_TOOL_NAME, status: 'blocked' },
      ],
    });
    const result: AgentSelectedImageLiveSessionBlockedResult = {
      applyGuard: envelopeValidation.applyGuard,
      audit,
      message: envelopeValidation.message,
      reason: envelopeValidation.reason,
      refresh: refreshAgentSelectedImageLiveSessionContext(draft),
      status: 'blocked',
    };
    if (envelopeValidation.staleReason !== undefined) result.staleReason = envelopeValidation.staleReason;
    return result;
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
      args: envelopeValidation.parsedRequest,
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
      applyGuard: envelopeValidation.applyGuard,
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
    status: 'applied',
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
      approvalId: draft.approvalId,
      applyGuard: receiptPatch.applyGuard,
      applyReceipts: receiptPatch.toolCalls
        .filter((toolCall) => toolCall.name === AGENT_ADJUSTMENTS_APPLY_TOOL_NAME)
        .map((toolCall) => ({
          acceptedPlanHash: draft.dryRun.dryRunPlanHash,
          acceptedPlanId: draft.dryRun.dryRunPlanId,
          graphRevision: receiptPatch.finalGraphRevision ?? draft.snapshot.graphRevision,
          previewHash: receiptPatch.afterPreviewHash,
          recipeHash: receiptPatch.finalRecipeHash,
          status: toolCall.status,
          toolCallId: toolCall.id,
        })),
      beforePreviewHash: draft.snapshot.previewRenderHash,
      cancellationOutcome: receiptPatch.cancellationOutcome,
      dryRunApprovals: [
        {
          approvalId: draft.approvalId,
          approvedGraphRevision: draft.dryRun.sourceGraphRevision,
          approvedRecipeHash: draft.snapshot.recipeHash,
          dryRunPlanHash: draft.dryRun.dryRunPlanHash,
          dryRunPlanId: draft.dryRun.dryRunPlanId,
          state: receiptPatch.approvalDecision,
        },
      ],
      dryRunPlanHash: draft.dryRun.dryRunPlanHash,
      dryRunPlanId: draft.dryRun.dryRunPlanId,
      finalGraphHash: stableTranscriptHash(receiptPatch.finalGraphRevision ?? draft.snapshot.graphRevision),
      finalGraphRevision: receiptPatch.finalGraphRevision,
      finalRecipeHash: receiptPatch.finalRecipeHash,
      initialGraphRevision: draft.snapshot.graphRevision,
      initialRecipeHash: draft.snapshot.recipeHash,
      operationId: draft.operationId,
      previewLineage: [
        {
          graphRevision: draft.snapshot.graphRevision,
          previewArtifactId: draft.snapshot.previewArtifactId,
          purpose: 'accepted_preview',
          recipeHash: draft.snapshot.recipeHash,
          renderHash: draft.snapshot.previewRenderHash,
          sourceToolCallId: `${draft.requestId}-dry-run`,
          sourceToolName: AGENT_ADJUSTMENTS_DRY_RUN_TOOL_NAME,
        },
        ...(receiptPatch.afterPreviewHash === undefined
          ? []
          : [
              {
                graphRevision: receiptPatch.finalGraphRevision ?? draft.snapshot.graphRevision,
                previewArtifactId: `${draft.requestId}-after-preview`,
                purpose: 'refresh' as const,
                recipeHash: receiptPatch.finalRecipeHash ?? draft.snapshot.recipeHash,
                renderHash: receiptPatch.afterPreviewHash,
                sourceToolCallId: `${draft.requestId}-after-preview`,
                sourceToolName: AGENT_PREVIEW_RENDER_TOOL_NAME,
              },
            ]),
      ],
      promptSummary: summarizePrompt(draft.prompt),
      requestId: draft.requestId,
      rollbackCheckpoint: {
        graphRevision: draft.checkpoint.graphRevision,
        previewRecipeHash: draft.checkpoint.previewRecipeHash,
        sessionId: draft.checkpoint.sessionId,
      },
      rollbackGraphRevision: draft.checkpoint.graphRevision,
      selectedImagePath: draft.snapshot.selectedImagePath,
      sessionId: draft.sessionId,
      storageKey: buildAgentSelectedImageLiveSessionAuditStorageKey({
        selectedImagePath: draft.snapshot.selectedImagePath,
        sessionId: draft.sessionId,
      }),
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
        approvalId: toolCall.name === AGENT_ADJUSTMENTS_APPLY_TOOL_NAME ? draft.approvalId : undefined,
        expectedGraphRevision: draft.snapshot.graphRevision,
        expectedRecipeHash: draft.snapshot.recipeHash,
        operationId: draft.operationId,
        previewArtifactId: draft.snapshot.previewArtifactId,
        selectedImagePath: draft.snapshot.selectedImagePath,
        sessionId: draft.sessionId,
      }),
      approvalId: toolCall.name === AGENT_ADJUSTMENTS_APPLY_TOOL_NAME ? draft.approvalId : undefined,
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
      approvalId: draft.approvalId,
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
      approvalId: draft.approvalId,
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

export const buildAgentSelectedImagePreviewLoopAuditRecord = ({
  request,
  result,
}: {
  request: AgentCurrentImagePreviewLoopRequest;
  result: AgentCurrentImagePreviewLoopResult;
}): AgentSelectedImageLiveSessionAuditRecord => {
  const latestApplyReceipt = result.applyReceipts.at(-1);
  const latestPreview = result.previewLineage.at(-1);
  const firstDryRunApproval = request.dryRunApprovals[0];
  if (latestApplyReceipt === undefined || latestPreview === undefined) {
    throw new Error('Selected-image preview-loop audit requires apply and preview lineage receipts.');
  }
  if (firstDryRunApproval === undefined) {
    throw new Error('Selected-image preview-loop audit requires dry-run approval lineage.');
  }

  const approvalId = `approval_${request.requestId}`.replaceAll(/[^A-Za-z0-9_-]/gu, '_');
  const toolCalls: AgentSelectedImageLiveSessionReceipt['toolCalls'] = [
    ...request.dryRunApprovals.map((approval) => ({
      id: approval.acceptedPlanId,
      name: AGENT_ADJUSTMENTS_DRY_RUN_TOOL_NAME,
      status: 'succeeded' as const,
    })),
    ...result.applyReceipts.map((receipt) => ({
      id: receipt.requestId,
      name: AGENT_ADJUSTMENTS_APPLY_TOOL_NAME,
      status: 'succeeded' as const,
    })),
    ...result.previewLineage.map((lineage, index) => ({
      id: `${result.requestId}-preview-${index + 1}`,
      name: AGENT_PREVIEW_RENDER_TOOL_NAME,
      status: 'succeeded' as const,
    })),
  ];
  const previewLineage = [
    {
      graphRevision: result.initialGraphRevision,
      previewArtifactId: result.initialPreviewArtifactId,
      previewRef: result.initialPreviewReceipt.preview.previewRef,
      purpose: 'accepted_preview' as const,
      recipeHash: result.initialRecipeHash,
      renderHash: result.initialPreviewReceipt.preview.renderHash,
      sourceToolCallId: `${request.requestId}-initial-preview`,
      sourceToolName: result.initialPreviewReceipt.toolName,
      turn: 1,
    },
    ...result.previewLineage.map((lineage, index) => ({
      graphRevision: lineage.appliedGraphRevision,
      previewArtifactId: lineage.previewArtifactId,
      previewRef: lineage.previewRef,
      purpose: lineage.previewPurpose,
      recipeHash: lineage.recipeHash,
      renderHash: lineage.renderHash,
      sourceToolCallId: result.applyReceipts[index]?.requestId,
      sourceToolName: lineage.sourceToolName,
      turn: lineage.turn,
    })),
  ];
  const receipt = agentSelectedImageLiveSessionReceiptSchema.parse({
    acceptedPreviewArtifactId: result.initialPreviewArtifactId,
    afterPreviewHash: latestPreview.renderHash ?? result.finalRecipeHash,
    approvalDecision: 'approved',
    approvalId,
    applyGuard: {
      acceptedPreviewArtifactId: result.initialPreviewArtifactId,
      currentGraphRevision: result.initialGraphRevision,
      currentPreviewArtifactId: result.initialPreviewArtifactId,
      currentPreviewHeight: result.selectedImage.height,
      currentPreviewIdentity: result.previewIdentity,
      currentPreviewWidth: result.selectedImage.width,
      currentRecipeHash: result.initialRecipeHash,
      currentSelectedImagePath: result.selectedImagePath,
      expectedGraphRevision: request.expectedGraphRevision,
      expectedPreviewArtifactId: result.initialPreviewArtifactId,
      expectedPreviewHeight: request.expectedPreviewHeight,
      expectedPreviewIdentity: request.expectedPreviewIdentity,
      expectedPreviewWidth: request.expectedPreviewWidth,
      expectedRecipeHash: request.expectedRecipeHash,
      expectedSelectedImagePath: request.selectedImagePath,
      status: 'passed',
    },
    applyReceipts: result.applyReceipts.map((receipt) => ({
      acceptedPlanHash: receipt.acceptedPlanHash,
      acceptedPlanId: receipt.acceptedPlanId,
      graphRevision: receipt.appliedGraphRevision,
      recipeHash: result.previewLineage.find((lineage) => lineage.turn === receipt.turn)?.recipeHash,
      status: 'succeeded',
      toolCallId: receipt.requestId,
      turn: receipt.turn,
    })),
    beforePreviewHash: result.initialPreviewReceipt.preview.renderHash,
    cancellationOutcome: 'not_cancelled',
    dryRunApprovals: request.dryRunApprovals.map((approval) => ({
      approvalId,
      approvedGraphRevision: approval.expectedGraphRevision,
      approvedRecipeHash: request.expectedRecipeHash,
      dryRunPlanHash: approval.acceptedPlanHash,
      dryRunPlanId: approval.acceptedPlanId,
      state: approval.approvalState,
      turn: approval.turn,
    })),
    dryRunPlanHash: firstDryRunApproval.acceptedPlanHash,
    dryRunPlanId: firstDryRunApproval.acceptedPlanId,
    finalGraphHash: stableTranscriptHash(result.finalGraphRevision),
    finalGraphRevision: result.finalGraphRevision,
    finalRecipeHash: result.finalRecipeHash,
    initialGraphRevision: result.initialGraphRevision,
    initialRecipeHash: result.initialRecipeHash,
    operationId: request.operationId,
    previewLineage,
    promptSummary: summarizePrompt(request.prompt),
    requestId: request.requestId,
    rollbackCheckpoint: result.rollbackCheckpoint,
    rollbackGraphRevision: result.rollbackCheckpoint.graphRevision,
    rollbackReceiptGraphRevision: result.rollbackReceipt?.graphRevision,
    selectedImagePath: result.selectedImagePath,
    sessionId: request.sessionId,
    storageKey: buildAgentSelectedImageLiveSessionAuditStorageKey({
      selectedImagePath: result.selectedImagePath,
      sessionId: request.sessionId,
    }),
    state: 'applied',
    toolCalls,
  });
  const transcript: AgentSelectedImageLiveSessionTranscriptEntry[] = [
    {
      acceptedPreviewArtifactId: result.initialPreviewArtifactId,
      approvalId,
      graphRevision: result.initialGraphRevision,
      id: `${request.requestId}-accepted-preview`,
      kind: 'preview',
      previewArtifactId: result.initialPreviewArtifactId,
      recipeHash: result.initialRecipeHash,
      resultHash: result.initialPreviewReceipt.contentHash,
      status: 'succeeded',
    },
    ...toolCalls.flatMap((toolCall): AgentSelectedImageLiveSessionTranscriptEntry[] => [
      {
        argumentsHash: stableTranscriptHash({ requestId: toolCall.id, selectedImagePath: result.selectedImagePath }),
        approvalId: toolCall.name === AGENT_ADJUSTMENTS_APPLY_TOOL_NAME ? approvalId : undefined,
        graphRevision: result.initialGraphRevision,
        id: `${toolCall.id}-call`,
        kind: 'tool_call',
        previewArtifactId: result.initialPreviewArtifactId,
        recipeHash: result.initialRecipeHash,
        status: toolCall.status,
        toolCallId: toolCall.id,
        toolName: toolCall.name,
      },
      {
        graphRevision: result.finalGraphRevision,
        id: `${toolCall.id}-result`,
        kind: 'tool_result',
        previewArtifactId: latestPreview.previewArtifactId,
        recipeHash: result.finalRecipeHash,
        resultHash: stableTranscriptHash(toolCall),
        status: toolCall.status,
        toolCallId: toolCall.id,
        toolName: toolCall.name,
      },
    ]),
    {
      acceptedPreviewArtifactId: result.initialPreviewArtifactId,
      approvalId,
      graphRevision: result.initialGraphRevision,
      id: `${request.requestId}-approval-decision`,
      kind: 'approval',
      previewArtifactId: result.initialPreviewArtifactId,
      recipeHash: result.initialRecipeHash,
      resultHash: stableTranscriptHash(request.dryRunApprovals),
      status: 'succeeded',
    },
    {
      acceptedPreviewArtifactId: result.initialPreviewArtifactId,
      approvalId,
      graphRevision: result.finalGraphRevision,
      id: `${request.requestId}-apply-decision`,
      kind: 'apply_decision',
      previewArtifactId: latestPreview.previewArtifactId,
      recipeHash: result.finalRecipeHash,
      resultHash: stableTranscriptHash(result.applyReceipts),
      status: 'succeeded',
      toolCallId: latestApplyReceipt.requestId,
      toolName: AGENT_ADJUSTMENTS_APPLY_TOOL_NAME,
    },
  ];

  return agentSelectedImageLiveSessionAuditRecordSchema.parse({
    auditEvents: result.auditEventSummary.map((event, index) => ({
      graphRevision: event.graphRevision,
      id: `${request.requestId}-audit-${index + 1}`,
      message: `${event.type}: ${event.toolName}`,
      recipeHash: event.recipeHash,
      state: 'applied',
      toolName: event.toolName,
    })),
    receipt,
    replayState: 'replayable',
    schemaVersion: 1,
    transcript,
  });
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
    if (receipt.approvalId === undefined) {
      throw new Error('Selected-image live session audit replay rejected applied receipt without approval id.');
    }
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

export const preflightAgentSelectedImageLiveSessionAuditReplay = (
  audit: AgentSelectedImageLiveSessionAuditRecord,
): AgentSelectedImageLiveSessionReplayPreflight => {
  const receipt = replayAgentSelectedImageLiveSessionAudit(audit);
  const current = buildSnapshot();
  const staleReason = getAgentSelectedImageLiveSessionReplayStaleReason(receipt, current);

  return agentSelectedImageLiveSessionReplayPreflightSchema.parse({
    currentGraphRevision: current.graphRevision,
    currentPreviewArtifactId: current.previewArtifactId,
    currentRecipeHash: current.recipeHash,
    currentSelectedImagePath: current.selectedImagePath,
    expectedGraphRevision: receipt.initialGraphRevision,
    expectedPreviewArtifactId: receipt.acceptedPreviewArtifactId,
    expectedRecipeHash: receipt.initialRecipeHash,
    expectedSelectedImagePath: receipt.selectedImagePath,
    replayPreviewHash: receipt.afterPreviewHash ?? receipt.beforePreviewHash,
    sessionId: receipt.sessionId,
    staleReason: staleReason ?? undefined,
    status: staleReason === null ? 'ready' : 'stale',
    toolCallCount: receipt.toolCalls.length,
  });
};

export const buildAgentSelectedImageLiveSessionAuditExportReceipt = ({
  audit,
  exportedAt = new Date().toISOString(),
  replayPreflight,
}: {
  audit: AgentSelectedImageLiveSessionAuditRecord;
  exportedAt?: string;
  replayPreflight: AgentSelectedImageLiveSessionReplayPreflight;
}): AgentSelectedImageLiveSessionAuditExportReceipt => {
  const parsedAudit = agentSelectedImageLiveSessionAuditRecordSchema.parse(audit);
  const receipt = parsedAudit.receipt;
  const selectedImageStableHash = stableTranscriptHash(receipt.selectedImagePath);
  const selectedImageToken = `hash:${selectedImageStableHash}`;
  const currentPreviewIdentityToken =
    receipt.applyGuard?.currentPreviewIdentity === undefined || receipt.applyGuard.currentPreviewIdentity === null
      ? null
      : `hash:${stableTranscriptHash(receipt.applyGuard.currentPreviewIdentity)}`;
  const expectedPreviewIdentityToken =
    receipt.applyGuard?.expectedPreviewIdentity === undefined || receipt.applyGuard.expectedPreviewIdentity === null
      ? null
      : `hash:${stableTranscriptHash(receipt.applyGuard.expectedPreviewIdentity)}`;
  const sanitizedReplayPreflight = agentSelectedImageLiveSessionReplayPreflightSchema.parse({
    ...replayPreflight,
    currentSelectedImagePath: selectedImageToken,
    expectedSelectedImagePath: selectedImageToken,
  });
  const sanitizedReceipt = agentSelectedImageLiveSessionReceiptSchema.parse({
    ...receipt,
    applyGuard:
      receipt.applyGuard === undefined
        ? undefined
        : {
            ...receipt.applyGuard,
            currentSelectedImagePath: selectedImageToken,
            currentPreviewIdentity: currentPreviewIdentityToken,
            expectedPreviewIdentity: expectedPreviewIdentityToken,
            expectedSelectedImagePath: selectedImageToken,
          },
    previewLineage: receipt.previewLineage?.map(({ previewRef: _previewRef, ...lineage }) => lineage),
    selectedImagePath: selectedImageToken,
    storageKey: buildAgentSelectedImageLiveSessionAuditStorageKey({
      selectedImagePath: selectedImageToken,
      sessionId: receipt.sessionId,
    }),
  });
  const sanitizedAudit = agentSelectedImageLiveSessionAuditRecordSchema.parse({
    ...parsedAudit,
    receipt: sanitizedReceipt,
  });
  const requestIds = Array.from(
    new Set([
      receipt.requestId,
      ...receipt.toolCalls.map((toolCall) => toolCall.id),
      ...parsedAudit.auditEvents.map((event) => event.toolCallId).filter((id): id is string => id !== undefined),
    ]),
  );
  const toolNames = Array.from(new Set(receipt.toolCalls.map((toolCall) => toolCall.name)));
  const rollbackReceipt = receipt.rollbackReceiptGraphRevision;

  return agentSelectedImageLiveSessionAuditExportReceiptSchema.parse({
    auditRecord: sanitizedAudit,
    exportedAt,
    graphRevisions: {
      final: receipt.finalGraphRevision,
      initial: receipt.initialGraphRevision,
      rollbackCheckpoint: receipt.rollbackGraphRevision,
      rollbackReceipt,
    },
    kind: 'agent.selectedImageLiveSession.auditReceipt',
    previewHashes: {
      after: receipt.afterPreviewHash,
      before: receipt.beforePreviewHash,
      lineage: receipt.previewLineage?.map((lineage) => ({
        graphRevision: lineage.graphRevision,
        previewArtifactId: lineage.previewArtifactId,
        purpose: lineage.purpose,
        renderHash: lineage.renderHash,
      })),
    },
    replayPreflight: sanitizedReplayPreflight,
    requestIds,
    rollbackState: {
      checkpointGraphRevision: receipt.rollbackGraphRevision,
      receiptGraphRevision: rollbackReceipt,
      state: receipt.state,
      status:
        receipt.state === 'rolled_back'
          ? 'restored'
          : receipt.rollbackCheckpoint === undefined
            ? 'unavailable'
            : 'available',
    },
    schemaVersion: 1,
    selectedImage: {
      basename: getPathBasename(receipt.selectedImagePath),
      stableHash: selectedImageStableHash,
    },
    sessionId: receipt.sessionId,
    toolNames,
  });
};

const getAgentSelectedImageLiveSessionReplayStaleReason = (
  receipt: AgentSelectedImageLiveSessionReceipt,
  current: z.infer<typeof selectedImageLiveSessionSnapshotSchema>,
): AgentSelectedImageLiveSessionStaleReason | null => {
  if (current.selectedImagePath !== receipt.selectedImagePath) return 'image_changed';
  if (current.graphRevision !== receipt.initialGraphRevision) return 'graph_revision_changed';
  if (current.recipeHash !== receipt.initialRecipeHash) return 'recipe_hash_changed';
  if (current.previewArtifactId !== receipt.acceptedPreviewArtifactId) return 'preview_artifact_changed';
  return null;
};

const verifyAgentSelectedImageAuditReceiptLineage = (audit: AgentSelectedImageLiveSessionAuditRecord): void => {
  const receipt = audit.receipt;
  if (receipt.schemaVersion !== 1) {
    throw new Error('Selected-image audit receipt rejected unsupported schema version.');
  }

  const previewLineage = receipt.previewLineage ?? [];
  if (previewLineage.length > 0) {
    const acceptedPreview = previewLineage[0];
    if (
      acceptedPreview?.previewArtifactId !== receipt.acceptedPreviewArtifactId ||
      acceptedPreview.recipeHash !== receipt.initialRecipeHash ||
      acceptedPreview.graphRevision !== receipt.initialGraphRevision
    ) {
      throw new Error('Selected-image audit receipt rejected mismatched accepted preview lineage.');
    }
    if (
      receipt.afterPreviewHash !== undefined &&
      !previewLineage.some((lineage) => lineage.renderHash === receipt.afterPreviewHash)
    ) {
      throw new Error('Selected-image audit receipt rejected missing after-preview lineage.');
    }
  }

  const dryRunApprovals = receipt.dryRunApprovals ?? [];
  if (dryRunApprovals.length > 0) {
    const planIds = new Set(dryRunApprovals.map((approval) => approval.dryRunPlanId));
    if (!planIds.has(receipt.dryRunPlanId)) {
      throw new Error('Selected-image audit receipt rejected missing dry-run approval lineage.');
    }
    for (const approval of dryRunApprovals) {
      if (approval.approvedRecipeHash !== receipt.initialRecipeHash) {
        throw new Error('Selected-image audit receipt rejected stale dry-run approval recipe hash.');
      }
    }
  }

  const toolCallIds = new Set(receipt.toolCalls.map((toolCall) => toolCall.id));
  for (const applyReceipt of receipt.applyReceipts ?? []) {
    if (!toolCallIds.has(applyReceipt.toolCallId)) {
      throw new Error('Selected-image audit receipt rejected apply receipt without matching tool call.');
    }
  }

  if (receipt.rollbackCheckpoint !== undefined) {
    if (
      receipt.rollbackCheckpoint.graphRevision !== receipt.rollbackGraphRevision ||
      receipt.rollbackCheckpoint.sessionId !== receipt.sessionId
    ) {
      throw new Error('Selected-image audit receipt rejected mismatched rollback checkpoint.');
    }
  }

  if (receipt.finalGraphRevision !== undefined && receipt.finalGraphHash === undefined) {
    throw new Error('Selected-image audit receipt rejected final graph revision without hash.');
  }
};

const verifyAgentSelectedImageLiveSessionTranscript = (audit: AgentSelectedImageLiveSessionAuditRecord): void => {
  verifyAgentSelectedImageAuditReceiptLineage(audit);
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
  if (audit.receipt.state === 'applied' && applyDecision.approvalId !== audit.receipt.approvalId) {
    throw new Error('Selected-image live session audit replay rejected mismatched apply approval id.');
  }
};
