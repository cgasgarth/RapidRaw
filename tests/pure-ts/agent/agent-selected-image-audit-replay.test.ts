import { beforeEach, describe, expect, test } from 'bun:test';

import { ToolType } from '../../../src/components/panel/right/layers/Masks';
import { useEditorStore } from '../../../src/store/useEditorStore';
import { ActiveChannel, INITIAL_ADJUSTMENTS } from '../../../src/utils/adjustments';
import { buildAgentImageContextSnapshot } from '../../../src/utils/agent/context/agentImageContextSnapshot';
import {
  type AgentSelectedImageLiveSessionAuditRecord,
  appendAgentSelectedImageLiveSessionAuditRecord,
  parseAgentSelectedImageLiveSessionAuditStore,
  preflightAgentSelectedImageLiveSessionAuditReplay,
  readAgentSelectedImageLiveSessionAuditStore,
} from '../../../src/utils/agent/session/agentSelectedImageLiveSession';

const selectedPath = '/fixtures/public/agent-audit-replay/DSC_4703.ARW';
const bins = Array.from({ length: 256 }, (_, index) => (index === 0 || index === 255 ? 8 : 4));

const seedEditor = () => {
  useEditorStore.getState().setEditor({
    adjustments: INITIAL_ADJUSTMENTS,
    brushSettings: { feather: 50, size: 64, tool: ToolType.Brush },
    finalPreviewUrl: 'blob:rawengine-agent-audit-replay-before',
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
      originalUrl: 'blob:rawengine-agent-audit-replay-original',
      path: selectedPath,
      thumbnailUrl: 'blob:rawengine-agent-audit-replay-thumb',
      width: 6000,
    },
    uncroppedAdjustedPreviewUrl: null,
  });
};

const buildAuditRecord = (): AgentSelectedImageLiveSessionAuditRecord => {
  const snapshot = buildAgentImageContextSnapshot();
  const receipt = {
    acceptedPreviewArtifactId: snapshot.initialPreview.artifactId,
    afterPreviewHash: 'render:agent-audit-replay-after',
    approvalDecision: 'approved' as const,
    approvalId: 'approval_agent_audit_replay_4703',
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
    beforePreviewHash: snapshot.initialPreview.renderHash,
    cancellationOutcome: 'not_cancelled' as const,
    dryRunPlanHash: 'sha256:agent-audit-replay-plan',
    dryRunPlanId: 'dry_run_agent_audit_replay_4703',
    finalGraphRevision: 'history_1',
    finalRecipeHash: 'recipe:agent-audit-replay-after',
    initialGraphRevision: snapshot.graphRevision,
    initialRecipeHash: snapshot.initialPreview.recipeHash,
    operationId: 'agent-audit-replay-operation',
    requestId: 'agent-audit-replay-request',
    rollbackGraphRevision: snapshot.graphRevision,
    selectedImagePath: snapshot.activeImagePath,
    sessionId: 'agent-audit-replay-session',
    state: 'applied' as const,
    toolCalls: [
      { id: 'agent-audit-replay-dry-run', name: 'rawengine.agent.adjustments.dry_run', status: 'succeeded' as const },
      { id: 'agent-audit-replay-apply', name: 'rawengine.agent.adjustments.apply', status: 'succeeded' as const },
      { id: 'agent-audit-replay-after-preview', name: 'rawengine.agent.preview.render', status: 'succeeded' as const },
    ],
  };

  return {
    auditEvents: [
      {
        approvalDecision: 'approved',
        graphRevision: snapshot.graphRevision,
        id: 'agent-audit-replay-event-1',
        message: 'Dry-run accepted for replay preflight.',
        previewHash: snapshot.initialPreview.renderHash,
        recipeHash: snapshot.initialPreview.recipeHash,
        state: 'dry_run_ready',
        toolCallId: 'agent-audit-replay-dry-run',
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
        id: 'agent-audit-replay-preview',
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
        id: 'agent-audit-replay-approval',
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
        id: 'agent-audit-replay-apply-decision',
        kind: 'apply_decision',
        previewArtifactId: snapshot.initialPreview.artifactId,
        recipeHash: receipt.finalRecipeHash,
        resultHash: 'sha256:apply-decision',
        status: 'succeeded',
        toolCallId: 'agent-audit-replay-apply',
        toolName: 'rawengine.agent.adjustments.apply',
      },
    ],
  };
};

describe('agent selected-image audit replay', () => {
  beforeEach(() => {
    seedEditor();
  });

  test('appends and reads replayable audit records from the versioned store', () => {
    let storedText: string | null = null;
    const adapter = {
      readText: () => storedText,
      writeText: (value: string) => {
        storedText = value;
      },
    };

    const record = buildAuditRecord();
    const written = appendAgentSelectedImageLiveSessionAuditRecord(adapter, record);
    expect(written.records).toHaveLength(1);
    expect(readAgentSelectedImageLiveSessionAuditStore(adapter).records[0]?.receipt.sessionId).toBe(
      record.receipt.sessionId,
    );
  });

  test('migrates legacy array storage and falls back from invalid schema', () => {
    const record = buildAuditRecord();
    expect(parseAgentSelectedImageLiveSessionAuditStore(JSON.stringify([record])).records).toHaveLength(1);
    expect(parseAgentSelectedImageLiveSessionAuditStore('{"schemaVersion":0,"records":[]}').records).toHaveLength(0);
    expect(parseAgentSelectedImageLiveSessionAuditStore('not json').records).toHaveLength(0);
  });

  test('preflights replay when source image and graph lineage match', () => {
    const preflight = preflightAgentSelectedImageLiveSessionAuditReplay(buildAuditRecord());
    expect(preflight.status).toBe('ready');
    expect(preflight.staleReason).toBeUndefined();
    expect(preflight.replayPreviewHash).toBe('render:agent-audit-replay-after');
  });

  test('blocks replay for stale source image identity', () => {
    const record = buildAuditRecord();
    useEditorStore.setState((state) => ({
      selectedImage:
        state.selectedImage === null ? null : { ...state.selectedImage, path: '/fixtures/public/other.ARW' },
    }));

    const preflight = preflightAgentSelectedImageLiveSessionAuditReplay(record);
    expect(preflight.status).toBe('stale');
    expect(preflight.staleReason).toBe('image_changed');
  });

  test('blocks replay for stale graph revision before preview reproduction', () => {
    const record = buildAuditRecord();
    useEditorStore.setState({
      history: [INITIAL_ADJUSTMENTS, { ...INITIAL_ADJUSTMENTS, exposure: 0.3 }],
      historyIndex: 1,
    });

    const preflight = preflightAgentSelectedImageLiveSessionAuditReplay(record);
    expect(preflight.status).toBe('stale');
    expect(preflight.staleReason).toBe('graph_revision_changed');
  });
});
