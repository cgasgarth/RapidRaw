import { useCallback, useMemo, useState } from 'react';
import {
  type AgentSelectedImagePreviewReceipt,
  agentSelectedImagePreviewReceiptSchema,
} from '../../../../schemas/agent/agentSelectedImagePreviewReceiptSchemas';
import { useEditorStore } from '../../../../store/useEditorStore';
import { buildAgentImageContextSnapshot } from '../../../../utils/agent/context/agentImageContextSnapshot';
import { AGENT_PREVIEW_RENDER_TOOL_NAME } from '../../../../utils/agent/context/agentReadOnlyAppServerTools';
import {
  type AgentSelectedImageLiveSessionAuditRecord,
  type AgentSelectedImageLiveSessionDraft,
  appendAgentSelectedImageLiveSessionAuditRecord,
  applyAgentSelectedImageLiveSession,
  approveAgentSelectedImageLiveSession,
  buildAgentSelectedImageLiveSessionAuditExportReceipt,
  buildAgentSelectedImageLiveSessionAuditStorageKey,
  preflightAgentSelectedImageLiveSessionAuditReplay,
  rollbackAgentSelectedImageLiveSession,
  startAgentSelectedImageLiveSessionDryRun,
} from '../../../../utils/agent/session/agentSelectedImageLiveSession';
import type { AgentSessionAuditStorageAdapter } from '../../../../utils/agent/session/agentSessionAuditStore';
import {
  AGENT_HISTORY_ROLLBACK_TOOL_NAME,
  type AgentSessionCheckpoint,
} from '../../../../utils/agent/session/agentSessionHistory';
import type { AgentAdjustmentsApplyRequest } from '../../../../utils/agent/tools/agentAdjustmentApplyTool';
import type { SelectedImage } from '../../../ui/AppProperties';

const LIVE_AGENT_SELECTED_IMAGE_SESSION_AUDIT_KEY = 'rawengine.agent.selectedImageLiveSessionAudit.v1';
const WORKSPACE_SESSION_ID = 'agent-workspace-selected-image';
export const AGENT_AUDIT_EXPORT_FILE_TOOL_NAME = 'rawengine.agent.audit.export';

export type AgentSelectedImageWorkspaceActionStatus =
  | 'applied'
  | 'applying'
  | 'approval_required'
  | 'blocked'
  | 'dry_run_ready'
  | 'exported'
  | 'exporting'
  | 'idle'
  | 'rolled_back'
  | 'rolling_back';

export interface AgentSelectedImageWorkspaceActivityEntry {
  body: string;
  graphRevision?: string;
  id: string;
  kind: 'approval' | 'error' | 'export' | 'preview' | 'rollback' | 'tool_call';
  previewAfterHash?: string;
  previewBeforeHash?: string;
  recipeHash?: string;
  requestId?: string;
  status: 'blocked' | 'completed' | 'pending' | 'rolled_back';
  toolName?: string;
}

interface AgentSelectedImageWorkspaceControllerInput {
  selectedImage: Pick<SelectedImage, 'isReady' | 'path'> | null;
}

export interface AgentSelectedImageWorkspaceController {
  actions: {
    apply: () => Promise<void>;
    dryRun: () => Promise<void>;
    exportAudit: () => Promise<void>;
    rollback: () => Promise<void>;
  };
  activityEntries: AgentSelectedImageWorkspaceActivityEntry[];
  auditRecord: AgentSelectedImageLiveSessionAuditRecord | null;
  canApply: boolean;
  canDryRun: boolean;
  canExportAudit: boolean;
  canRollback: boolean;
  disabledReason: string;
  error: string | null;
  latestRequestId: string | null;
  latestToolName: string | null;
  previewReceipt: AgentSelectedImagePreviewReceipt | null;
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

const clamp = (value: number, minimum: number, maximum: number): number => Math.min(maximum, Math.max(minimum, value));

const buildWorkspaceAdjustmentPatch = (): AgentAdjustmentsApplyRequest['adjustments'] => {
  const currentAdjustments = useEditorStore.getState().adjustments;
  return {
    contrast: clamp(currentAdjustments.contrast + 4, -100, 100),
    exposure: clamp(currentAdjustments.exposure + 0.1, -2, 2),
    highlights: clamp(currentAdjustments.highlights - 6, -100, 100),
    shadows: clamp(currentAdjustments.shadows + 8, -100, 100),
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

const saveAuditReceiptWithBrowserFallback = async ({
  filename,
  text,
}: {
  filename: string;
  text: string;
}): Promise<string> => {
  if (
    typeof globalThis.document === 'undefined' ||
    typeof globalThis.Blob === 'undefined' ||
    typeof globalThis.URL === 'undefined' ||
    typeof globalThis.URL.createObjectURL !== 'function'
  ) {
    return filename;
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
    return filename;
  } finally {
    URL.revokeObjectURL(url);
  }
};

export const useAgentSelectedImageWorkspaceController = ({
  selectedImage,
}: AgentSelectedImageWorkspaceControllerInput): AgentSelectedImageWorkspaceController => {
  const [activityEntries, setActivityEntries] = useState<AgentSelectedImageWorkspaceActivityEntry[]>([]);
  const [auditRecord, setAuditRecord] = useState<AgentSelectedImageLiveSessionAuditRecord | null>(null);
  const [draft, setDraft] = useState<AgentSelectedImageLiveSessionDraft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [previewReceiptBase, setPreviewReceiptBase] = useState<AgentSelectedImagePreviewReceiptBase | null>(null);
  const [rollbackCheckpoint, setRollbackCheckpoint] = useState<AgentSessionCheckpoint | null>(null);
  const [status, setStatus] = useState<AgentSelectedImageWorkspaceActionStatus>('idle');
  const editorGraphRevision = useEditorStore((state) => `history_${state.historyIndex}`);
  const editorRecipeInputs = useEditorStore((state) => state.adjustments);

  const selectedImageReady = selectedImage !== null && selectedImage.isReady;
  const operationPending = status === 'applying' || status === 'exporting' || status === 'rolling_back';
  const canDryRun = selectedImageReady && !operationPending;
  const canApply = selectedImageReady && draft !== null && draft.state === 'approval_required' && !operationPending;
  const canExportAudit = selectedImageReady && auditRecord !== null && !operationPending;
  const canRollback =
    selectedImageReady &&
    auditRecord !== null &&
    rollbackCheckpoint !== null &&
    (status === 'applied' || status === 'exported') &&
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

  const dryRun = useCallback(async () => {
    if (!canDryRun) return;
    setError(null);
    const stamp = Date.now();
    const operationId = `agent_workspace_selected_image_${stamp}`;
    const requestId = `agent-workspace-selected-image-${stamp}`;
    const prompt = 'Apply a conservative selected-image review adjustment and keep rollback available.';
    try {
      const sessionDraft = await startAgentSelectedImageLiveSessionDryRun({
        adjustments: buildWorkspaceAdjustmentPatch(),
        operationId,
        prompt,
        requestId,
        sessionId: WORKSPACE_SESSION_ID,
      });
      setDraft(sessionDraft);
      setRollbackCheckpoint(sessionDraft.checkpoint);
      setPreviewReceiptBase(
        parsePreviewReceipt({
          after: {
            artifactId: `${requestId}-dry-run-plan`,
            graphRevision: sessionDraft.dryRun.predictedGraphRevision,
            recipeHash: sessionDraft.dryRun.dryRunPlanHash,
            renderHash: sessionDraft.dryRun.dryRunPlanHash,
            role: 'after',
            toolName: sessionDraft.dryRun.toolName,
          },
          before: {
            artifactId: sessionDraft.snapshot.previewArtifactId,
            graphRevision: sessionDraft.snapshot.graphRevision,
            previewRef: sessionDraft.snapshot.previewRef,
            recipeHash: sessionDraft.snapshot.recipeHash,
            renderHash: sessionDraft.snapshot.previewRenderHash,
            role: 'before',
            toolName: sessionDraft.dryRun.toolName,
          },
          id: `${requestId}-dry-run-receipt`,
          kind: 'dry_run',
          requestId: `${requestId}-dry-run`,
          selectedImagePath: sessionDraft.snapshot.selectedImagePath,
          toolName: sessionDraft.dryRun.toolName,
        }),
      );
      setStatus('approval_required');
      pushActivityEntry({
        body: sessionDraft.dryRun.dryRunPlanHash,
        graphRevision: sessionDraft.dryRun.sourceGraphRevision,
        kind: 'tool_call',
        previewBeforeHash: sessionDraft.snapshot.previewRenderHash,
        recipeHash: sessionDraft.snapshot.recipeHash,
        requestId: `${requestId}-dry-run`,
        status: 'completed',
        toolName: sessionDraft.dryRun.toolName,
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
  }, [canDryRun, pushActivityEntry]);

  const apply = useCallback(async () => {
    if (!canApply || draft === null) return;
    setError(null);
    setStatus('applying');
    try {
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
      const result = await applyAgentSelectedImageLiveSession(approvedDraft);
      persistAuditRecord(result.audit);
      if (result.status === 'blocked') {
        const message = `Selected-image live session blocked: ${result.staleReason}.`;
        setError(message);
        setPreviewReceiptBase((receipt) => (receipt === null ? null : parsePreviewReceipt(receipt)));
        setStatus('blocked');
        pushActivityEntry({
          body: message,
          graphRevision: result.applyGuard.currentGraphRevision,
          kind: 'error',
          recipeHash: result.applyGuard.currentRecipeHash,
          requestId: approvedDraft.requestId,
          status: 'blocked',
          toolName: 'rawengine.agent.adjustments.apply',
        });
        return;
      }
      const beforeLineage = result.audit.receipt.previewLineage?.[0];
      const afterLineage = result.audit.receipt.previewLineage?.at(-1);
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
  }, [canApply, draft, persistAuditRecord, pushActivityEntry]);

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
      await saveAuditReceiptWithBrowserFallback({ filename, text: payload });
      setStatus('exported');
      pushActivityEntry({
        body: `${filename} (${exportReceipt.replayPreflight.status})`,
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
      persistAuditRecord(rollbackAudit);
      setStatus('rolled_back');
      pushActivityEntry({
        body: rollbackAudit.receipt.rollbackReceiptGraphRevision ?? rollbackAudit.receipt.rollbackGraphRevision,
        graphRevision:
          rollbackAudit.receipt.rollbackReceiptGraphRevision ?? rollbackAudit.receipt.rollbackGraphRevision,
        kind: 'rollback',
        recipeHash: rollbackAudit.receipt.initialRecipeHash,
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
      rollback,
    },
    activityEntries,
    auditRecord,
    canApply,
    canDryRun,
    canExportAudit,
    canRollback,
    disabledReason,
    error,
    latestRequestId: latestActivity?.requestId ?? null,
    latestToolName: latestActivity?.toolName ?? null,
    previewReceipt,
    status,
  };
};
