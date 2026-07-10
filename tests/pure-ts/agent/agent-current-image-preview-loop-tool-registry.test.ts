import { beforeEach, describe, expect, test } from 'bun:test';
import { RAW_ENGINE_AGENT_SELECTED_IMAGE_PROPOSAL_RENDER_TOOL_NAME } from '../../../packages/rawengine-schema/src/agentSelectedImageProposalSchemas';
import {
  filterRawEngineLocalAppServerExecutableToolRegistry,
  RawEngineLocalAppServerCommandType,
  type RawEngineLocalAppServerSelectedImagePreviewLoopApplyReviewCommandV1,
  type RawEngineLocalAppServerSelectedImagePreviewLoopCommandV1,
  rawEngineLocalAppServerSelectedImagePreviewLoopApplyReviewCommandV1Schema,
  rawEngineLocalAppServerSelectedImagePreviewLoopCommandV1Schema,
} from '../../../packages/rawengine-schema/src/localAppServerBridge';
import { rawEngineDefaultToolRegistryV1 } from '../../../packages/rawengine-schema/src/toolRegistry';
import { ToolType } from '../../../src/components/panel/right/layers/Masks';
import { useEditorStore } from '../../../src/store/useEditorStore';
import { ActiveChannel, INITIAL_ADJUSTMENTS } from '../../../src/utils/adjustments';
import {
  AGENT_CURRENT_IMAGE_PREVIEW_LOOP_APPLY_REVIEW_INPUT_SCHEMA_NAME,
  AGENT_CURRENT_IMAGE_PREVIEW_LOOP_APPLY_REVIEW_TOOL_NAME,
  AGENT_CURRENT_IMAGE_PREVIEW_LOOP_INPUT_SCHEMA_NAME,
  AGENT_CURRENT_IMAGE_PREVIEW_LOOP_OUTPUT_SCHEMA_NAME,
  AGENT_CURRENT_IMAGE_PREVIEW_LOOP_TOOL_NAME,
  agentCurrentImagePreviewLoopResultSchema,
} from '../../../src/utils/agent/context/agentCurrentImagePreviewLoop';
import { buildAgentImageContextSnapshot } from '../../../src/utils/agent/context/agentImageContextSnapshot';
import { createLiveEditorAppServerBridge } from '../../../src/utils/agent/session/agentLiveEditorState';
import {
  applyAgentGlobalAdjustments,
  buildAgentAdjustmentsApplyApproval,
  dryRunAgentGlobalAdjustments,
} from '../../../src/utils/agent/tools/agentAdjustmentApplyTool';

const selectedPath = '/fixtures/pure-ts/agent-selected-image-preview-loop/DSC_4843.ARW';
const bins = Array.from({ length: 256 }, (_, index) => (index === 0 || index === 255 ? 9 : 3));

const seedEditor = () => {
  useEditorStore.getState().setEditor({
    adjustments: INITIAL_ADJUSTMENTS,
    brushSettings: { feather: 50, size: 64, tool: ToolType.Brush },
    finalPreviewUrl: 'blob:rawengine-agent-preview-loop-4843',
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
      originalUrl: 'blob:rawengine-agent-preview-loop-4843-original',
      path: selectedPath,
      thumbnailUrl: 'blob:rawengine-agent-preview-loop-4843-thumb',
      width: 6000,
    },
    uncroppedAdjustedPreviewUrl: null,
  });
};

const baseLoopRequest = {
  maxIterations: 4,
  operationId: 'agent_selected_loop_4843',
  prompt: 'Brighten the selected image and inspect the selected-image preview before review.',
  requestId: 'agent-selected-loop-4843',
  rollbackAfterReview: true,
  sessionId: 'agent-selected-loop-4843',
  steps: [
    { exposure: 0.2, highlights: -8 },
    {
      assistantRationale: 'The preview needs a second selected-image pass for foreground separation.',
      preview: {
        crop: { height: 0.32, width: 0.34, x: 0.2, y: 0.24 },
        purpose: 'detail_review',
        zoom: { centerX: 0.48, centerY: 0.56, scale: 2.2 },
      },
      shadows: 14,
      userFollowUp: 'Lift shadows and inspect a detail preview before applying.',
    },
  ],
} as const;

const buildAcceptedDryRunApprovals = async () => {
  const approvals: RawEngineLocalAppServerSelectedImagePreviewLoopCommandV1['dryRunApprovals'] = [];

  for (const [index, step] of baseLoopRequest.steps.entries()) {
    const {
      assistantRationale: _assistantRationale,
      preview: _preview,
      userFollowUp: _userFollowUp,
      ...adjustments
    } = step;
    const snapshot = buildAgentImageContextSnapshot();
    const operationId = `${baseLoopRequest.operationId}-${index + 1}`;
    const dryRun = await dryRunAgentGlobalAdjustments({
      adjustments,
      expectedGraphRevision: snapshot.graphRevision,
      expectedRecipeHash: snapshot.initialPreview.recipeHash,
      operationId,
      requestId: `${baseLoopRequest.requestId}-approval-dry-run-${index + 1}`,
      sessionId: baseLoopRequest.sessionId,
    });
    approvals.push({
      acceptedPlanHash: dryRun.dryRunPlanHash,
      acceptedPlanId: dryRun.dryRunPlanId,
      approvalState: 'approved',
      expectedGraphRevision: dryRun.sourceGraphRevision,
      turn: index + 2,
    });
    await applyAgentGlobalAdjustments({
      acceptedPlanHash: dryRun.dryRunPlanHash,
      acceptedPlanId: dryRun.dryRunPlanId,
      adjustments,
      approval: buildAgentAdjustmentsApplyApproval({
        approvalId: `approval_${baseLoopRequest.requestId}_apply_${index + 1}`,
        dryRun,
        expectedRecipeHash: snapshot.initialPreview.recipeHash,
        sessionId: baseLoopRequest.sessionId,
      }),
      expectedGraphRevision: dryRun.sourceGraphRevision,
      expectedRecipeHash: snapshot.initialPreview.recipeHash,
      operationId,
      requestId: `${baseLoopRequest.requestId}-approval-apply-${index + 1}`,
      sessionId: baseLoopRequest.sessionId,
    });
  }

  return approvals;
};

const buildCommand = async (): Promise<RawEngineLocalAppServerSelectedImagePreviewLoopCommandV1> => {
  const initialSnapshot = buildAgentImageContextSnapshot();
  const acceptedApprovals = await buildAcceptedDryRunApprovals();
  seedEditor();

  return rawEngineLocalAppServerSelectedImagePreviewLoopCommandV1Schema.parse({
    ...baseLoopRequest,
    commandType: RawEngineLocalAppServerCommandType.AgentSelectedImagePreviewLoop,
    dryRunApprovals: acceptedApprovals,
    expectedGraphRevision: initialSnapshot.graphRevision,
    expectedPreviewHeight: initialSnapshot.initialPreview.height,
    expectedPreviewIdentity: initialSnapshot.previewIdentity,
    expectedPreviewWidth: initialSnapshot.initialPreview.width,
    expectedRecipeHash: initialSnapshot.initialPreview.recipeHash,
    selectedImagePath: initialSnapshot.activeImagePath,
  });
};

describe('agent selected-image preview-loop executable tool registry', () => {
  beforeEach(() => {
    seedEditor();
  });

  test('exposes selected-image preview-loop tools in the filtered local executable registry', () => {
    const registry = filterRawEngineLocalAppServerExecutableToolRegistry(rawEngineDefaultToolRegistryV1);
    const proposal = registry.tools.find(
      (tool) => tool.toolName === RAW_ENGINE_AGENT_SELECTED_IMAGE_PROPOSAL_RENDER_TOOL_NAME,
    );
    const previewLoop = registry.tools.find((tool) => tool.toolName === AGENT_CURRENT_IMAGE_PREVIEW_LOOP_TOOL_NAME);
    const applyReview = registry.tools.find(
      (tool) => tool.toolName === AGENT_CURRENT_IMAGE_PREVIEW_LOOP_APPLY_REVIEW_TOOL_NAME,
    );

    expect(previewLoop).toMatchObject({
      approvalClass: 'edit_apply',
      inputSchemaName: AGENT_CURRENT_IMAGE_PREVIEW_LOOP_INPUT_SCHEMA_NAME,
      mutates: true,
      outputSchemaName: AGENT_CURRENT_IMAGE_PREVIEW_LOOP_OUTPUT_SCHEMA_NAME,
      requiresDryRun: true,
      returnsArtifactHandles: true,
      toolKind: 'apply',
    });
    expect(proposal).toMatchObject({
      approvalClass: 'preview_only',
      inputSchemaName: 'RawEngineAgentSelectedImageProposalRenderCommandV1',
      mutates: false,
      outputSchemaName: 'RawEngineAgentSelectedImageProposalReceiptV1',
      requiresDryRun: true,
      returnsArtifactHandles: true,
      toolKind: 'dry_run',
    });
    expect(applyReview).toMatchObject({
      approvalClass: 'edit_apply',
      inputSchemaName: AGENT_CURRENT_IMAGE_PREVIEW_LOOP_APPLY_REVIEW_INPUT_SCHEMA_NAME,
      mutates: true,
      outputSchemaName: AGENT_CURRENT_IMAGE_PREVIEW_LOOP_OUTPUT_SCHEMA_NAME,
      requiresDryRun: true,
      returnsArtifactHandles: true,
      toolKind: 'apply',
    });
  });

  test('dispatches the selected-image preview loop through the live local bridge', async () => {
    const command = await buildCommand();
    const bridge = createLiveEditorAppServerBridge();

    const response = await bridge.dispatch(command, { now: () => new Date('2026-07-02T12:00:00.000Z') });
    if (!response.ok) throw new Error(response.message);
    expect(response.ok).toBe(true);

    const result = agentCurrentImagePreviewLoopResultSchema.parse(response.result);
    expect(result.toolName).toBe(AGENT_CURRENT_IMAGE_PREVIEW_LOOP_TOOL_NAME);
    expect(result.selectedImagePath).toBe(selectedPath);
    expect(result.acceptedDryRunPlanCount).toBe(2);
    expect(result.applyReceipts).toHaveLength(2);
    expect(result.previewRefreshCount).toBe(2);
    expect(result.previewRefreshReceipts.at(-1)?.toolName).toBe('rawengine.agent.preview.render');
    expect(result.rollbackReceipt?.toolName).toBe('rawengine.agent.history.rollback');
  });

  test('applies only the latest reviewed selected-image iteration through apply-review', async () => {
    const command = await buildCommand();
    const bridge = createLiveEditorAppServerBridge();
    const reviewResponse = await bridge.dispatch(command, { now: () => new Date('2026-07-02T12:00:00.000Z') });
    if (!reviewResponse.ok) throw new Error(reviewResponse.message);
    const review = agentCurrentImagePreviewLoopResultSchema.parse(reviewResponse.result);
    const latestPreview = review.previewLineage.at(-1);
    const latestReceipt = review.previewRefreshReceipts.at(-1);
    if (latestPreview === undefined || latestReceipt === undefined) {
      throw new Error('Expected latest reviewed preview and receipt.');
    }
    const { commandType: _commandType, ...requestWithoutCommandType } = command;

    const applyCommand: RawEngineLocalAppServerSelectedImagePreviewLoopApplyReviewCommandV1 =
      rawEngineLocalAppServerSelectedImagePreviewLoopApplyReviewCommandV1Schema.parse({
        acceptedPreviewArtifactId: latestPreview.previewArtifactId,
        acceptedPreviewReceiptHash: latestReceipt.contentHash,
        commandType: RawEngineLocalAppServerCommandType.AgentSelectedImagePreviewLoopApplyReview,
        request: {
          ...requestWithoutCommandType,
          requestId: `${command.requestId}-apply-review`,
        },
        review,
      });
    const applyResponse = await bridge.dispatch(applyCommand, { now: () => new Date('2026-07-02T12:05:00.000Z') });
    if (!applyResponse.ok) throw new Error(applyResponse.message);

    const applied = agentCurrentImagePreviewLoopResultSchema.parse(applyResponse.result);
    expect(applied.requestId).toContain('accepted-apply');
    expect(applied.selectedImagePath).toBe(selectedPath);
    expect(applied.initialGraphRevision).toBe(review.rollbackCheckpoint.graphRevision);
    expect(applied.initialRecipeHash).toBe(review.rollbackCheckpoint.previewRecipeHash);

    seedEditor();
    const staleApplyResponse = await bridge.dispatch({
      ...applyCommand,
      acceptedPreviewArtifactId: review.previewLineage[0]?.previewArtifactId,
    });
    expect(staleApplyResponse.ok).toBe(false);
    expect(staleApplyResponse).toMatchObject({
      message: expect.stringContaining('stale preview artifact'),
      reason: 'handler_failed',
    });
  });

  test('rejects stale selected-image state before applying through the bridge executor', async () => {
    const command = await buildCommand();
    useEditorStore.setState({ selectedImage: null });

    const response = await createLiveEditorAppServerBridge().dispatch(command);

    expect(response.ok).toBe(false);
    expect(response).toMatchObject({
      message: expect.stringContaining('selected image'),
      reason: 'handler_failed',
    });
  });

  test('rejects missing dry-run approval during bridge schema validation', async () => {
    const command = await buildCommand();
    const response = await createLiveEditorAppServerBridge().dispatch({
      ...command,
      dryRunApprovals: [command.dryRunApprovals[0]],
    });

    expect(response.ok).toBe(false);
    expect(response).toMatchObject({
      message: 'Edit command rawengine.agent.selected_image.preview_loop failed schema validation.',
      reason: 'invalid_command',
    });
    expect(response.issues?.some((issue) => issue.message.includes('accepted dry-run approval'))).toBe(true);
  });
});
