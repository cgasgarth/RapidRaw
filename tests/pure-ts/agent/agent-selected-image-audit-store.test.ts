import { beforeEach, describe, expect, test } from 'bun:test';

import { ToolType } from '../../../src/components/panel/right/layers/Masks';
import { useEditorStore } from '../../../src/store/useEditorStore';
import { ActiveChannel, INITIAL_ADJUSTMENTS } from '../../../src/utils/adjustments';
import { buildAgentImageContextSnapshot } from '../../../src/utils/agent/context/agentImageContextSnapshot';
import {
  type AgentSelectedImageLiveSessionAuditRecord,
  appendAgentSelectedImageLiveSessionAuditRecord,
  buildAgentSelectedImageLiveSessionAuditStorageKey,
  preflightAgentSelectedImageLiveSessionAuditReplay,
  readAgentSelectedImageLiveSessionAuditStore,
  summarizeAgentSelectedImageLiveSessionAuditStore,
} from '../../../src/utils/agent/session/agentSelectedImageLiveSession';

const selectedPath = '/fixtures/public/agent-audit-store/DSC_4846.ARW';
const bins = Array.from({ length: 256 }, (_, index) => (index === 0 || index === 255 ? 8 : 4));

const seedEditor = () => {
  useEditorStore.getState().setEditor({
    adjustments: INITIAL_ADJUSTMENTS,
    brushSettings: { feather: 50, size: 64, tool: ToolType.Brush },
    finalPreviewUrl: 'blob:rawengine-agent-audit-store-before',
    hasRenderedFirstFrame: true,
    histogram: {
      [ActiveChannel.Blue]: { color: '#4D96FF', data: bins },
      [ActiveChannel.Green]: { color: '#6BCB77', data: bins },
      [ActiveChannel.Luma]: { color: '#FFFFFF', data: bins },
      [ActiveChannel.Red]: { color: '#FF6B6B', data: bins },
    },
    history: [INITIAL_ADJUSTMENTS],
    historyIndex: 0,
    lastBasicToneCommand: null,
    selectedImage: {
      exif: { ISO: '200', LensModel: 'FE 35mm F1.4 GM' },
      height: 4000,
      isRaw: true,
      isReady: true,
      originalUrl: 'blob:rawengine-agent-audit-store-original',
      path: selectedPath,
      thumbnailUrl: 'blob:rawengine-agent-audit-store-thumb',
      width: 6000,
    },
    uncroppedAdjustedPreviewUrl: null,
  });
};

const buildAuditRecord = (): AgentSelectedImageLiveSessionAuditRecord => {
  const snapshot = buildAgentImageContextSnapshot();
  const sessionId = 'agent-audit-store-session';
  const storageKey = buildAgentSelectedImageLiveSessionAuditStorageKey({
    selectedImagePath: snapshot.activeImagePath,
    sessionId,
  });
  const receipt = {
    acceptedPreviewArtifactId: snapshot.initialPreview.artifactId,
    afterPreviewHash: 'render:agent-audit-store-after',
    approvalDecision: 'approved' as const,
    approvalId: 'approval_agent_audit_store_4846',
    applyGuard: {
      acceptedPreviewArtifactId: snapshot.initialPreview.artifactId,
      currentGraphRevision: snapshot.graphRevision,
      currentPreviewArtifactId: snapshot.initialPreview.artifactId,
      currentPreviewHeight: snapshot.initialPreview.height,
      currentPreviewIdentity: snapshot.previewIdentity,
      currentPreviewWidth: snapshot.initialPreview.width,
      currentRecipeHash: snapshot.initialPreview.recipeHash,
      currentSelectedImagePath: snapshot.activeImagePath,
      expectedGraphRevision: snapshot.graphRevision,
      expectedPreviewArtifactId: snapshot.initialPreview.artifactId,
      expectedPreviewHeight: snapshot.initialPreview.height,
      expectedPreviewIdentity: snapshot.previewIdentity,
      expectedPreviewWidth: snapshot.initialPreview.width,
      expectedRecipeHash: snapshot.initialPreview.recipeHash,
      expectedSelectedImagePath: snapshot.activeImagePath,
      status: 'passed' as const,
    },
    applyReceipts: [
      {
        acceptedPlanHash: 'sha256:agent-audit-store-plan',
        acceptedPlanId: 'dry_run_agent_audit_store_4846',
        graphRevision: 'history_1',
        previewHash: 'render:agent-audit-store-after',
        recipeHash: 'recipe:agent-audit-store-after',
        status: 'succeeded' as const,
        toolCallId: 'agent-audit-store-apply',
      },
    ],
    beforePreviewHash: snapshot.initialPreview.renderHash,
    cancellationOutcome: 'not_cancelled' as const,
    dryRunApprovals: [
      {
        approvalId: 'approval_agent_audit_store_4846',
        approvedGraphRevision: snapshot.graphRevision,
        approvedRecipeHash: snapshot.initialPreview.recipeHash,
        dryRunPlanHash: 'sha256:agent-audit-store-plan',
        dryRunPlanId: 'dry_run_agent_audit_store_4846',
        state: 'approved' as const,
      },
    ],
    dryRunPlanHash: 'sha256:agent-audit-store-plan',
    dryRunPlanId: 'dry_run_agent_audit_store_4846',
    finalGraphHash: 'sha256:agent-audit-store-final-graph',
    finalGraphRevision: 'history_1',
    finalRecipeHash: 'recipe:agent-audit-store-after',
    initialGraphRevision: snapshot.graphRevision,
    initialRecipeHash: snapshot.initialPreview.recipeHash,
    operationId: 'agent-audit-store-operation',
    previewLineage: [
      {
        graphRevision: snapshot.graphRevision,
        previewArtifactId: snapshot.initialPreview.artifactId,
        previewRef: snapshot.initialPreview.previewRef,
        purpose: 'accepted_preview' as const,
        recipeHash: snapshot.initialPreview.recipeHash,
        renderHash: snapshot.initialPreview.renderHash,
        sourceToolCallId: 'agent-audit-store-dry-run',
        sourceToolName: 'rawengine.agent.adjustments.dry_run',
      },
      {
        graphRevision: 'history_1',
        previewArtifactId: 'agent-audit-store-after-preview-artifact',
        purpose: 'refresh' as const,
        recipeHash: 'recipe:agent-audit-store-after',
        renderHash: 'render:agent-audit-store-after',
        sourceToolCallId: 'agent-audit-store-after-preview',
        sourceToolName: 'rawengine.agent.preview.render',
      },
    ],
    promptSummary: 'Persist audit receipts with preview lineage',
    requestId: 'agent-audit-store-request',
    rollbackCheckpoint: {
      graphRevision: snapshot.graphRevision,
      previewRecipeHash: snapshot.initialPreview.recipeHash,
      sessionId,
    },
    rollbackGraphRevision: snapshot.graphRevision,
    schemaVersion: 1 as const,
    selectedImagePath: snapshot.activeImagePath,
    sessionId,
    storageKey,
    state: 'applied' as const,
    toolCalls: [
      { id: 'agent-audit-store-dry-run', name: 'rawengine.agent.adjustments.dry_run', status: 'succeeded' as const },
      { id: 'agent-audit-store-apply', name: 'rawengine.agent.adjustments.apply', status: 'succeeded' as const },
      { id: 'agent-audit-store-after-preview', name: 'rawengine.agent.preview.render', status: 'succeeded' as const },
    ],
  };

  return {
    auditEvents: [
      {
        approvalDecision: 'approved',
        graphRevision: snapshot.graphRevision,
        id: 'agent-audit-store-event-1',
        message: 'Dry-run accepted for audit storage.',
        previewHash: snapshot.initialPreview.renderHash,
        recipeHash: snapshot.initialPreview.recipeHash,
        state: 'dry_run_ready',
        toolCallId: 'agent-audit-store-dry-run',
        toolName: 'rawengine.agent.adjustments.dry_run',
      },
    ],
    receipt,
    replayState: 'replayable',
    schemaVersion: 1,
    transcript: [
      {
        acceptedPreviewArtifactId: snapshot.initialPreview.artifactId,
        approvalId: receipt.approvalId,
        graphRevision: snapshot.graphRevision,
        id: 'agent-audit-store-preview',
        kind: 'preview',
        previewArtifactId: snapshot.initialPreview.artifactId,
        recipeHash: snapshot.initialPreview.recipeHash,
        resultHash: snapshot.initialPreview.renderHash,
        status: 'succeeded',
      },
      ...receipt.toolCalls.flatMap((toolCall) => [
        {
          graphRevision: snapshot.graphRevision,
          id: `${toolCall.id}-call`,
          kind: 'tool_call' as const,
          previewArtifactId: snapshot.initialPreview.artifactId,
          recipeHash: snapshot.initialPreview.recipeHash,
          status: 'succeeded' as const,
          toolCallId: toolCall.id,
          toolName: toolCall.name,
        },
        {
          graphRevision: receipt.finalGraphRevision,
          id: `${toolCall.id}-result`,
          kind: 'tool_result' as const,
          previewArtifactId: snapshot.initialPreview.artifactId,
          recipeHash: receipt.finalRecipeHash,
          resultHash: `sha256:${toolCall.id}`,
          status: 'succeeded' as const,
          toolCallId: toolCall.id,
          toolName: toolCall.name,
        },
      ]),
      {
        acceptedPreviewArtifactId: snapshot.initialPreview.artifactId,
        approvalId: receipt.approvalId,
        graphRevision: snapshot.graphRevision,
        id: 'agent-audit-store-approval',
        kind: 'approval',
        previewArtifactId: snapshot.initialPreview.artifactId,
        recipeHash: snapshot.initialPreview.recipeHash,
        resultHash: 'sha256:approval',
        status: 'succeeded',
      },
      {
        acceptedPreviewArtifactId: snapshot.initialPreview.artifactId,
        approvalId: receipt.approvalId,
        graphRevision: receipt.finalGraphRevision,
        id: 'agent-audit-store-apply-decision',
        kind: 'apply_decision',
        previewArtifactId: snapshot.initialPreview.artifactId,
        recipeHash: receipt.finalRecipeHash,
        resultHash: 'sha256:apply-decision',
        status: 'succeeded',
        toolCallId: 'agent-audit-store-apply',
        toolName: 'rawengine.agent.adjustments.apply',
      },
    ],
  };
};

const keyedMemoryAdapter = (key: string, storage = new Map<string, string>()) => ({
  adapter: {
    readText: () => storage.get(key) ?? null,
    writeText: (value: string) => {
      storage.set(key, value);
    },
  },
  storage,
});

describe('agent selected-image audit store', () => {
  beforeEach(() => {
    seedEditor();
  });

  test('appends and reads receipts under selected image and session storage key', () => {
    const record = buildAuditRecord();
    const key = buildAgentSelectedImageLiveSessionAuditStorageKey({
      selectedImagePath: record.receipt.selectedImagePath,
      sessionId: record.receipt.sessionId,
    });
    const { adapter, storage } = keyedMemoryAdapter(key);

    appendAgentSelectedImageLiveSessionAuditRecord(adapter, record);

    expect(storage.has(key)).toBe(true);
    expect(record.receipt.storageKey).toBe(key);
    expect(readAgentSelectedImageLiveSessionAuditStore(adapter).records[0]?.receipt.previewLineage).toHaveLength(2);
    expect(summarizeAgentSelectedImageLiveSessionAuditStore(adapter)).toMatchObject({
      latestSessionId: record.receipt.sessionId,
      previewCount: 2,
      recordCount: 1,
      replayPreflightStatus: 'ready',
    });
  });

  test('rejects malformed receipt lineage before writing', () => {
    const record = structuredClone(buildAuditRecord()) as AgentSelectedImageLiveSessionAuditRecord;
    const key = record.receipt.storageKey ?? 'missing-key';
    const { adapter, storage } = keyedMemoryAdapter(key);
    record.receipt.previewLineage = record.receipt.previewLineage?.slice(0, 1);

    expect(() => appendAgentSelectedImageLiveSessionAuditRecord(adapter, record)).toThrow(
      'missing after-preview lineage',
    );
    expect(storage.has(key)).toBe(false);
  });

  test('passes replay preflight when current selected image lineage matches', () => {
    const preflight = preflightAgentSelectedImageLiveSessionAuditReplay(buildAuditRecord());

    expect(preflight.status).toBe('ready');
    expect(preflight.staleReason).toBeUndefined();
    expect(preflight.replayPreviewHash).toBe('render:agent-audit-store-after');
  });

  test('marks replay preflight stale when selected image path mismatches', () => {
    const record = buildAuditRecord();
    useEditorStore.setState((state) => ({
      selectedImage:
        state.selectedImage === null ? null : { ...state.selectedImage, path: '/fixtures/public/other.ARW' },
    }));

    const preflight = preflightAgentSelectedImageLiveSessionAuditReplay(record);

    expect(preflight.status).toBe('stale');
    expect(preflight.staleReason).toBe('image_changed');
  });
});
