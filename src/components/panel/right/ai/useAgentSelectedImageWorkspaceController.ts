import { save as saveDialog } from '@tauri-apps/plugin-dialog';
import { readTextFile, writeTextFile } from '@tauri-apps/plugin-fs';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { RawEngineAgentSelectedImageProposalReceiptV1 } from '../../../../../packages/rawengine-schema/src/agentSelectedImageProposalSchemas';
import type { AgentReviewedAdjustmentCommandId } from '../../../../schemas/agent/agentReviewedCommandSchemas';
import {
  type AgentSelectedImageLiveSessionReplayPreflight,
  agentSelectedImageLiveSessionAuditExportReceiptSchema,
} from '../../../../schemas/agent/agentSelectedImageAuditExportSchemas';
import {
  type AgentSelectedImagePreviewReceipt,
  agentSelectedImagePreviewReceiptSchema,
} from '../../../../schemas/agent/agentSelectedImagePreviewReceiptSchemas';
import type {
  AgentSelectedImageRecoveryStaleReason,
  AgentSelectedImageRollbackReadiness,
} from '../../../../schemas/agent/agentSelectedImageRecoverySchemas';
import { useEditorStore } from '../../../../store/useEditorStore';
import {
  AGENT_REVIEWED_ADJUSTMENT_COMMAND_OPTIONS,
  type AgentReviewedAdjustmentCommandOption,
  type AgentReviewedAdjustmentCommandPlan,
  buildAgentReviewedAdjustmentCommandPlan,
  DEFAULT_AGENT_REVIEWED_ADJUSTMENT_COMMAND_ID,
} from '../../../../utils/agent/agentReviewedAdjustmentCommands';
import { buildAgentImageContextSnapshot } from '../../../../utils/agent/context/agentImageContextSnapshot';
import { AGENT_PREVIEW_RENDER_TOOL_NAME } from '../../../../utils/agent/context/agentReadOnlyAppServerTools';
import { agentSelectedImageProposalRuntime } from '../../../../utils/agent/context/agentSelectedImageProposalRuntime';
import {
  type AgentSelectedImageLiveSessionAuditRecord,
  type AgentSelectedImageLiveSessionBlockedResult,
  type AgentSelectedImageLiveSessionDraft,
  appendAgentSelectedImageLiveSessionAuditRecord,
  applyAgentSelectedImageLiveSession,
  approveAgentSelectedImageLiveSession,
  buildAgentSelectedImageLiveSessionAuditExportReceipt,
  buildAgentSelectedImageLiveSessionAuditStorageKey,
  getAgentSelectedImageLiveSessionRollbackReadiness,
  preflightAgentSelectedImageLiveSessionAuditReplay,
  recoverAgentSelectedImageLiveSessionDryRun,
  renderAgentSelectedImageLiveSessionProposal,
  rollbackAgentSelectedImageLiveSession,
  startAgentSelectedImageLiveSessionDryRun,
} from '../../../../utils/agent/session/agentSelectedImageLiveSession';
import type { AgentSessionAuditStorageAdapter } from '../../../../utils/agent/session/agentSessionAuditStore';
import {
  AGENT_HISTORY_ROLLBACK_TOOL_NAME,
  type AgentSessionCheckpoint,
} from '../../../../utils/agent/session/agentSessionHistory';
import type { SelectedImage } from '../../../ui/AppProperties';

const LIVE_AGENT_SELECTED_IMAGE_SESSION_AUDIT_KEY = 'rawengine.agent.selectedImageLiveSessionAudit.v1';
const WORKSPACE_SESSION_ID = 'agent-workspace-selected-image';
export const AGENT_AUDIT_EXPORT_FILE_TOOL_NAME = 'rawengine.agent.audit.export';

export type AgentSelectedImageWorkspaceActionStatus =
  | 'applied'
  | 'applying'
  | 'approval_required'
  | 'blocked'
  | 'cancelled'
  | 'dry_run_ready'
  | 'exported'
  | 'exporting'
  | 'failed'
  | 'idle'
  | 'refreshing'
  | 'released'
  | 'rendering'
  | 'rolled_back'
  | 'rolling_back'
  | 'stale'
  | 'superseded'
  | 'timed_out';

export interface AgentSelectedImageWorkspaceActivityEntry {
  body: string;
  graphRevision?: string;
  currentGraphRevision?: string;
  currentRecipeHash?: string;
  id: string;
  kind: 'approval' | 'error' | 'export' | 'preview' | 'recovery' | 'rollback' | 'tool_call';
  previewAfterHash?: string;
  previewBeforeHash?: string;
  recipeHash?: string;
  recoveryRequestId?: string;
  requestId?: string;
  staleReason?: AgentSelectedImageRecoveryStaleReason;
  status: 'blocked' | 'completed' | 'pending' | 'rolled_back';
  toolName?: string;
}

export interface AgentSelectedImageAuditExportResult {
  destination: string;
  mode: 'browser_fallback' | 'native';
  replayPreflightStatus: AgentSelectedImageLiveSessionReplayPreflight['status'];
  validationStatus: 'valid';
}

interface AgentSelectedImageWorkspaceControllerInput {
  selectedImage: Pick<SelectedImage, 'isReady' | 'path'> | null;
}

export interface AgentSelectedImageWorkspaceController {
  actions: {
    apply: () => Promise<void>;
    dryRun: () => Promise<void>;
    exportAudit: () => Promise<void>;
    refreshDryRun: () => Promise<void>;
    rollback: () => Promise<void>;
    selectCommand: (commandId: AgentReviewedAdjustmentCommandId) => void;
  };
  activityEntries: AgentSelectedImageWorkspaceActivityEntry[];
  auditRecord: AgentSelectedImageLiveSessionAuditRecord | null;
  blockedRecovery: {
    blockedRequestId: string;
    currentGraphRevision: string;
    currentRecipeHash: string;
    staleReason: AgentSelectedImageRecoveryStaleReason;
  } | null;
  canApply: boolean;
  canDryRun: boolean;
  canExportAudit: boolean;
  canRecover: boolean;
  canRollback: boolean;
  disabledReason: string;
  error: string | null;
  exportResult: AgentSelectedImageAuditExportResult | null;
  latestRequestId: string | null;
  latestToolName: string | null;
  previewReceipt: AgentSelectedImagePreviewReceipt | null;
  proposalReceipt: RawEngineAgentSelectedImageProposalReceiptV1 | null;
  reviewedCommandOptions: AgentReviewedAdjustmentCommandOption[];
  rollbackReadiness: AgentSelectedImageRollbackReadiness | null;
  selectedCommandId: AgentReviewedAdjustmentCommandId;
  selectedCommandPlan: AgentReviewedAdjustmentCommandPlan;
  status: AgentSelectedImageWorkspaceActionStatus;
}

type AgentSelectedImagePreviewReceiptBase = Omit<AgentSelectedImagePreviewReceipt, 'staleReason' | 'state'>;

const createLocalAgentSelectedImageLiveSessionAuditStorageAdapter = ({
  selectedImagePath,
  sessionId,
}: {
  selectedImagePath: string;
  sessionId: string;
}): AgentSessionAuditStorageAdapter | null => {
  if (typeof globalThis.localStorage === 'undefined') return null;

  const storageKey = buildAgentSelectedImageLiveSessionAuditStorageKey({
    namespace: LIVE_AGENT_SELECTED_IMAGE_SESSION_AUDIT_KEY,
    selectedImagePath,
    sessionId,
  });

  return {
    readText: () => globalThis.localStorage.getItem(storageKey),
    writeText: (value) => {
      globalThis.localStorage.setItem(storageKey, value);
    },
  };
};

const buildActivityEntry = (
  index: number,
  entry: Omit<AgentSelectedImageWorkspaceActivityEntry, 'id'>,
): AgentSelectedImageWorkspaceActivityEntry => ({
  ...entry,
  id: `agent-workspace-live-action-${Date.now()}-${index}`,
});

const getImageBasename = (path: string): string => {
  const cleanPath = path.split('?')[0] ?? path;
  return cleanPath.split(/[\\/]/u).pop() || cleanPath || 'selected-image';
};

const buildAuditExportFilename = (record: AgentSelectedImageLiveSessionAuditRecord): string => {
  const basename = getImageBasename(record.receipt.selectedImagePath).replaceAll(/[^A-Za-z0-9._-]/gu, '_');
  return `${basename}-${record.receipt.sessionId}-audit.json`.replaceAll(/[^A-Za-z0-9._-]/gu, '_');
};

const getCurrentSnapshotForReceipt = () => {
  try {
    const snapshot = buildAgentImageContextSnapshot();
    return {
      graphRevision: snapshot.graphRevision,
      recipeHash: snapshot.initialPreview.recipeHash,
      selectedImagePath: snapshot.activeImagePath,
    };
  } catch {
    return null;
  }
};

const resolveReceiptState = (
  receipt: AgentSelectedImagePreviewReceiptBase,
): Pick<AgentSelectedImagePreviewReceipt, 'staleReason' | 'state'> => {
  const current = getCurrentSnapshotForReceipt();
  const target = receipt.kind === 'apply' ? receipt.after : receipt.before;
  if (current === null || current.selectedImagePath !== receipt.selectedImagePath) {
    return { staleReason: 'image_changed', state: 'stale' };
  }
  if (current.graphRevision !== target.graphRevision) {
    return { staleReason: 'graph_revision_changed', state: 'stale' };
  }
  if (current.recipeHash !== target.recipeHash) {
    return { staleReason: 'recipe_hash_changed', state: 'stale' };
  }
  return { state: 'current' };
};

const parsePreviewReceipt = (receipt: AgentSelectedImagePreviewReceiptBase): AgentSelectedImagePreviewReceipt =>
  agentSelectedImagePreviewReceiptSchema.parse({
    ...receipt,
    ...resolveReceiptState(receipt),
  });

const isNativeAuditExportAvailable = (): boolean =>
  typeof window !== 'undefined' &&
  window.__TAURI_INTERNALS__ !== undefined &&
  window.__RAWENGINE_BROWSER_TAURI_HARNESS__?.enabled !== true;

const saveNativeAuditReceipt = async (filename: string, text: string) => {
  const path = await saveDialog({
    defaultPath: filename,
    filters: [{ name: 'RawEngine Agent Audit', extensions: ['json'] }],
    title: 'Export agent audit receipt',
  });
  if (typeof path !== 'string') return null;
  await writeTextFile(path, text);
  return { destination: path, text: await readTextFile(path) };
};

export const saveAgentSelectedImageAuditReceipt = async ({
  filename,
  nativeAvailable = isNativeAuditExportAvailable(),
  nativeSave = saveNativeAuditReceipt,
  text,
}: {
  filename: string;
  nativeAvailable?: boolean;
  nativeSave?: (filename: string, text: string) => Promise<{ destination: string; text: string } | null>;
  text: string;
}): Promise<{ destination: string; mode: 'browser_fallback' | 'native'; text: string } | null> => {
  if (nativeAvailable) {
    const saved = await nativeSave(filename, text);
    return saved === null ? null : { ...saved, mode: 'native' };
  }

  if (
    typeof globalThis.document === 'undefined' ||
    typeof globalThis.Blob === 'undefined' ||
    typeof globalThis.URL === 'undefined' ||
    typeof globalThis.URL.createObjectURL !== 'function'
  ) {
    return { destination: filename, mode: 'browser_fallback', text };
  }

  const blob = new Blob([text], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  try {
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.rel = 'noopener';
    link.style.display = 'none';
    document.body.appendChild(link);
    link.click();
    link.remove();
    return { destination: filename, mode: 'browser_fallback', text };
  } finally {
    URL.revokeObjectURL(url);
  }
};

export const useAgentSelectedImageWorkspaceController = ({
  selectedImage,
}: AgentSelectedImageWorkspaceControllerInput): AgentSelectedImageWorkspaceController => {
  const [activityEntries, setActivityEntries] = useState<AgentSelectedImageWorkspaceActivityEntry[]>([]);
  const [exportResult, setExportResult] = useState<AgentSelectedImageAuditExportResult | null>(null);
  const [auditRecord, setAuditRecord] = useState<AgentSelectedImageLiveSessionAuditRecord | null>(null);
  const [blockedResult, setBlockedResult] = useState<AgentSelectedImageLiveSessionBlockedResult | null>(null);
  const [draft, setDraft] = useState<AgentSelectedImageLiveSessionDraft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [previewReceiptBase, setPreviewReceiptBase] = useState<AgentSelectedImagePreviewReceiptBase | null>(null);
  const [rollbackCheckpoint, setRollbackCheckpoint] = useState<AgentSessionCheckpoint | null>(null);
  const [selectedCommandId, setSelectedCommandId] = useState<AgentReviewedAdjustmentCommandId>(
    DEFAULT_AGENT_REVIEWED_ADJUSTMENT_COMMAND_ID,
  );
  const [status, setStatus] = useState<AgentSelectedImageWorkspaceActionStatus>('idle');
  const currentAdjustments = useEditorStore((state) => state.adjustments);
  const selectedCommandPlan = useMemo(
    () =>
      buildAgentReviewedAdjustmentCommandPlan({
        commandId: selectedCommandId,
        sourceAdjustments: currentAdjustments,
      }),
    [currentAdjustments, selectedCommandId],
  );
  const editorGraphRevision = useEditorStore((state) => `history_${state.historyIndex}`);
  const editorRecipeInputs = useEditorStore((state) => state.adjustments);

  const selectedImageReady = selectedImage !== null && selectedImage.isReady;
  const operationPending =
    status === 'applying' ||
    status === 'exporting' ||
    status === 'refreshing' ||
    status === 'rendering' ||
    status === 'rolling_back';
  const canDryRun = selectedImageReady && !operationPending;
  const canApply =
    selectedImageReady &&
    draft !== null &&
    draft.state === 'approval_required' &&
    draft.proposal?.status === 'ready' &&
    !operationPending;
  const canExportAudit = selectedImageReady && auditRecord !== null && !operationPending;
  const canRecover = selectedImageReady && blockedResult?.staleReason !== undefined && !operationPending;
  const rollbackReadiness = useMemo(
    () =>
      auditRecord === null || rollbackCheckpoint === null
        ? null
        : getAgentSelectedImageLiveSessionRollbackReadiness({ audit: auditRecord, checkpoint: rollbackCheckpoint }),
    [auditRecord, editorGraphRevision, editorRecipeInputs, rollbackCheckpoint, selectedImage?.path],
  );
  const canRollback =
    selectedImageReady &&
    (status === 'applied' || status === 'exported') &&
    rollbackReadiness?.status === 'safe' &&
    !operationPending;
  const disabledReason = useMemo(() => {
    if (selectedImage === null) return 'Select an image before running selected-image live actions.';
    if (!selectedImage.isReady) return 'Selected image is still loading.';
    if (operationPending) return 'Selected-image live action is already running.';
    if (status === 'blocked' && error !== null) return error;
    return '';
  }, [error, operationPending, selectedImage, status]);

  const pushActivityEntry = useCallback((entry: Omit<AgentSelectedImageWorkspaceActivityEntry, 'id'>) => {
    setActivityEntries((entries) => [...entries, buildActivityEntry(entries.length, entry)]);
  }, []);

  const persistAuditRecord = useCallback((record: AgentSelectedImageLiveSessionAuditRecord) => {
    const adapter = createLocalAgentSelectedImageLiveSessionAuditStorageAdapter({
      selectedImagePath: record.receipt.selectedImagePath,
      sessionId: record.receipt.sessionId,
    });
    if (adapter !== null) appendAgentSelectedImageLiveSessionAuditRecord(adapter, record);
    setAuditRecord(record);
  }, []);

  const selectCommand = useCallback(
    (commandId: AgentReviewedAdjustmentCommandId) => {
      if (draft?.proposal !== undefined) void agentSelectedImageProposalRuntime.release(draft.proposal.proposalId);
      setSelectedCommandId(commandId);
      setBlockedResult(null);
      setDraft(null);
      setError(null);
      setRollbackCheckpoint(null);
      setStatus('idle');
    },
    [draft],
  );

  useEffect(
    () => () => {
      if (draft?.proposal !== undefined) void agentSelectedImageProposalRuntime.release(draft.proposal.proposalId);
    },
    [draft?.proposal],
  );

  const dryRun = useCallback(async () => {
    if (!canDryRun) return;
    setBlockedResult(null);
    setError(null);
    setStatus('rendering');
    const stamp = Date.now();
    const operationId = `agent_workspace_selected_image_${stamp}`;
    const requestId = `agent-workspace-selected-image-${stamp}`;
    const prompt = `Apply reviewed command: ${selectedCommandPlan.receipt.label}.`;
    try {
      const sessionDraft = await startAgentSelectedImageLiveSessionDryRun({
        adjustments: selectedCommandPlan.adjustments,
        operationId,
        prompt,
        requestId,
        reviewedCommand: selectedCommandPlan.receipt,
        sessionId: WORKSPACE_SESSION_ID,
      });
      const proposal = await renderAgentSelectedImageLiveSessionProposal(sessionDraft);
      setDraft(sessionDraft);
      if (proposal.status !== 'ready') {
        const message = proposal.warnings.join(' ') || `Selected-image proposal ${proposal.status}.`;
        setError(message);
        setStatus(proposal.status);
        pushActivityEntry({
          body: message,
          kind: 'error',
          requestId: `${requestId}-proposal`,
          status: 'blocked',
          toolName: 'rawengine.agent.selected_image.proposal.render',
        });
        return;
      }
      const artifacts = proposal.artifacts;
      if (artifacts === undefined) throw new Error('Ready selected-image proposal omitted preview artifacts.');
      setRollbackCheckpoint(sessionDraft.checkpoint);
      setPreviewReceiptBase(
        parsePreviewReceipt({
          after: {
            artifactId: artifacts.after.artifactId,
            graphRevision: sessionDraft.dryRun.predictedGraphRevision,
            recipeHash: artifacts.after.recipeHash,
            renderHash: artifacts.after.renderHash,
            role: 'after',
            toolName: 'rawengine.agent.selected_image.proposal.render',
          },
          before: {
            artifactId: artifacts.before.artifactId,
            graphRevision: sessionDraft.snapshot.graphRevision,
            previewRef: sessionDraft.snapshot.previewRef,
            recipeHash: artifacts.before.recipeHash,
            renderHash: artifacts.before.renderHash,
            role: 'before',
            toolName: sessionDraft.dryRun.toolName,
          },
          id: `${requestId}-dry-run-receipt`,
          kind: 'dry_run',
          requestId: `${requestId}-dry-run`,
          selectedImagePath: sessionDraft.snapshot.selectedImagePath,
          toolName: 'rawengine.agent.selected_image.proposal.render',
        }),
      );
      setStatus('approval_required');
      pushActivityEntry({
        body: `${sessionDraft.reviewedCommand.label}: ${proposal.proposalHash}`,
        graphRevision: sessionDraft.dryRun.sourceGraphRevision,
        kind: 'tool_call',
        previewAfterHash: artifacts.after.contentHash,
        previewBeforeHash: artifacts.before.contentHash,
        recipeHash: sessionDraft.snapshot.recipeHash,
        requestId: `${requestId}-dry-run`,
        status: 'completed',
        toolName: 'rawengine.agent.selected_image.proposal.render',
      });
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : 'Selected-image dry-run failed.';
      setError(message);
      setStatus('blocked');
      pushActivityEntry({
        body: message,
        kind: 'error',
        requestId,
        status: 'blocked',
        toolName: 'rawengine.agent.adjustments.dry_run',
      });
    }
  }, [canDryRun, pushActivityEntry, selectedCommandPlan]);

  const refreshDryRun = useCallback(async () => {
    if (!canRecover || blockedResult === null || blockedResult.staleReason === undefined) return;
    setError(null);
    setStatus('refreshing');
    const stamp = Date.now();
    const recoveryRequestId = `${blockedResult.audit.receipt.requestId}-recovery-${stamp}`;
    try {
      const sessionDraft = await recoverAgentSelectedImageLiveSessionDryRun({
        adjustments: selectedCommandPlan.adjustments,
        blockedResult,
        operationId: `agent_workspace_selected_image_recovery_${stamp}`,
        prompt: `Recover reviewed command from the current edit: ${selectedCommandPlan.receipt.label}.`,
        recoveryRequestId,
        reviewedCommand: selectedCommandPlan.receipt,
        sessionId: WORKSPACE_SESSION_ID,
      });
      const proposal = await renderAgentSelectedImageLiveSessionProposal(sessionDraft);
      setDraft(sessionDraft);
      if (proposal.status !== 'ready') {
        const message = proposal.warnings.join(' ') || `Selected-image proposal ${proposal.status}.`;
        setError(message);
        setStatus(proposal.status);
        pushActivityEntry({
          body: message,
          kind: 'error',
          recoveryRequestId,
          requestId: `${recoveryRequestId}-proposal`,
          status: 'blocked',
          toolName: 'rawengine.agent.selected_image.proposal.render',
        });
        return;
      }
      const artifacts = proposal.artifacts;
      if (artifacts === undefined) throw new Error('Ready selected-image proposal omitted preview artifacts.');
      setRollbackCheckpoint(sessionDraft.checkpoint);
      setPreviewReceiptBase(
        parsePreviewReceipt({
          after: {
            artifactId: artifacts.after.artifactId,
            graphRevision: sessionDraft.dryRun.predictedGraphRevision,
            recipeHash: artifacts.after.recipeHash,
            renderHash: artifacts.after.renderHash,
            role: 'after',
            toolName: 'rawengine.agent.selected_image.proposal.render',
          },
          before: {
            artifactId: artifacts.before.artifactId,
            graphRevision: sessionDraft.snapshot.graphRevision,
            previewRef: sessionDraft.snapshot.previewRef,
            recipeHash: artifacts.before.recipeHash,
            renderHash: artifacts.before.renderHash,
            role: 'before',
            toolName: sessionDraft.dryRun.toolName,
          },
          id: `${recoveryRequestId}-dry-run-receipt`,
          kind: 'dry_run',
          requestId: `${recoveryRequestId}-dry-run`,
          selectedImagePath: sessionDraft.snapshot.selectedImagePath,
          toolName: 'rawengine.agent.selected_image.proposal.render',
        }),
      );
      setBlockedResult(null);
      setStatus('approval_required');
      pushActivityEntry({
        body: `Refreshed from ${sessionDraft.snapshot.graphRevision}`,
        currentGraphRevision: sessionDraft.snapshot.graphRevision,
        currentRecipeHash: sessionDraft.snapshot.recipeHash,
        graphRevision: sessionDraft.snapshot.graphRevision,
        kind: 'recovery',
        previewAfterHash: artifacts.after.contentHash,
        previewBeforeHash: artifacts.before.contentHash,
        recipeHash: sessionDraft.snapshot.recipeHash,
        recoveryRequestId,
        requestId: `${recoveryRequestId}-dry-run`,
        staleReason: blockedResult.staleReason,
        status: 'completed',
        toolName: 'rawengine.agent.selected_image.proposal.render',
      });
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : 'Selected-image recovery dry-run failed.';
      setError(message);
      setStatus('blocked');
      pushActivityEntry({
        body: message,
        currentGraphRevision: blockedResult.applyGuard.currentGraphRevision,
        currentRecipeHash: blockedResult.applyGuard.currentRecipeHash,
        graphRevision: blockedResult.applyGuard.currentGraphRevision,
        kind: 'error',
        recipeHash: blockedResult.applyGuard.currentRecipeHash,
        recoveryRequestId,
        requestId: recoveryRequestId,
        staleReason: blockedResult.staleReason,
        status: 'blocked',
        toolName: 'rawengine.agent.adjustments.dry_run',
      });
    }
  }, [blockedResult, canRecover, pushActivityEntry, selectedCommandPlan]);

  const apply = useCallback(async () => {
    if (!canApply || draft === null) return;
    setError(null);
    setStatus('applying');
    try {
      const currentProposal = await agentSelectedImageProposalRuntime.ensureReady(draft.proposal?.proposalId ?? '');
      if (currentProposal?.status !== 'ready' || currentProposal.receiptHash !== draft.proposal?.receiptHash) {
        throw new Error('Selected-image apply rejected a stale or released proposal identity.');
      }
      const approvedDraft = approveAgentSelectedImageLiveSession(draft);
      setDraft(approvedDraft);
      pushActivityEntry({
        body: approvedDraft.approvalId ?? 'approved',
        graphRevision: approvedDraft.snapshot.graphRevision,
        kind: 'approval',
        previewBeforeHash: approvedDraft.snapshot.previewRenderHash,
        recipeHash: approvedDraft.snapshot.recipeHash,
        requestId: approvedDraft.requestId,
        status: 'completed',
        toolName: 'rawengine.agent.session.approval',
      });
      const auditStorage = createLocalAgentSelectedImageLiveSessionAuditStorageAdapter({
        selectedImagePath: approvedDraft.snapshot.selectedImagePath,
        sessionId: approvedDraft.sessionId,
      });
      const result = await applyAgentSelectedImageLiveSession(
        approvedDraft,
        auditStorage === null ? {} : { auditStorage },
      );
      setAuditRecord(result.audit);
      if (result.status === 'blocked') {
        const message = `Selected-image live session blocked: ${result.staleReason}.`;
        setBlockedResult(result);
        setError(message);
        setPreviewReceiptBase((receipt) => (receipt === null ? null : parsePreviewReceipt(receipt)));
        setStatus('blocked');
        pushActivityEntry({
          body: message,
          currentGraphRevision: result.applyGuard.currentGraphRevision,
          currentRecipeHash: result.applyGuard.currentRecipeHash,
          graphRevision: result.applyGuard.currentGraphRevision,
          kind: 'error',
          recipeHash: result.applyGuard.currentRecipeHash,
          requestId: approvedDraft.requestId,
          ...(result.staleReason === undefined ? {} : { staleReason: result.staleReason }),
          status: 'blocked',
          toolName: 'rawengine.agent.adjustments.apply',
        });
        return;
      }
      const beforeLineage = result.audit.receipt.previewLineage?.[0];
      const afterLineage = result.audit.receipt.previewLineage?.at(-1);
      const recoveryRequestId = result.audit.receipt.recoveries?.at(-1)?.recoveryRequestId;
      setBlockedResult(null);
      setStatus('applied');
      setPreviewReceiptBase(
        parsePreviewReceipt({
          after: {
            artifactId: afterLineage?.previewArtifactId ?? `${approvedDraft.requestId}-after-preview`,
            graphRevision: result.apply.appliedGraphRevision,
            previewRef: afterLineage?.previewRef,
            recipeHash: result.audit.receipt.finalRecipeHash ?? result.audit.receipt.initialRecipeHash,
            renderHash: result.previewAfterHash,
            role: 'after',
            toolName: afterLineage?.sourceToolName ?? AGENT_PREVIEW_RENDER_TOOL_NAME,
          },
          before: {
            artifactId: beforeLineage?.previewArtifactId ?? approvedDraft.snapshot.previewArtifactId,
            graphRevision: approvedDraft.snapshot.graphRevision,
            previewRef: beforeLineage?.previewRef ?? approvedDraft.snapshot.previewRef,
            recipeHash: approvedDraft.snapshot.recipeHash,
            renderHash: result.previewBeforeHash,
            role: 'before',
            toolName: approvedDraft.dryRun.toolName,
          },
          id: `${approvedDraft.requestId}-apply-receipt`,
          kind: 'apply',
          requestId: result.apply.requestId,
          selectedImagePath: approvedDraft.snapshot.selectedImagePath,
          toolName: result.apply.toolName,
        }),
      );
      pushActivityEntry({
        body: result.apply.appliedGraphRevision,
        graphRevision: result.apply.appliedGraphRevision,
        kind: 'tool_call',
        previewAfterHash: result.previewAfterHash,
        previewBeforeHash: result.previewBeforeHash,
        recipeHash: result.audit.receipt.finalRecipeHash ?? result.audit.receipt.initialRecipeHash,
        ...(recoveryRequestId === undefined ? {} : { recoveryRequestId }),
        requestId: result.apply.requestId,
        status: 'completed',
        toolName: result.apply.toolName,
      });
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : 'Selected-image apply failed.';
      setError(message);
      setStatus('blocked');
      pushActivityEntry({
        body: message,
        kind: 'error',
        requestId: draft.requestId,
        status: 'blocked',
        toolName: 'rawengine.agent.adjustments.apply',
      });
    }
  }, [canApply, draft, pushActivityEntry]);

  const exportAudit = useCallback(async () => {
    if (!canExportAudit || auditRecord === null) return;
    setError(null);
    setStatus('exporting');
    const requestId = `${auditRecord.receipt.requestId}-workspace-audit-export`;
    try {
      const replayPreflight = preflightAgentSelectedImageLiveSessionAuditReplay(auditRecord);
      const exportReceipt = buildAgentSelectedImageLiveSessionAuditExportReceipt({
        audit: auditRecord,
        replayPreflight,
      });
      const filename = buildAuditExportFilename(auditRecord);
      const payload = `${JSON.stringify(exportReceipt, null, 2)}\n`;
      const saved = await saveAgentSelectedImageAuditReceipt({ filename, text: payload });
      if (saved === null) {
        setStatus(auditRecord.receipt.state === 'applied' ? 'applied' : 'dry_run_ready');
        return;
      }
      const parsedReceipt = agentSelectedImageLiveSessionAuditExportReceiptSchema.parse(JSON.parse(saved.text));
      const nextExportResult: AgentSelectedImageAuditExportResult = {
        destination: saved.destination,
        mode: saved.mode,
        replayPreflightStatus: parsedReceipt.replayPreflight.status,
        validationStatus: 'valid',
      };
      setExportResult(nextExportResult);
      setStatus('exported');
      pushActivityEntry({
        body: `${saved.destination} (${saved.mode}; replay ${parsedReceipt.replayPreflight.status}; valid)`,
        graphRevision: auditRecord.receipt.finalGraphRevision ?? auditRecord.receipt.initialGraphRevision,
        kind: 'export',
        previewAfterHash: auditRecord.receipt.afterPreviewHash ?? auditRecord.receipt.beforePreviewHash,
        recipeHash: auditRecord.receipt.finalRecipeHash ?? auditRecord.receipt.initialRecipeHash,
        requestId,
        status: 'completed',
        toolName: AGENT_AUDIT_EXPORT_FILE_TOOL_NAME,
      });
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : 'Selected-image audit export failed.';
      setError(message);
      setStatus('blocked');
      pushActivityEntry({
        body: message,
        kind: 'error',
        requestId,
        status: 'blocked',
        toolName: AGENT_AUDIT_EXPORT_FILE_TOOL_NAME,
      });
    }
  }, [auditRecord, canExportAudit, pushActivityEntry]);

  const rollback = useCallback(async () => {
    if (!canRollback || auditRecord === null || rollbackCheckpoint === null) return;
    setError(null);
    setStatus('rolling_back');
    try {
      const rollbackAudit = await rollbackAgentSelectedImageLiveSession({
        audit: auditRecord,
        checkpoint: rollbackCheckpoint,
      });
      const recoveryRequestId = rollbackAudit.receipt.recoveries?.at(-1)?.recoveryRequestId;
      persistAuditRecord(rollbackAudit);
      setStatus('rolled_back');
      pushActivityEntry({
        body: rollbackAudit.receipt.rollbackReceiptGraphRevision ?? rollbackAudit.receipt.rollbackGraphRevision,
        currentGraphRevision:
          rollbackAudit.receipt.rollbackReceiptGraphRevision ?? rollbackAudit.receipt.rollbackGraphRevision,
        currentRecipeHash: rollbackAudit.receipt.rollbackReceiptRecipeHash ?? rollbackAudit.receipt.initialRecipeHash,
        graphRevision:
          rollbackAudit.receipt.rollbackReceiptGraphRevision ?? rollbackAudit.receipt.rollbackGraphRevision,
        kind: 'rollback',
        recipeHash: rollbackAudit.receipt.initialRecipeHash,
        ...(recoveryRequestId === undefined ? {} : { recoveryRequestId }),
        requestId: `${rollbackAudit.receipt.requestId}-rollback`,
        status: 'rolled_back',
        toolName: AGENT_HISTORY_ROLLBACK_TOOL_NAME,
      });
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : 'Selected-image rollback failed.';
      setError(message);
      setStatus('blocked');
      pushActivityEntry({
        body: message,
        kind: 'error',
        requestId: auditRecord.receipt.requestId,
        status: 'blocked',
        toolName: AGENT_HISTORY_ROLLBACK_TOOL_NAME,
      });
    }
  }, [auditRecord, canRollback, persistAuditRecord, pushActivityEntry, rollbackCheckpoint]);

  const latestActivity = activityEntries.at(-1);
  const previewReceipt = useMemo(
    () => (previewReceiptBase === null ? null : parsePreviewReceipt(previewReceiptBase)),
    [editorGraphRevision, editorRecipeInputs, previewReceiptBase, selectedImage?.path],
  );

  return {
    actions: {
      apply,
      dryRun,
      exportAudit,
      refreshDryRun,
      rollback,
      selectCommand,
    },
    activityEntries,
    auditRecord,
    blockedRecovery:
      blockedResult?.staleReason === undefined
        ? null
        : {
            blockedRequestId: blockedResult.audit.receipt.requestId,
            currentGraphRevision: blockedResult.applyGuard.currentGraphRevision,
            currentRecipeHash: blockedResult.applyGuard.currentRecipeHash,
            staleReason: blockedResult.staleReason,
          },
    canApply,
    canDryRun,
    canExportAudit,
    canRecover,
    canRollback,
    disabledReason,
    error,
    exportResult,
    latestRequestId: latestActivity?.requestId ?? null,
    latestToolName: latestActivity?.toolName ?? null,
    previewReceipt,
    proposalReceipt: draft?.proposal ?? null,
    reviewedCommandOptions: AGENT_REVIEWED_ADJUSTMENT_COMMAND_OPTIONS,
    rollbackReadiness,
    selectedCommandId,
    selectedCommandPlan,
    status,
  };
};
