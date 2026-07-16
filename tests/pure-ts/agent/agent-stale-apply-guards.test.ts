import { beforeEach, describe, expect, test } from 'bun:test';

import { ToolType } from '../../../src/components/panel/right/layers/Masks';
import { useEditorStore } from '../../../src/store/useEditorStore';
import { ActiveChannel, INITIAL_ADJUSTMENTS } from '../../../src/utils/adjustments';
import { buildAgentReviewedAdjustmentCommandPlan } from '../../../src/utils/agent/agentReviewedAdjustmentCommands';
import { buildAgentImageContextSnapshot } from '../../../src/utils/agent/context/agentImageContextSnapshot';
import {
  type AgentSelectedImageLiveSessionDraft,
  applyAgentSelectedImageLiveSession,
  approveAgentSelectedImageLiveSession,
  refreshAgentSelectedImageLiveSessionContext,
  rejectAgentSelectedImageLiveSession,
  replayAgentSelectedImageLiveSessionAudit,
  startAgentSelectedImageLiveSessionDryRun,
  validateAgentSelectedImageApplyToolEnvelope,
} from '../../../src/utils/agent/session/agentSelectedImageLiveSession';
import {
  addAgentSelectedImageProposalIteration,
  transitionAgentSelectedImageProposalIteration,
} from '../../../src/utils/agent/session/agentSelectedImageProposalLineage';
import {
  agentHistoryRollbackRequestSchema,
  createAgentSessionCheckpoint,
} from '../../../src/utils/agent/session/agentSessionHistory';
import {
  applyAgentGlobalAdjustments,
  buildAgentAdjustmentsApplyApproval,
  dryRunAgentGlobalAdjustments,
} from '../../../src/utils/agent/tools/agentAdjustmentApplyTool';
import { legacyAdjustmentsToEditDocumentV2 } from '../../../src/utils/editDocumentV2';

const selectedPath = '/fixtures/pure-ts/agent-stale-apply-guards/DSC_4845.ARW';
const bins = Array.from({ length: 256 }, (_, index) => (index === 0 || index === 255 ? 9 : 3));

const seedEditor = () => {
  useEditorStore.getState().hydrateEditorRenderAuthority({
    brushSettings: { feather: 50, size: 64, tool: ToolType.Brush },
    finalPreviewUrl: 'blob:rawengine-agent-stale-apply-guards-before',
    hasRenderedFirstFrame: true,
    histogram: {
      [ActiveChannel.Blue]: { color: '#4D96FF', data: bins },
      [ActiveChannel.Green]: { color: '#6BCB77', data: bins },
      [ActiveChannel.Luma]: { color: '#FFFFFF', data: bins },
      [ActiveChannel.Red]: { color: '#FF6B6B', data: bins },
    },
    historyIndex: 0,
    lastBasicToneCommand: null,
    selectedImage: {
      exif: { ISO: '320', LensModel: 'FE 50mm F1.2 GM' },
      height: 4000,
      isRaw: true,
      isReady: true,
      originalUrl: 'blob:rawengine-agent-stale-apply-guards-original',
      path: selectedPath,
      thumbnailUrl: 'blob:rawengine-agent-stale-apply-guards-thumb',
      width: 6000,
    },
    uncroppedAdjustedPreviewUrl: null,
    editDocumentV2: useEditorStore.getState().editDocumentV2,
    history: [useEditorStore.getState().editDocumentV2],
  });
};

const addReadyCurrentProposal = (draft: AgentSelectedImageLiveSessionDraft): AgentSelectedImageLiveSessionDraft => {
  const now = new Date().toISOString();
  const iterationId = `${draft.proposalLineage.lineageId}-iteration-1`;
  const sha256 = `sha256:${'a'.repeat(64)}`;
  draft.proposalLineage = addAgentSelectedImageProposalIteration(draft.proposalLineage, {
    baseGraphRevision: draft.snapshot.graphRevision,
    basePreviewArtifactId: draft.snapshot.previewArtifactId,
    basePreviewContentHash: sha256,
    baseRecipeHash: draft.snapshot.recipeHash,
    beforePreviewArtifactId: draft.snapshot.previewArtifactId,
    beforePreviewContentHash: sha256,
    cleanupStatus: 'not_required',
    createdAt: now,
    expiresAt: new Date(Date.parse(now) + 60_000).toISOString(),
    initiatingTurnId: `${draft.requestId}-proposal-render`,
    iterationId,
    lineageId: draft.proposalLineage.lineageId,
    ordinal: 1,
    proposalHash: sha256,
    proposalId: `${draft.requestId}-proposal`,
    proposalSchemaVersion: 1,
    schemaVersion: 1,
    selectedImageId: sha256,
    sessionId: draft.sessionId,
    state: 'draft',
    toolCalls: [{ callId: `${draft.requestId}-proposal-render`, type: 'proposal_render' }],
  });
  draft.proposalLineage = transitionAgentSelectedImageProposalIteration(
    draft.proposalLineage,
    iterationId,
    'rendering',
    { expectedEpoch: draft.proposalLineage.epoch, now },
  );
  draft.proposalLineage = transitionAgentSelectedImageProposalIteration(draft.proposalLineage, iterationId, 'ready', {
    expectedEpoch: draft.proposalLineage.epoch,
    now,
  });
  return draft;
};

const buildReviewedCommand = () =>
  buildAgentReviewedAdjustmentCommandPlan({
    commandId: 'highlight_recovery',
    sourceAdjustments: useEditorStore.getState().adjustmentSnapshot.value,
  }).receipt;

const startApprovedSession = async (requestId: string) => {
  const draft = await startAgentSelectedImageLiveSessionDryRun({
    adjustments: { exposure: 0.18, highlights: -10, shadows: 12 },
    operationId: `${requestId}-operation`,
    prompt: 'Brighten the selected RAW and preserve highlight detail.',
    requestId,
    reviewedCommand: buildReviewedCommand(),
    sessionId: 'agent-stale-apply-guards',
  });
  return approveAgentSelectedImageLiveSession(addReadyCurrentProposal(draft));
};

describe('agent stale apply guards', () => {
  beforeEach(() => {
    seedEditor();
  });

  test('blocks apply when the selected image changes after dry-run approval', async () => {
    const draft = await startApprovedSession('issue-4845-selected-image-switch');
    const historyIndexBeforeApply = useEditorStore.getState().historyIndex;

    useEditorStore.setState((state) => ({
      selectedImage:
        state.selectedImage === null
          ? null
          : { ...state.selectedImage, path: '/fixtures/pure-ts/agent-stale-apply-guards/OTHER.ARW' },
    }));

    const refresh = refreshAgentSelectedImageLiveSessionContext(draft);
    expect(refresh).toMatchObject({ staleReason: 'image_changed', status: 'stale' });

    const result = await applyAgentSelectedImageLiveSession(draft);

    expect(result.status).toBe('blocked');
    if (result.status !== 'blocked') throw new Error('Expected selected-image switch to block apply.');
    expect(result.staleReason).toBe('image_changed');
    expect(result.applyGuard.status).toBe('rejected');
    expect(result.audit.receipt.toolCalls.at(-1)).toMatchObject({ status: 'blocked' });
    expect(result.audit.transcript).toContainEqual(
      expect.objectContaining({ kind: 'apply_decision', staleReason: 'image_changed', status: 'rejected' }),
    );
    expect(useEditorStore.getState().historyIndex).toBe(historyIndexBeforeApply);
    expect(replayAgentSelectedImageLiveSessionAudit(result.audit).staleReason).toBe('image_changed');
  });

  test('blocks apply when the recipe changes between dry-run and apply', async () => {
    const draft = await startApprovedSession('issue-4845-manual-slider-edit');
    const historyIndexBeforeApply = useEditorStore.getState().historyIndex;

    useEditorStore.getState().hydrateEditorRenderAuthority((state) => ({
      editDocumentV2: legacyAdjustmentsToEditDocumentV2({
        ...state.adjustmentSnapshot.value,
        exposure: state.adjustmentSnapshot.value.exposure + 0.35,
      }),
      history: [
        legacyAdjustmentsToEditDocumentV2({
          ...state.adjustmentSnapshot.value,
          exposure: state.adjustmentSnapshot.value.exposure + 0.35,
        }),
      ],
      historyIndex: 0,
      uncroppedAdjustedPreviewUrl: null,
    }));

    const refresh = refreshAgentSelectedImageLiveSessionContext(draft);
    expect(refresh).toMatchObject({ staleReason: 'recipe_hash_changed', status: 'stale' });

    const result = await applyAgentSelectedImageLiveSession(draft);

    expect(result.status).toBe('blocked');
    if (result.status !== 'blocked') throw new Error('Expected manual recipe edit to block apply.');
    expect(result.staleReason).toBe('recipe_hash_changed');
    expect(result.applyGuard.currentRecipeHash).not.toBe(result.applyGuard.expectedRecipeHash);
    expect(result.audit.receipt.applyGuard).toMatchObject({
      staleReason: 'recipe_hash_changed',
      status: 'rejected',
    });
    expect(useEditorStore.getState().historyIndex).toBe(historyIndexBeforeApply);
  });

  test('blocks apply when approval is missing without mutating history', async () => {
    const draft = await startAgentSelectedImageLiveSessionDryRun({
      adjustments: { exposure: 0.18, highlights: -10, shadows: 12 },
      operationId: 'issue-4878-missing-approval-operation',
      prompt: 'Brighten the selected RAW and preserve highlight detail.',
      requestId: 'issue-4878-missing-approval',
      reviewedCommand: buildReviewedCommand(),
      sessionId: 'agent-stale-apply-guards',
    });
    const historyIndexBeforeApply = useEditorStore.getState().historyIndex;

    rejectAgentSelectedImageLiveSession(draft);
    const result = await applyAgentSelectedImageLiveSession(draft);

    expect(result.status).toBe('blocked');
    if (result.status !== 'blocked') throw new Error('Expected missing approval to block apply.');
    expect(result.reason).toBe('missing_approval');
    expect(result.staleReason).toBeUndefined();
    expect(result.audit.receipt.toolCalls.at(-1)).toMatchObject({ status: 'blocked' });
    expect(useEditorStore.getState().historyIndex).toBe(historyIndexBeforeApply);
  });

  test('rejects approval when a current rendered proposal lineage is missing', async () => {
    const draft = await startAgentSelectedImageLiveSessionDryRun({
      adjustments: { exposure: 0.18 },
      operationId: 'issue-5953-no-legacy-lineage-operation',
      prompt: 'Do not fabricate proposal proof.',
      requestId: 'issue-5953-no-legacy-lineage',
      reviewedCommand: buildReviewedCommand(),
      sessionId: 'agent-stale-apply-guards',
    });

    expect(() => approveAgentSelectedImageLiveSession(draft)).toThrow('latest ready proposal iteration');
    expect(draft.proposalLineage.iterations).toEqual([]);
  });

  test('rejects flat or incomplete rollback checkpoints instead of reconstructing typed history', () => {
    const checkpoint = createAgentSessionCheckpoint('agent-stale-apply-guards');
    const request = {
      checkpoint,
      requestId: 'issue-5953-current-checkpoint',
      scope: 'operation' as const,
      sessionId: checkpoint.sessionId,
    };

    expect(agentHistoryRollbackRequestSchema.safeParse(request).success).toBe(true);
    expect(
      agentHistoryRollbackRequestSchema.safeParse({
        ...request,
        checkpoint: { ...checkpoint, history: [] },
      }).success,
    ).toBe(false);
    const { history: _history, historyCheckpoints: _historyCheckpoints, ...flat } = checkpoint;
    expect(agentHistoryRollbackRequestSchema.safeParse({ ...request, checkpoint: flat }).success).toBe(false);
  });

  test('validates selected-image apply tool name before dispatch', async () => {
    const draft = await startApprovedSession('issue-4878-runtime-tool-mismatch');
    const validation = validateAgentSelectedImageApplyToolEnvelope({
      args: {
        acceptedPlanHash: draft.dryRun.dryRunPlanHash,
        acceptedPlanId: draft.dryRun.dryRunPlanId,
        adjustments: draft.adjustments,
        approval: {
          approvalId: draft.approvalId,
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
      },
      draft,
      requestId: `${draft.requestId}-apply`,
      runtimeToolName: 'rawengine.agent.adjustments.delete',
    });

    expect(validation.status).toBe('blocked');
    if (validation.status !== 'blocked') throw new Error('Expected wrong runtime tool to block apply.');
    expect(validation.reason).toBe('runtime_tool_mismatch');
    expect(validation.applyGuard.status).toBe('passed');
  });

  test('rejects apply when the accepted plan hash does not match the approved dry-run', async () => {
    const snapshot = buildAgentImageContextSnapshot();
    const dryRun = await dryRunAgentGlobalAdjustments({
      adjustments: { exposure: 0.2, shadows: 8 },
      expectedGraphRevision: snapshot.graphRevision,
      expectedRecipeHash: snapshot.initialPreview.recipeHash,
      operationId: 'issue-4845-plan-hash-mismatch',
      requestId: 'issue-4845-plan-hash-mismatch-dry-run',
      sessionId: 'agent-stale-apply-guards',
    });
    const historyIndexBeforeApply = useEditorStore.getState().historyIndex;

    await expect(
      applyAgentGlobalAdjustments({
        acceptedPlanHash: dryRun.dryRunPlanHash,
        acceptedPlanId: dryRun.dryRunPlanId,
        adjustments: { exposure: 0.2, shadows: 8 },
        approval: {
          ...buildAgentAdjustmentsApplyApproval({
            approvalId: 'approval_issue_4845_plan_hash_mismatch',
            dryRun,
            expectedRecipeHash: snapshot.initialPreview.recipeHash,
            sessionId: 'agent-stale-apply-guards',
          }),
          approvedPlanHash: 'sha256:agent-adjustments:stale',
        },
        expectedGraphRevision: dryRun.sourceGraphRevision,
        expectedRecipeHash: snapshot.initialPreview.recipeHash,
        operationId: 'issue-4845-plan-hash-mismatch',
        requestId: 'issue-4845-plan-hash-mismatch-apply',
        sessionId: 'agent-stale-apply-guards',
      }),
    ).rejects.toThrow('mismatched approval receipt');
    expect(useEditorStore.getState().historyIndex).toBe(historyIndexBeforeApply);
  });
});
