import { beforeEach, describe, expect, test } from 'bun:test';

import { ToolType } from '../../../src/components/panel/right/layers/Masks';
import { useEditorStore } from '../../../src/store/useEditorStore';
import { ActiveChannel, INITIAL_ADJUSTMENTS } from '../../../src/utils/adjustments';
import { buildAgentImageContextSnapshot } from '../../../src/utils/agent/context/agentImageContextSnapshot';
import {
  applyAgentSelectedImageLiveSession,
  approveAgentSelectedImageLiveSession,
  refreshAgentSelectedImageLiveSessionContext,
  replayAgentSelectedImageLiveSessionAudit,
  startAgentSelectedImageLiveSessionDryRun,
} from '../../../src/utils/agent/session/agentSelectedImageLiveSession';
import {
  applyAgentGlobalAdjustments,
  buildAgentAdjustmentsApplyApproval,
  dryRunAgentGlobalAdjustments,
} from '../../../src/utils/agent/tools/agentAdjustmentApplyTool';

const selectedPath = '/fixtures/pure-ts/agent-stale-apply-guards/DSC_4845.ARW';
const bins = Array.from({ length: 256 }, (_, index) => (index === 0 || index === 255 ? 9 : 3));

const seedEditor = () => {
  useEditorStore.getState().setEditor({
    adjustments: INITIAL_ADJUSTMENTS,
    brushSettings: { feather: 50, size: 64, tool: ToolType.Brush },
    finalPreviewUrl: 'blob:rawengine-agent-stale-apply-guards-before',
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
  });
};

const startApprovedSession = async (requestId: string) =>
  approveAgentSelectedImageLiveSession(
    await startAgentSelectedImageLiveSessionDryRun({
      adjustments: { exposure: 0.18, highlights: -10, shadows: 12 },
      operationId: `${requestId}-operation`,
      prompt: 'Brighten the selected RAW and preserve highlight detail.',
      requestId,
      sessionId: 'agent-stale-apply-guards',
    }),
  );

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

    useEditorStore.setState((state) => ({
      adjustments: { ...state.adjustments, exposure: state.adjustments.exposure + 0.35 },
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
