import { z } from 'zod';
import {
  RAW_ENGINE_AGENT_SELECTED_IMAGE_PROPOSAL_RENDER_TOOL_NAME,
  type RawEngineAgentSelectedImageProposalReceiptV1,
  type RawEngineAgentSelectedImageProposalRenderCommandV1,
  rawEngineAgentSelectedImageProposalArtifactV1Schema,
  rawEngineAgentSelectedImageProposalReceiptV1Schema,
} from '../../../../packages/rawengine-schema/src/agentSelectedImageProposalSchemas';
import { agentReviewedAdjustmentCommandReceiptSchema } from '../../../schemas/agent/agentReviewedCommandSchemas';
import type { RawEngineAppServerToolDispatchRequest } from '../../../schemas/agent/agentRuntimeSchemas';
import {
  type AgentSelectedImageProposalLineageV1,
  agentSelectedImageProposalIterationStateV1Schema,
  agentSelectedImageProposalLineageV1Schema,
} from '../../../schemas/agent/agentSelectedImageProposalIterationSchemas';
import {
  type AgentSelectedImageRecoveryReceipt,
  type AgentSelectedImageRecoveryStaleReason,
  type AgentSelectedImageRollbackReadiness,
  agentSelectedImageRecoveryReceiptSchema,
  agentSelectedImageRecoveryStaleReasonSchema,
  agentSelectedImageRollbackReadinessSchema,
} from '../../../schemas/agent/agentSelectedImageRecoverySchemas';
import { useEditorStore } from '../../../store/useEditorStore';
import {
  buildAgentReviewedAdjustmentCommandPlan,
  DEFAULT_AGENT_REVIEWED_ADJUSTMENT_COMMAND_ID,
} from '../agentReviewedAdjustmentCommands';
import type {
  AgentCurrentImagePreviewLoopRequest,
  AgentCurrentImagePreviewLoopResult,
} from '../context/agentCurrentImagePreviewLoop';
import { buildAgentImageContextSnapshot } from '../context/agentImageContextSnapshot';
import {
  AGENT_PREVIEW_RENDER_TOOL_NAME,
  agentPreviewRenderResponseSchema,
  RAW_ENGINE_IMAGE_GET_PREVIEW_TOOL_NAME,
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
import {
  addAgentSelectedImageProposalIteration,
  assertAgentSelectedImageProposalApplyable,
  createAgentSelectedImageProposalLineage,
  transitionAgentSelectedImageProposalIteration,
} from './agentSelectedImageProposalLineage';
import {
  AGENT_HISTORY_ROLLBACK_TOOL_NAME,
  type AgentSessionCheckpoint,
  agentHistoryRollbackResponseSchema,
  createAgentSessionCheckpoint,
} from './agentSessionHistory';
import { createAgentTypedToolExecutionContext, dispatchAgentTypedEditorTool } from './agentTypedToolDispatch';

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
export type AgentSelectedImageLiveSessionStaleReason = AgentSelectedImageRecoveryStaleReason;
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
    previewRef: z.string().trim().min(1),
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
    recoveryRequestId: z.string().trim().min(1).optional(),
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
    staleReason: agentSelectedImageRecoveryStaleReasonSchema.optional(),
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
    staleReason: agentSelectedImageRecoveryStaleReasonSchema.optional(),
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
    kind: z.enum([
      'apply_decision',
      'approval',
      'error',
      'preview',
      'recovery',
      'rollback',
      'tool_call',
      'tool_result',
    ]),
    previewArtifactId: z.string().trim().min(1).optional(),
    recipeHash: z.string().trim().min(1).optional(),
    recoveryRequestId: z.string().trim().min(1).optional(),
    resultHash: z.string().trim().min(1).optional(),
    rollbackGraphRevision: z.string().trim().min(1).optional(),
    staleReason: agentSelectedImageRecoveryStaleReasonSchema.optional(),
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
    proposalLineage: agentSelectedImageProposalLineageV1Schema.optional(),
    previewLineage: z.array(selectedImageLiveSessionPreviewLineageSchema).optional(),
    promptSummary: z.string().trim().min(1).default('Selected-image edit'),
    recoveries: z.array(agentSelectedImageRecoveryReceiptSchema).optional(),
    requestId: z.string().trim().min(1),
    reviewedCommand: agentReviewedAdjustmentCommandReceiptSchema.optional(),
    rollbackCheckpoint: selectedImageLiveSessionRollbackCheckpointSchema.optional(),
    rollbackGraphRevision: z.string().trim().min(1),
    rollbackReceiptGraphRevision: z.string().trim().min(1).optional(),
    rollbackReceiptPreviewHash: z.string().trim().min(1).optional(),
    rollbackReceiptRecipeHash: z.string().trim().min(1).optional(),
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
    staleReason: agentSelectedImageRecoveryStaleReasonSchema.optional(),
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
    staleReason: agentSelectedImageRecoveryStaleReasonSchema.optional(),
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
        rollback: z.string().trim().min(1).optional(),
      })
      .strict(),
    proposalLineage: z
      .object({
        epoch: z.number().int().nonnegative(),
        iterations: z
          .array(
            z
              .object({
                iterationId: z.string().trim().min(1),
                proposalHash: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
                state: agentSelectedImageProposalIterationStateV1Schema,
              })
              .strict(),
          )
          .min(1),
        lineageId: z.string().trim().min(1),
        sealedIterationId: z.string().trim().min(1).optional(),
      })
      .strict()
      .optional(),
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
  proposal?: RawEngineAgentSelectedImageProposalReceiptV1;
  proposalLineage: AgentSelectedImageProposalLineageV1;
  operationId: string;
  prompt: string;
  recovery?: {
    blockedAudit: AgentSelectedImageLiveSessionAuditRecord;
    receipt: AgentSelectedImageRecoveryReceipt;
  };
  requestId: string;
  reviewedCommand: z.infer<typeof agentReviewedAdjustmentCommandReceiptSchema>;
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
    previewRef: snapshot.initialPreview.previewRef,
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

const stableLegacySha256 = (value: unknown): `sha256:${string}` => {
  const shortHash = stableTranscriptHash(value).slice('sha256:'.length);
  return `sha256:${shortHash.repeat(4)}`;
};

const upgradeLegacyDryRunToProposalLineage = (draft: AgentSelectedImageLiveSessionDraft): void => {
  if (draft.proposalLineage.iterations.length > 0) return;
  const createdAt = new Date().toISOString();
  const expiresAt = new Date(Date.parse(createdAt) + 5 * 60_000).toISOString();
  const iterationId = `${draft.proposalLineage.lineageId}-iteration-1`;
  const proposalId = `${draft.requestId}-legacy-proposal`;
  const previewContentHash = stableLegacySha256({
    artifactId: draft.snapshot.previewArtifactId,
    renderHash: draft.snapshot.previewRenderHash,
  });
  draft.proposalLineage = addAgentSelectedImageProposalIteration(draft.proposalLineage, {
    baseGraphRevision: draft.snapshot.graphRevision,
    basePreviewArtifactId: draft.snapshot.previewArtifactId,
    basePreviewContentHash: previewContentHash,
    baseRecipeHash: draft.snapshot.recipeHash,
    beforePreviewArtifactId: draft.snapshot.previewArtifactId,
    beforePreviewContentHash: previewContentHash,
    cleanupStatus: 'not_required',
    createdAt,
    expiresAt,
    initiatingTurnId: `${draft.requestId}-dry-run`,
    iterationId,
    lineageId: draft.proposalLineage.lineageId,
    ordinal: 1,
    proposalHash: stableLegacySha256({ dryRunPlanHash: draft.dryRun.dryRunPlanHash, proposalId }),
    proposalId,
    proposalSchemaVersion: 1,
    schemaVersion: 1,
    selectedImageId: stableLegacySha256(draft.snapshot.selectedImagePath),
    sessionId: draft.sessionId,
    state: 'draft',
    toolCalls: [{ callId: `${draft.requestId}-dry-run`, type: 'proposal_render' }],
  });
  draft.proposalLineage = transitionAgentSelectedImageProposalIteration(
    draft.proposalLineage,
    iterationId,
    'rendering',
    { expectedEpoch: draft.proposalLineage.epoch, now: createdAt },
  );
  draft.proposalLineage = transitionAgentSelectedImageProposalIteration(draft.proposalLineage, iterationId, 'ready', {
    expectedEpoch: draft.proposalLineage.epoch,
    now: createdAt,
  });
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

export const getAgentSelectedImageLiveSessionRollbackReadiness = ({
  audit,
  checkpoint,
}: {
  audit: AgentSelectedImageLiveSessionAuditRecord;
  checkpoint: AgentSessionCheckpoint;
}): AgentSelectedImageRollbackReadiness => {
  const receipt = agentSelectedImageLiveSessionAuditRecordSchema.parse(audit).receipt;
  const expectedGraphRevision = receipt.finalGraphRevision;
  const expectedRecipeHash = receipt.finalRecipeHash;
  const blocked = (
    reason: Exclude<AgentSelectedImageRollbackReadiness['reason'], undefined>,
    current?: z.infer<typeof selectedImageLiveSessionSnapshotSchema>,
  ): AgentSelectedImageRollbackReadiness =>
    agentSelectedImageRollbackReadinessSchema.parse({
      currentGraphRevision: current?.graphRevision,
      currentRecipeHash: current?.recipeHash,
      expectedGraphRevision,
      expectedRecipeHash,
      reason,
      status: 'blocked',
    });

  if (receipt.state === 'rolled_back' || receipt.rollbackReceiptGraphRevision !== undefined) {
    return blocked('already_rolled_back');
  }
  if (
    receipt.state !== 'applied' ||
    receipt.applyGuard?.status !== 'passed' ||
    expectedGraphRevision === undefined ||
    expectedRecipeHash === undefined
  ) {
    return blocked('apply_not_verified');
  }
  if (
    checkpoint.sessionId !== receipt.sessionId ||
    checkpoint.graphRevision !== receipt.rollbackGraphRevision ||
    checkpoint.activeImagePath !== receipt.selectedImagePath
  ) {
    return blocked('checkpoint_mismatch');
  }

  let current: z.infer<typeof selectedImageLiveSessionSnapshotSchema>;
  try {
    current = buildSnapshot();
  } catch {
    return blocked('missing_selection');
  }
  if (current.selectedImagePath !== receipt.selectedImagePath) return blocked('stale_selection', current);
  if (current.graphRevision !== expectedGraphRevision) return blocked('stale_graph_revision', current);
  if (current.recipeHash !== expectedRecipeHash) return blocked('stale_recipe_hash', current);

  return agentSelectedImageRollbackReadinessSchema.parse({
    currentGraphRevision: current.graphRevision,
    currentRecipeHash: current.recipeHash,
    expectedGraphRevision,
    expectedRecipeHash,
    status: 'safe',
  });
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
  const sealed = draft.proposalLineage.iterations.find(
    (iteration) => iteration.iterationId === draft.proposalLineage.sealedIterationId,
  );
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
    sealed === undefined ||
    request.proposalLineage?.acceptedProposalHash !== sealed.proposalHash ||
    request.proposalLineage?.acceptedProposalId !== sealed.proposalId ||
    request.proposalLineage?.lineageEpoch !== draft.proposalLineage.epoch ||
    request.proposalLineage?.lineageId !== draft.proposalLineage.lineageId ||
    request.proposalLineage?.sealedIterationId !== sealed.iterationId ||
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
  reviewedCommand,
  sessionId,
}: {
  adjustments: AgentAdjustmentsApplyRequest['adjustments'];
  operationId: string;
  prompt: string;
  requestId: string;
  reviewedCommand: z.infer<typeof agentReviewedAdjustmentCommandReceiptSchema>;
  sessionId: string;
}): Promise<AgentSelectedImageLiveSessionDraft> => {
  const snapshot = buildSnapshot();
  const dryRun = agentAdjustmentsDryRunResponseSchema.parse(
    await dispatchAgentTypedEditorTool({
      args: {
        adjustments,
        expectedGraphRevision: snapshot.graphRevision,
        expectedRecipeHash: snapshot.recipeHash,
        operationId,
        requestId: `${requestId}-dry-run`,
        sessionId,
      },
      context: createAgentTypedToolExecutionContext({
        arguments: {
          adjustments,
          expectedGraphRevision: snapshot.graphRevision,
          expectedRecipeHash: snapshot.recipeHash,
          operationId,
          requestId: `${requestId}-dry-run`,
          sessionId,
        },
        callId: `${requestId}-dry-run`,
        requestId: `${requestId}-dry-run`,
        sessionId,
      }),
      toolName: AGENT_ADJUSTMENTS_DRY_RUN_TOOL_NAME,
    }),
  );
  const draft: AgentSelectedImageLiveSessionDraft = {
    adjustments,
    auditEvents: [],
    checkpoint: createAgentSessionCheckpoint(sessionId),
    dryRun,
    operationId,
    prompt,
    proposalLineage: createAgentSelectedImageProposalLineage({
      lineageId: `lineage_${sessionId}_${requestId}`.replaceAll(/[^A-Za-z0-9_-]/gu, '_'),
      sessionId,
    }),
    requestId,
    reviewedCommand: agentReviewedAdjustmentCommandReceiptSchema.parse(
      reviewedCommand ??
        buildAgentReviewedAdjustmentCommandPlan({
          commandId: DEFAULT_AGENT_REVIEWED_ADJUSTMENT_COMMAND_ID,
          sourceAdjustments: useEditorStore.getState().adjustments,
        }).receipt,
    ),
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

export const renderAgentSelectedImageLiveSessionProposal = async (
  draft: AgentSelectedImageLiveSessionDraft,
): Promise<RawEngineAgentSelectedImageProposalReceiptV1> => {
  const previewRequestId = `${draft.requestId}-proposal-before`;
  const preview = await dispatchAgentTypedEditorTool({
    args: { expectedRecipeHash: draft.snapshot.recipeHash, requestId: previewRequestId },
    context: createAgentTypedToolExecutionContext({
      arguments: { expectedRecipeHash: draft.snapshot.recipeHash, requestId: previewRequestId },
      callId: previewRequestId,
      parentCallId: `${draft.requestId}-dry-run`,
      requestId: previewRequestId,
      sessionId: draft.sessionId,
    }),
    toolName: RAW_ENGINE_IMAGE_GET_PREVIEW_TOOL_NAME,
  });
  const callId = `${draft.requestId}-proposal`;
  const context = createAgentTypedToolExecutionContext({
    arguments: {
      expectedGraphRevision: draft.snapshot.graphRevision,
      expectedRecipeHash: draft.snapshot.recipeHash,
      expectedSelectedImagePath: draft.snapshot.selectedImagePath,
    },
    callId,
    parentCallId: `${draft.requestId}-dry-run`,
    requestId: callId,
    sessionId: draft.sessionId,
  });
  const baseAttachment = preview.attachment.attachment;
  const command: RawEngineAgentSelectedImageProposalRenderCommandV1 = {
    basePreview: rawEngineAgentSelectedImageProposalArtifactV1Schema.parse({
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
    }),
    cancellationId: context.cancellationId,
    commandType: RAW_ENGINE_AGENT_SELECTED_IMAGE_PROPOSAL_RENDER_TOOL_NAME,
    deadlineAt: context.deadlineAt,
    dryRun: true,
    dryRunPlan: {
      planHash: draft.dryRun.dryRunPlanHash,
      planId: draft.dryRun.dryRunPlanId,
      predictedGraphRevision: draft.dryRun.predictedGraphRevision,
    },
    edit: { kind: 'basic_tone_v1' as const, patch: draft.adjustments },
    expectedGraphRevision: draft.snapshot.graphRevision,
    expectedRecipeHash: draft.snapshot.recipeHash,
    expectedRenderHash: draft.snapshot.previewRenderHash,
    expectedSelectedImagePath: draft.snapshot.selectedImagePath,
    idempotencyKey: context.idempotencyKey,
    lineage: { callId, parentCallId: `${draft.requestId}-dry-run` },
    operationId: draft.operationId,
    requestedPreview: { longEdgePx: 1536, maxBytes: 8 * 1024 * 1024, quality: 0.86 },
    requestId: callId,
    sessionId: draft.sessionId,
  };
  const receipt = rawEngineAgentSelectedImageProposalReceiptV1Schema.parse(
    await dispatchAgentTypedEditorTool({
      args: command,
      context,
      draftSession: buildDraftSession(draft, 'active'),
      toolName: RAW_ENGINE_AGENT_SELECTED_IMAGE_PROPOSAL_RENDER_TOOL_NAME,
    }),
  );
  draft.proposal = receipt;
  const lineageId = draft.proposalLineage.lineageId;
  const iterationId = `${lineageId}-iteration-${draft.proposalLineage.iterations.length + 1}`;
  const parent = draft.proposalLineage.iterations.at(-1);
  draft.proposalLineage = addAgentSelectedImageProposalIteration(draft.proposalLineage, {
    ...(receipt.artifacts === undefined
      ? {}
      : {
          afterPreviewArtifactId: receipt.artifacts.after.artifactId,
          afterPreviewContentHash: receipt.artifacts.after.contentHash,
        }),
    baseGraphRevision: receipt.base.graphRevision,
    basePreviewArtifactId: receipt.base.previewArtifactId,
    basePreviewContentHash: receipt.base.previewContentHash,
    baseRecipeHash: receipt.base.recipeHash,
    beforePreviewArtifactId: receipt.base.previewArtifactId,
    beforePreviewContentHash: receipt.base.previewContentHash,
    cleanupStatus: 'not_required',
    createdAt: receipt.createdAt,
    expiresAt: receipt.expiresAt,
    initiatingTurnId: receipt.lineage.parentCallId ?? receipt.lineage.callId,
    iterationId,
    lineageId,
    ordinal: draft.proposalLineage.iterations.length + 1,
    ...(parent === undefined ? {} : { parentIterationId: parent.iterationId, parentProposalId: parent.proposalId }),
    proposalHash: receipt.proposalHash,
    proposalId: receipt.proposalId,
    proposalSchemaVersion: receipt.schemaVersion,
    ...(parent?.state === 'stale' ? { recoveredFromIterationId: parent.iterationId } : {}),
    schemaVersion: 1,
    selectedImageId: receipt.base.selectedImageId,
    sessionId: draft.sessionId,
    state: 'draft',
    toolCalls: [
      { callId: previewRequestId, parentCallId: `${draft.requestId}-dry-run`, type: 'preview_acquire' },
      {
        callId: receipt.lineage.callId,
        ...(receipt.lineage.parentCallId === undefined ? {} : { parentCallId: receipt.lineage.parentCallId }),
        type: 'proposal_render',
      },
    ],
  });
  draft.proposalLineage = transitionAgentSelectedImageProposalIteration(
    draft.proposalLineage,
    iterationId,
    'rendering',
    {
      expectedEpoch: draft.proposalLineage.epoch,
      now: receipt.createdAt,
    },
  );
  draft.proposalLineage = transitionAgentSelectedImageProposalIteration(
    draft.proposalLineage,
    iterationId,
    receipt.status === 'ready' && receipt.artifacts !== undefined ? 'ready' : 'failed',
    { expectedEpoch: draft.proposalLineage.epoch, now: receipt.createdAt, terminalReason: receipt.status },
  );
  if (receipt.status !== 'ready' || receipt.artifacts === undefined) draft.state = 'failed';
  return receipt;
};

export const recoverAgentSelectedImageLiveSessionDryRun = async ({
  adjustments,
  blockedResult,
  operationId,
  prompt,
  recoveryRequestId,
  reviewedCommand,
  sessionId,
}: {
  adjustments: AgentAdjustmentsApplyRequest['adjustments'];
  blockedResult: AgentSelectedImageLiveSessionBlockedResult;
  operationId: string;
  prompt: string;
  recoveryRequestId: string;
  reviewedCommand: z.infer<typeof agentReviewedAdjustmentCommandReceiptSchema>;
  sessionId: string;
}): Promise<AgentSelectedImageLiveSessionDraft> => {
  if (blockedResult.staleReason === undefined) {
    throw new Error('Selected-image recovery requires a stale blocked apply receipt.');
  }
  const draft = await startAgentSelectedImageLiveSessionDryRun({
    adjustments,
    operationId,
    prompt,
    requestId: recoveryRequestId,
    reviewedCommand,
    sessionId,
  });
  const recoveryReceipt = agentSelectedImageRecoveryReceiptSchema.parse({
    blockedRequestId: blockedResult.audit.receipt.requestId,
    currentGraphRevision: blockedResult.applyGuard.currentGraphRevision,
    currentRecipeHash: blockedResult.applyGuard.currentRecipeHash,
    recoveredGraphRevision: draft.snapshot.graphRevision,
    recoveredRecipeHash: draft.snapshot.recipeHash,
    recoveryRequestId,
    staleReason: blockedResult.staleReason,
    status: 'dry_run_ready',
  });
  draft.recovery = {
    blockedAudit: agentSelectedImageLiveSessionAuditRecordSchema.parse(blockedResult.audit),
    receipt: recoveryReceipt,
  };
  if (blockedResult.audit.receipt.proposalLineage !== undefined) {
    draft.proposalLineage = blockedResult.audit.receipt.proposalLineage;
  }
  pushEvent(draft, {
    graphRevision: draft.snapshot.graphRevision,
    message: 'Recovery dry-run refreshed from the current selected-image edit graph.',
    previewHash: draft.snapshot.previewRenderHash,
    recipeHash: draft.snapshot.recipeHash,
    recoveryRequestId,
    staleReason: blockedResult.staleReason,
    state: 'approval_required',
    toolCallId: `${recoveryRequestId}-dry-run`,
    toolName: AGENT_ADJUSTMENTS_DRY_RUN_TOOL_NAME,
  });
  return draft;
};

export const approveAgentSelectedImageLiveSession = (
  draft: AgentSelectedImageLiveSessionDraft,
): AgentSelectedImageLiveSessionDraft => {
  if (draft.state !== 'approval_required') throw new Error('Selected-image live session is not awaiting approval.');
  upgradeLegacyDryRunToProposalLineage(draft);
  const head = draft.proposalLineage.iterations.at(-1);
  if (head === undefined || head.state !== 'ready') {
    throw new Error('Selected-image live session approval requires the latest ready proposal iteration.');
  }
  draft.proposalLineage = transitionAgentSelectedImageProposalIteration(
    draft.proposalLineage,
    head.iterationId,
    'sealed',
    { expectedEpoch: draft.proposalLineage.epoch },
  );
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
  const head = draft.proposalLineage.iterations.at(-1);
  if (head !== undefined && ['draft', 'rendering', 'ready', 'sealed'].includes(head.state)) {
    draft.proposalLineage = transitionAgentSelectedImageProposalIteration(
      draft.proposalLineage,
      head.iterationId,
      'cancelled',
      { expectedEpoch: draft.proposalLineage.epoch, terminalReason: 'session_cancelled' },
    );
  }
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
    proposalLineage: {
      acceptedProposalHash:
        draft.proposalLineage.iterations.find(
          (iteration) => iteration.iterationId === draft.proposalLineage.sealedIterationId,
        )?.proposalHash ?? '',
      acceptedProposalId:
        draft.proposalLineage.iterations.find(
          (iteration) => iteration.iterationId === draft.proposalLineage.sealedIterationId,
        )?.proposalId ?? '',
      lineageEpoch: draft.proposalLineage.epoch,
      lineageId: draft.proposalLineage.lineageId,
      sealedIterationId: draft.proposalLineage.sealedIterationId ?? '',
    },
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
    const sealed = draft.proposalLineage.iterations.find(
      (iteration) => iteration.iterationId === draft.proposalLineage.sealedIterationId,
    );
    if (envelopeValidation.staleReason !== undefined && sealed !== undefined) {
      draft.proposalLineage = transitionAgentSelectedImageProposalIteration(
        draft.proposalLineage,
        sealed.iterationId,
        'stale',
        {
          expectedEpoch: draft.proposalLineage.epoch,
          terminalReason: envelopeValidation.staleReason,
        },
      );
    }
    draft.state = 'failed';
    pushEvent(draft, {
      approvalDecision: 'approved',
      graphRevision: envelopeValidation.applyGuard.currentGraphRevision,
      message: envelopeValidation.message,
      recipeHash: envelopeValidation.applyGuard.currentRecipeHash,
      ...(envelopeValidation.staleReason === undefined ? {} : { staleReason: envelopeValidation.staleReason }),
      state: 'failed',
      toolCallId: `${draft.requestId}-apply`,
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

  const sealed = draft.proposalLineage.iterations.find(
    (iteration) => iteration.iterationId === draft.proposalLineage.sealedIterationId,
  );
  if (sealed === undefined) throw new Error('Selected-image apply requires a current sealed proposal head.');
  assertAgentSelectedImageProposalApplyable({
    acceptedProposalHash: sealed.proposalHash,
    acceptedProposalId: sealed.proposalId,
    baseGraphRevision: draft.snapshot.graphRevision,
    basePreviewArtifactId: sealed.basePreviewArtifactId,
    basePreviewContentHash: sealed.basePreviewContentHash,
    baseRecipeHash: draft.snapshot.recipeHash,
    expectedEpoch: draft.proposalLineage.epoch,
    iterationId: sealed.iterationId,
    lineage: draft.proposalLineage,
    selectedImageId: sealed.selectedImageId,
    sessionId: draft.sessionId,
  });

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
    await dispatchAgentTypedEditorTool({
      args: envelopeValidation.parsedRequest,
      context: createAgentTypedToolExecutionContext({
        arguments: envelopeValidation.parsedRequest,
        callId: `${draft.requestId}-apply`,
        parentCallId: `${draft.requestId}-dry-run`,
        requestId: `${draft.requestId}-apply`,
        sessionId: draft.sessionId,
      }),
      draftSession: buildDraftSession(draft, 'active'),
      toolName: AGENT_ADJUSTMENTS_APPLY_TOOL_NAME,
    }),
  );
  const afterPreview = agentPreviewRenderResponseSchema.parse(
    await dispatchAgentTypedEditorTool({
      args: {
        expectedRecipeHash: buildSnapshot().recipeHash,
        purpose: 'refresh',
        requestId: `${draft.requestId}-after-preview`,
      },
      context: createAgentTypedToolExecutionContext({
        arguments: {
          expectedRecipeHash: buildSnapshot().recipeHash,
          purpose: 'refresh',
          requestId: `${draft.requestId}-after-preview`,
        },
        callId: `${draft.requestId}-after-preview`,
        parentCallId: `${draft.requestId}-apply`,
        requestId: `${draft.requestId}-after-preview`,
        sessionId: draft.sessionId,
      }),
      toolName: AGENT_PREVIEW_RENDER_TOOL_NAME,
    }),
  );

  draft.proposalLineage = transitionAgentSelectedImageProposalIteration(
    draft.proposalLineage,
    sealed.iterationId,
    'applied',
    { expectedEpoch: draft.proposalLineage.epoch },
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
      afterPreviewArtifactId: afterPreview.preview.artifactId,
      afterPreviewHash: apply.afterPreviewHash,
      afterPreviewRef: afterPreview.preview.previewRef,
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
    await dispatchAgentTypedEditorTool({
      args: {
        checkpoint,
        expectedCurrentGraphRevision: current.graphRevision,
        expectedCurrentPreviewRecipeHash: current.recipeHash,
        expectedSelectedImagePath: current.selectedImagePath,
        requestId: `${receipt.requestId}-rollback`,
        scope: 'session_start',
        sessionId: receipt.sessionId,
      },
      context: createAgentTypedToolExecutionContext({
        arguments: {
          checkpoint,
          expectedCurrentGraphRevision: current.graphRevision,
          expectedCurrentPreviewRecipeHash: current.recipeHash,
          expectedSelectedImagePath: current.selectedImagePath,
          requestId: `${receipt.requestId}-rollback`,
          scope: 'session_start',
          sessionId: receipt.sessionId,
        },
        callId: `${receipt.requestId}-rollback`,
        parentCallId: `${receipt.requestId}-apply`,
        requestId: `${receipt.requestId}-rollback`,
        sessionId: receipt.sessionId,
      }),
      toolName: AGENT_HISTORY_ROLLBACK_TOOL_NAME,
    }),
  );
  const restored = buildSnapshot();
  if (
    restored.graphRevision !== receipt.rollbackGraphRevision ||
    restored.recipeHash !== receipt.initialRecipeHash ||
    restored.previewRenderHash !== receipt.beforePreviewHash
  ) {
    throw new Error('Selected-image live session rollback failed restored graph, recipe, or preview verification.');
  }
  const latestRecovery = receipt.recoveries?.at(-1);
  const appliedIteration = receipt.proposalLineage?.iterations.find((iteration) => iteration.state === 'applied');
  const revertedProposalLineage =
    receipt.proposalLineage === undefined || appliedIteration === undefined
      ? receipt.proposalLineage
      : transitionAgentSelectedImageProposalIteration(
          receipt.proposalLineage,
          appliedIteration.iterationId,
          'reverted',
          { expectedEpoch: receipt.proposalLineage.epoch },
        );
  return agentSelectedImageLiveSessionAuditRecordSchema.parse({
    ...parsedAudit,
    auditEvents: [
      ...parsedAudit.auditEvents,
      {
        graphRevision: rollbackReceipt.graphRevision,
        id: `${receipt.requestId}-audit-rollback`,
        message: 'Selected-image live session rolled back through typed app-server dispatch.',
        previewHash: restored.previewRenderHash,
        recoveryRequestId: latestRecovery?.recoveryRequestId,
        recipeHash: rollbackReceipt.previewRecipeHash,
        state: 'rolled_back',
        toolCallId: `${receipt.requestId}-rollback`,
        toolName: AGENT_HISTORY_ROLLBACK_TOOL_NAME,
      },
    ],
    receipt: {
      ...parsedAudit.receipt,
      proposalLineage: revertedProposalLineage,
      recoveries: receipt.recoveries?.map((recovery, index, recoveries) =>
        index === recoveries.length - 1
          ? agentSelectedImageRecoveryReceiptSchema.parse({ ...recovery, status: 'rolled_back' })
          : recovery,
      ),
      rollbackReceiptGraphRevision: rollbackReceipt.graphRevision,
      rollbackReceiptPreviewHash: restored.previewRenderHash,
      rollbackReceiptRecipeHash: rollbackReceipt.previewRecipeHash,
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
        recoveryRequestId: latestRecovery?.recoveryRequestId,
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
        recoveryRequestId: latestRecovery?.recoveryRequestId,
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
    afterPreviewArtifactId?: string;
    afterPreviewHash?: string;
    afterPreviewRef?: string;
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
    auditEvents: [...(draft.recovery?.blockedAudit.auditEvents ?? []), ...draft.auditEvents],
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
      proposalLineage: draft.proposalLineage,
      previewLineage: [
        {
          graphRevision: draft.snapshot.graphRevision,
          previewArtifactId: draft.snapshot.previewArtifactId,
          previewRef: draft.snapshot.previewRef,
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
                previewArtifactId: receiptPatch.afterPreviewArtifactId ?? `${draft.requestId}-after-preview`,
                previewRef: receiptPatch.afterPreviewRef,
                purpose: 'refresh' as const,
                recipeHash: receiptPatch.finalRecipeHash ?? draft.snapshot.recipeHash,
                renderHash: receiptPatch.afterPreviewHash,
                sourceToolCallId: `${draft.requestId}-after-preview`,
                sourceToolName: AGENT_PREVIEW_RENDER_TOOL_NAME,
              },
            ]),
      ],
      promptSummary: summarizePrompt(draft.prompt),
      recoveries:
        draft.recovery === undefined
          ? undefined
          : [
              ...(draft.recovery.blockedAudit.receipt.recoveries ?? []),
              agentSelectedImageRecoveryReceiptSchema.parse({
                ...draft.recovery.receipt,
                status: receiptPatch.state === 'applied' ? 'applied' : 'blocked',
              }),
            ],
      requestId: draft.requestId,
      reviewedCommand: draft.reviewedCommand,
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
    transcript: [
      ...(draft.recovery?.blockedAudit.transcript ?? []),
      ...buildAgentSelectedImageLiveSessionTranscript(draft, receiptPatch),
    ],
  });

const buildAgentSelectedImageLiveSessionTranscript = (
  draft: AgentSelectedImageLiveSessionDraft,
  receiptPatch: {
    afterPreviewArtifactId?: string;
    afterPreviewHash?: string;
    afterPreviewRef?: string;
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
        reviewedCommand: toolCall.name.includes('adjustments') ? draft.reviewedCommand : undefined,
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
    ...(draft.recovery === undefined
      ? []
      : [
          {
            acceptedPreviewArtifactId: draft.snapshot.previewArtifactId,
            graphRevision: draft.snapshot.graphRevision,
            id: `${draft.requestId}-recovery`,
            kind: 'recovery' as const,
            previewArtifactId: draft.snapshot.previewArtifactId,
            recipeHash: draft.snapshot.recipeHash,
            recoveryRequestId: draft.recovery.receipt.recoveryRequestId,
            resultHash: stableTranscriptHash(draft.recovery.receipt),
            staleReason: draft.recovery.receipt.staleReason,
            status: 'succeeded' as const,
            toolCallId: `${draft.requestId}-dry-run`,
            toolName: AGENT_ADJUSTMENTS_DRY_RUN_TOOL_NAME,
          },
        ]),
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
    ...result.previewLineage.map((_lineage, index) => ({
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
  if (receipt.state === 'applied' || receipt.state === 'rolled_back') {
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
  const hasRollbackRestorationProof =
    receipt.rollbackReceiptRecipeHash !== undefined || receipt.rollbackReceiptPreviewHash !== undefined;
  if (
    receipt.state === 'rolled_back' &&
    hasRollbackRestorationProof &&
    (receipt.rollbackReceiptGraphRevision !== receipt.rollbackGraphRevision ||
      receipt.rollbackReceiptRecipeHash !== receipt.initialRecipeHash ||
      receipt.rollbackReceiptPreviewHash !== receipt.beforePreviewHash)
  ) {
    throw new Error('Selected-image live session audit replay rejected unverified rollback restoration.');
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
      ...(receipt.recoveries ?? []).flatMap((recovery) => [recovery.blockedRequestId, recovery.recoveryRequestId]),
      ...receipt.toolCalls.map((toolCall) => toolCall.id),
      ...parsedAudit.auditEvents.map((event) => event.toolCallId).filter((id): id is string => id !== undefined),
    ]),
  );
  const toolNames = Array.from(
    new Set([
      ...receipt.toolCalls.map((toolCall) => toolCall.name),
      ...parsedAudit.transcript.map((entry) => entry.toolName).filter((name): name is string => name !== undefined),
    ]),
  );
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
      rollback: receipt.rollbackReceiptPreviewHash,
    },
    proposalLineage:
      receipt.proposalLineage === undefined
        ? undefined
        : {
            epoch: receipt.proposalLineage.epoch,
            iterations: receipt.proposalLineage.iterations.map((iteration) => ({
              iterationId: iteration.iterationId,
              proposalHash: iteration.proposalHash,
              state: iteration.state,
            })),
            lineageId: receipt.proposalLineage.lineageId,
            sealedIterationId: receipt.proposalLineage.sealedIterationId,
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

  const acceptedPreview =
    audit.transcript.find((entry) => entry.id === `${audit.receipt.requestId}-accepted-preview`) ??
    audit.transcript.find(
      (entry) =>
        entry.kind === 'preview' &&
        entry.previewArtifactId === audit.receipt.acceptedPreviewArtifactId &&
        entry.graphRevision === audit.receipt.initialGraphRevision &&
        entry.recipeHash === audit.receipt.initialRecipeHash,
    );
  if (acceptedPreview?.previewArtifactId !== audit.receipt.acceptedPreviewArtifactId) {
    throw new Error('Selected-image live session audit replay rejected missing accepted preview transcript.');
  }

  const applyDecision =
    audit.transcript.find((entry) => entry.id === `${audit.receipt.requestId}-apply-decision`) ??
    audit.transcript.find((entry) => entry.kind === 'apply_decision' && entry.approvalId === audit.receipt.approvalId);
  if (applyDecision === undefined) {
    throw new Error('Selected-image live session audit replay rejected missing apply decision transcript.');
  }
  if (applyDecision.acceptedPreviewArtifactId !== audit.receipt.acceptedPreviewArtifactId) {
    throw new Error('Selected-image live session audit replay rejected stale apply decision preview artifact.');
  }
  if (
    (audit.receipt.state === 'applied' || audit.receipt.state === 'rolled_back') &&
    applyDecision.status !== 'succeeded'
  ) {
    throw new Error('Selected-image live session audit replay rejected unapplied apply decision status.');
  }
  if (
    (audit.receipt.state === 'applied' || audit.receipt.state === 'rolled_back') &&
    applyDecision.approvalId !== audit.receipt.approvalId
  ) {
    throw new Error('Selected-image live session audit replay rejected mismatched apply approval id.');
  }
};
